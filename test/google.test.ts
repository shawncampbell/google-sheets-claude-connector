import { describe, expect, it } from "vitest";
import { createSheetsApi, exchangeCode, GoogleError, googleAuthorizeUrl, refreshAccessToken } from "../src/google";
import { fakeGoogle, fakeIdToken } from "./fakes";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const signInInput = { clientId: "client-1", clientSecret: "s", redirectUri: "https://example.com/callback", code: "c", codeVerifier: "v" };

describe("what is asked of Google at sign-in", () => {
  it("asks for the per-file permission and an account id, and nothing else", () => {
    const url = new URL(googleAuthorizeUrl({ clientId: "client-1", redirectUri: "https://example.com/callback", state: "s", codeChallenge: "c" }));
    expect(url.searchParams.get("scope")).toBe(`openid ${DRIVE_FILE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("accepts a sign-in that granted per-file access", async () => {
    const { fetcher } = fakeGoogle([
      { json: { access_token: "a", refresh_token: "r", expires_in: 3599, scope: `openid ${DRIVE_FILE}`, id_token: fakeIdToken({ sub: "user-1", aud: "client-1", iss: "https://accounts.google.com" }) } },
    ]);
    await expect(exchangeCode(fetcher, signInInput)).resolves.toEqual({ sub: "user-1", refreshToken: "r", accessToken: "a", expiresIn: 3599 });
  });

  it("refuses a sign-in where the person unticked the per-file permission", async () => {
    const { fetcher } = fakeGoogle([
      { json: { access_token: "a", refresh_token: "r", scope: "openid", id_token: fakeIdToken({ sub: "user-1", aud: "client-1", iss: "https://accounts.google.com" }) } },
    ]);
    await expect(exchangeCode(fetcher, signInInput)).rejects.toMatchObject({ kind: "reconnect" });
  });

  it("refuses an ID token issued for a different app", async () => {
    const { fetcher } = fakeGoogle([
      { json: { access_token: "a", refresh_token: "r", scope: `openid ${DRIVE_FILE}`, id_token: fakeIdToken({ sub: "user-1", aud: "someone-else", iss: "https://accounts.google.com" }) } },
    ]);
    await expect(exchangeCode(fetcher, signInInput)).rejects.toBeInstanceOf(GoogleError);
  });

  it("says to reconnect when Google has revoked the stored access", async () => {
    const { fetcher } = fakeGoogle([{ status: 400, json: { error: "invalid_grant" } }]);
    await expect(refreshAccessToken(fetcher, { clientId: "c", clientSecret: "s", refreshToken: "r" })).rejects.toMatchObject({ kind: "reconnect" });
  });
});

describe("what is asked of Google when using a sheet", () => {
  const api = (answers: Parameters<typeof fakeGoogle>[0]) => {
    const google = fakeGoogle(answers);
    return { ...google, sheets: createSheetsApi(google.fetcher, async () => "token-1") };
  };

  it("creates a sheet through the Sheets API with the caller's token", async () => {
    const { calls, sheets } = api([{ json: { spreadsheetId: "id-1", spreadsheetUrl: "https://example.com/s", properties: { title: "Log" } } }]);
    await expect(sheets.create("Log")).resolves.toEqual({ spreadsheetId: "id-1", url: "https://example.com/s", title: "Log" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://sheets.googleapis.com/v4/spreadsheets" });
    expect(calls[0]?.headers.Authorization).toBe("Bearer token-1");
  });

  it("lists only spreadsheets that are not in the bin", async () => {
    const { calls, sheets } = api([{ json: { files: [{ id: "id-1", name: "Log", modifiedTime: "2026-01-01T00:00:00Z" }] } }]);
    await expect(sheets.list()).resolves.toEqual([{ spreadsheetId: "id-1", title: "Log", modifiedTime: "2026-01-01T00:00:00Z", createdTime: "" }]);
    const q = new URL(calls[0]!.url).searchParams.get("q");
    expect(q).toBe("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  });

  it("reads, writes and appends with the range safely encoded", async () => {
    const { calls, sheets } = api([
      { json: { range: "'My tab'!A1:B2", values: [["a", 1]] } },
      { json: { updatedRange: "'My tab'!A1:B1", updatedCells: 2 } },
      { json: { updates: { updatedRange: "'My tab'!A3:B3", updatedRows: 1 } } },
    ]);
    await expect(sheets.read("id-1", "'My tab'!A1:B2")).resolves.toEqual({ range: "'My tab'!A1:B2", values: [["a", 1]] });
    await expect(sheets.write("id-1", "'My tab'!A1:B1", [["a", 1]])).resolves.toEqual({ updatedRange: "'My tab'!A1:B1", updatedCells: 2 });
    await expect(sheets.append("id-1", "'My tab'!A1", [["b", 2]])).resolves.toEqual({ updatedRange: "'My tab'!A3:B3", updatedRows: 1 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "POST"]);
    expect(calls[0]?.url).toBe("https://sheets.googleapis.com/v4/spreadsheets/id-1/values/'My%20tab'!A1%3AB2");
    expect(calls[2]?.url).toContain("/values/'My%20tab'!A1:append?");
  });

  it("explains a sheet it was never given, instead of passing on Google's error", async () => {
    const { sheets } = api([{ status: 404, json: { error: { message: "Requested entity was not found." } } }]);
    await expect(sheets.read("id-9", "A1")).rejects.toMatchObject({ kind: "not_reachable" });
  });

  it("writes the catalog exactly as given, so a title starting with = is never run as a formula", async () => {
    const { calls, sheets } = api([{ json: {} }, { json: {} }]);
    await sheets.clearValues("id-1", "A:H");
    await sheets.writeRaw("id-1", "A1", [["=IMPORTRANGE(1)"]]);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://sheets.googleapis.com/v4/spreadsheets/id-1/values/A%3AH:clear" });
    expect(calls[1]?.url).toContain("valueInputOption=RAW");
  });

  it("never sends a DELETE and never calls a delete, trash, share or batch-update method from a tool's path", async () => {
    const { calls, sheets } = api([
      { json: { spreadsheetId: "i", spreadsheetUrl: "u", properties: { title: "t" } } },
      { json: { files: [] } },
      { json: { spreadsheetId: "i", spreadsheetUrl: "u", properties: { title: "t" }, sheets: [] } },
      { json: { range: "A1", values: [] } },
      { json: { updatedRange: "A1" } },
      { json: { updates: {} } },
    ]);
    await sheets.create("t");
    await sheets.list();
    await sheets.describe("id-1");
    await sheets.read("id-1", "A1");
    await sheets.write("id-1", "A1", [[1]]);
    await sheets.append("id-1", "A1", [[1]]);
    for (const call of calls) {
      expect(["GET", "POST", "PUT"]).toContain(call.method);
      expect(new URL(call.url).pathname).not.toMatch(/batchUpdate|permissions|trash|:clear|\/copy/);
    }
  });
});
