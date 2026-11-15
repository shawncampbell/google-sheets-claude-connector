import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { AppEnv } from "../src/env";
import { fakeIdToken } from "./fakes";

/**
 * The whole path Claude takes, with Google replaced by a fake: register, see the consent
 * page, go to Google and back, get a token, then call a tool. Nothing here reaches the
 * network.
 */

const ORIGIN = "https://connector.example";
const CLAUDE_CALLBACK = "https://claude.example/api/mcp/auth_callback";
const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

function fakeKv() {
  const data = new Map<string, string>();
  const kv = {
    async get(key: string, options?: unknown) {
      const value = data.get(key);
      if (value === undefined) return null;
      const type = typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      data.set(key, String(value));
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  };
  return { data, kv: kv as unknown as KVNamespace };
}

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function cookiesFrom(response: Response, jar: Map<string, string>) {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair!.indexOf("=");
    const name = pair!.slice(0, index);
    const value = pair!.slice(index + 1);
    if (value === "" || /max-age=0/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
}
const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function s256(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("connecting and using the connector, end to end", () => {
  let env: AppEnv;
  let store: Map<string, string>;
  let googleCalls: Array<{ url: string; authorization: string | null; body: string }>;
  let googleSubject: string;
  /** Sheets the stored account can reach, by id: what Google would allow after a pick. */
  let reachableSheets: Map<string, string>;
  /** What was last written to each sheet's cells, by id. */
  let writtenCells: Map<string, unknown[][]>;

  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);

  beforeEach(() => {
    const { data, kv } = fakeKv();
    store = data;
    googleCalls = [];
    googleSubject = "google-user-1";
    reachableSheets = new Map();
    writtenCells = new Map();
    env = {
      OAUTH_KV: kv,
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
    } as AppEnv;

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      googleCalls.push({ url, authorization: headers.get("authorization"), body: String(init?.body ?? "") });
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          expires_in: 3599,
          scope: `openid ${DRIVE_FILE}`,
          id_token: fakeIdToken({ sub: googleSubject, aud: "google-client-id", iss: "https://accounts.google.com" }),
        });
      }
      if (url === "https://sheets.googleapis.com/v4/spreadsheets") {
        const title = (JSON.parse(String(init?.body)) as { properties: { title: string } }).properties.title;
        const id = title === "Google Sheets Claude Connector Catalog" ? "catalog-sheet-id-0123456789" : "new-sheet-id-0123456789";
        reachableSheets.set(id, title);
        return Response.json({ spreadsheetId: id, spreadsheetUrl: "https://example.com/sheet", properties: { title } });
      }
      const cells = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/?]+)\/values\/([^?:]+)(:clear)?(\?.*)?$/.exec(url);
      if (cells) {
        const id = decodeURIComponent(cells[1]!);
        if (init?.method === "PUT") {
          writtenCells.set(id, (JSON.parse(String(init.body)) as { values: unknown[][] }).values);
          return Response.json({ updatedRange: "A1" });
        }
        if (cells[3]) return Response.json({});
        return Response.json({ range: "A2:G", values: (writtenCells.get(id) ?? []).slice(1) });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        return Response.json({ files: [...reachableSheets].map(([id, name]) => ({ id, name, modifiedTime: "2026-01-01T00:00:00Z" })) });
      }
      const metadata = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/?]+)\?fields=/.exec(url);
      if (metadata) {
        const id = decodeURIComponent(metadata[1]!);
        if (!reachableSheets.has(id)) return Response.json({ error: { message: "not found" } }, { status: 404 });
        return Response.json({ spreadsheetId: id, spreadsheetUrl: "https://example.com/sheet", properties: { title: reachableSheets.get(id) }, sheets: [] });
      }
      throw new Error(`Unexpected outbound request to ${url}`);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Runs the sign-in as Claude would and returns the last response and what led to it. */
  async function signIn() {
    const registered = await send("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "none" }),
    });
    expect(registered.status).toBe(201);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };

    const verifier = "claude-verifier-claude-verifier-claude-verifier-0123";
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
      scope: "sheets",
      state: "claude-state",
      resource: `${ORIGIN}/mcp`,
    });

    const jar = new Map<string, string>();
    const consent = await send(`/authorize?${query}`);
    const consentHtml = await consent.text();
    cookiesFrom(consent, jar);
    const handle = /name="handle" value="([^"]+)"/.exec(consentHtml)?.[1] ?? "";

    const toGoogle = await send("/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(jar), Origin: ORIGIN },
      body: new URLSearchParams({ handle, decision: "approve" }).toString(),
    });
    cookiesFrom(toGoogle, jar);
    const googleUrl = new URL(toGoogle.headers.get("Location") ?? "https://missing.example");

    const back = await send(`/callback?code=google-code&state=${encodeURIComponent(googleUrl.searchParams.get("state") ?? "")}`, {
      headers: { Cookie: cookieHeader(jar) },
    });
    return { clientId, verifier, consent, consentHtml, toGoogle, googleUrl, back };
  }

  const form = (jar: Map<string, string>, fields: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN, Cookie: cookieHeader(jar) },
    body: new URLSearchParams(fields).toString(),
  });

  /** Signs a browser in to the Worker's own pages as whoever `googleSubject` is. */
  async function ownerSession() {
    const jar = new Map<string, string>();
    const started = await send("/manage/sign-in", form(jar, { return: "/manage" }));
    cookiesFrom(started, jar);
    const googleUrl = new URL(started.headers.get("Location") ?? "https://missing.example");
    const back = await send(`/callback?state=${encodeURIComponent(googleUrl.searchParams.get("state") ?? "")}&code=owner-code`, {
      headers: { Cookie: cookieHeader(jar) },
    });
    cookiesFrom(back, jar);
    return { jar, back, googleUrl };
  }

  /** Creates a group on the manage page and reads its key off the page that shows it once. */
  async function makeGroup(jar: Map<string, string>, name: string) {
    const page = await send("/manage/groups", form(jar, { name }));
    const html = await page.text();
    return { page, html, key: /sheets-key-[A-Za-z0-9_-]+/.exec(html)?.[0] ?? "" };
  }

  /** Gets a token as Claude would after the sign-in, and returns a way to call tools with it. */
  async function claude() {
    const { clientId, verifier, back } = await signIn();
    const returned = new URL(back.headers.get("Location")!);
    const token = await send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: returned.searchParams.get("code")!,
        client_id: clientId,
        redirect_uri: CLAUDE_CALLBACK,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    const { access_token: accessToken } = (await token.json()) as { access_token: string };
    let id = 0;
    return async (name: string, args: Record<string, unknown>) => {
      const response = await send("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
      });
      const result = ((await response.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
      return { isError: Boolean(result.isError), text: result.content[0]!.text };
    };
  }

  it("shows the delete limit before anything is sent to Google", async () => {
    const { consent, consentHtml } = await signIn();
    expect(consent.status).toBe(200);
    expect(consentHtml).toContain("not a limit Google enforces");
    expect(consentHtml).toContain("claude.example");
    expect(consent.headers.get("X-Frame-Options")).toBe("DENY");
    // Chromium blocks the redirect to Google after the form post unless Google is named here.
    expect(consent.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://accounts.google.com");
  });

  it("sends the person to Google asking only for per-file access", async () => {
    const { toGoogle, googleUrl } = await signIn();
    expect(toGoogle.status).toBe(302);
    expect(googleUrl.origin + googleUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(googleUrl.searchParams.get("scope")).toBe(`openid ${DRIVE_FILE}`);
    expect(googleUrl.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
  });

  it("finishes the sign-in, then lets Claude create a sheet with the stored Google access", async () => {
    const { clientId, verifier, back } = await signIn();
    expect(back.status).toBe(302);
    const returned = new URL(back.headers.get("Location")!);
    expect(returned.origin + returned.pathname).toBe(CLAUDE_CALLBACK);
    expect(returned.searchParams.get("state")).toBe("claude-state");

    const token = await send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: returned.searchParams.get("code")!,
        client_id: clientId,
        redirect_uri: CLAUDE_CALLBACK,
        code_verifier: verifier,
        resource: `${ORIGIN}/mcp`,
      }).toString(),
    });
    expect(token.status).toBe(200);
    const { access_token: accessToken } = (await token.json()) as { access_token: string };

    const mcp = (body: unknown) =>
      send("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });

    const listed = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(listed.status).toBe(200);
    const tools = ((await listed.json()) as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["append_rows", "change_structure", "create_sheet", "list_sheets", "read_sheet", "write_range"]);

    const { key } = await makeGroup((await ownerSession()).jar, "Reading");
    const created = await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_sheet", arguments: { project_key: key, title: "Reading log" } } });
    const result = ((await created.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ spreadsheetId: "new-sheet-id-0123456789", kept_to: "Reading" });
    expect(googleCalls.at(-1)).toMatchObject({ url: "https://sheets.googleapis.com/v4/spreadsheets", authorization: "Bearer google-access-token" });
  });

  it("stores no Google token in readable form", async () => {
    await signIn();
    const everything = [...store.entries()].flat().join("\n");
    expect(everything).not.toContain("google-refresh-token");
    expect(everything).not.toContain("google-access-token");
    expect(store.has("connector:refresh:google-user-1")).toBe(true);
  });

  it("refuses a second Google account on the same deployment", async () => {
    expect((await signIn()).back.status).toBe(302);
    googleSubject = "google-user-2";
    const second = await signIn();
    expect(second.back.status).toBe(403);
    expect(store.has("connector:refresh:google-user-2")).toBe(false);
  });

  describe("groups and keys", () => {
    it("asks for a sign-in before showing anything, and grants nothing new when signing in", async () => {
      await signIn();
      const page = await send("/manage");
      expect(await page.text()).toContain("Sign in to manage this connector");
      const { googleUrl, back } = await ownerSession();
      expect(googleUrl.searchParams.get("scope")).toBe("openid");
      expect(back.status).toBe(302);
      expect(back.headers.get("Location")).toBe("/manage");
    });

    it("refuses the manage page to any Google account but the connected one", async () => {
      await signIn();
      googleSubject = "google-user-2";
      const { back, jar } = await ownerSession();
      expect(back.status).toBe(403);
      expect(await (await send("/manage", { headers: { Cookie: cookieHeader(jar) } })).text()).toContain("Sign in to manage");
    });

    it("shows a new key once, with what it is and is not, and keeps only its fingerprint", async () => {
      await signIn();
      const { jar } = await ownerSession();
      const { html, key } = await makeGroup(jar, "Reading");
      expect(key).toMatch(/^sheets-key-/);
      expect(html).toContain("It is shown once");
      expect(html).toContain("not what keeps other people out");
      expect(html).toContain("never save it to memory");
      expect([...store.values()].join("\n")).not.toContain(key);
      const manage = await (await send("/manage", { headers: { Cookie: cookieHeader(jar) } })).text();
      expect(manage).toContain("Reading");
      expect(manage).not.toContain(key);
      expect(manage).toContain("not a limit Google enforces");
      expect(manage).not.toContain("Google could not be reached");
    });

    it("keeps each key to its own group's sheets", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const a = await makeGroup(jar, "Project A");
      const b = await makeGroup(jar, "Project B");
      const made = JSON.parse((await call("create_sheet", { project_key: a.key, title: "A's log" })).text);
      reachableSheets.set(made.spreadsheetId, "A's log");

      expect((await call("read_sheet", { project_key: a.key, spreadsheet_id: made.spreadsheetId })).isError).toBe(false);
      const fromB = await call("read_sheet", { project_key: b.key, spreadsheet_id: made.spreadsheetId });
      expect(fromB.isError).toBe(true);
      expect(fromB.text).toContain("cannot reach that sheet");
      const noKey = await call("read_sheet", { spreadsheet_id: made.spreadsheetId });
      expect(noKey.isError).toBe(true);
      expect(noKey.text).toContain("cannot reach that sheet");
      expect(JSON.parse((await call("list_sheets", {})).text).sheets).toEqual([]);
    });

    it("lets a chat with no key use a sheet the owner opened to any chat, and nothing else", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const a = await makeGroup(jar, "Project A");
      const made = JSON.parse((await call("create_sheet", { project_key: a.key, title: "A's log" })).text);
      reachableSheets.set(made.spreadsheetId, "A's log");
      expect((await call("read_sheet", { spreadsheet_id: made.spreadsheetId })).isError).toBe(true);

      const manage = await (await send("/manage", { headers: { Cookie: cookieHeader(jar) } })).text();
      expect(manage).toContain("Any chat");
      const moved = await send("/manage/sheets", form(jar, { sheet: made.spreadsheetId, group: "open" }));
      expect(moved.status).toBe(303);
      expect((await call("read_sheet", { spreadsheet_id: made.spreadsheetId })).isError).toBe(false);
      expect(JSON.parse((await call("list_sheets", {})).text).sheets[0]).toMatchObject({ title: "A's log", where: "Any chat" });
    });

    it("cuts off the old key when a group's key is replaced", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const { key } = await makeGroup(jar, "Project A");
      const groupId = /name="group" value="([^"]+)"/.exec(await (await send("/manage", { headers: { Cookie: cookieHeader(jar) } })).text())?.[1] ?? "";
      const replaced = await (await send("/manage/key", form(jar, { group: groupId }))).text();
      const newKey = /sheets-key-[A-Za-z0-9_-]+/.exec(replaced)?.[0] ?? "";
      expect(newKey).not.toBe(key);
      expect((await call("list_sheets", { project_key: key })).text).toContain("project key is not valid");
      expect((await call("list_sheets", { project_key: newKey })).isError).toBe(false);
    });

    it("refuses a change posted from another site, or without a session", async () => {
      await signIn();
      const { jar } = await ownerSession();
      const foreign = await send("/manage/groups", { ...form(jar, { name: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", Cookie: cookieHeader(jar) } });
      expect(foreign.status).toBe(403);
      expect((await send("/manage/groups", form(new Map(), { name: "x" }))).status).toBe(401);
    });
  });

  describe("handing over an existing sheet", () => {
    /** Signs in, makes a group, and presses the button on the pick page. */
    async function startPick() {
      const call = await claude();
      const { jar } = await ownerSession();
      const { key } = await makeGroup(jar, "Budget project");
      const page = await (await send("/pick", { headers: { Cookie: cookieHeader(jar) } })).text();
      const groupId = /<option value="([^"]+)"/.exec(page)?.[1] ?? "";
      const started = await send("/pick", form(jar, { group: groupId, decision: "pick" }));
      cookiesFrom(started, jar);
      const googleUrl = new URL(started.headers.get("Location") ?? "https://missing.example");
      return { call, key, page, started, googleUrl, jar, state: googleUrl.searchParams.get("state") ?? "" };
    }
    const comeBack = (state: string, jar: Map<string, string>, extra: string) =>
      send(`/callback?state=${encodeURIComponent(state)}&${extra}`, { headers: { Cookie: cookieHeader(jar) } });

    it("asks for a sign-in first, then states the delete limit on the pick page", async () => {
      expect(await (await send("/pick")).text()).toContain("Sign in to manage this connector");
      const { page } = await startPick();
      expect(page).toContain("not a limit Google enforces");
      expect(page).toContain("Budget project");
    });

    it("sends the browser to Google's picker asking for per-file access alone", async () => {
      const { started, googleUrl } = await startPick();
      expect(started.status).toBe(302);
      expect(googleUrl.searchParams.get("scope")).toBe(DRIVE_FILE);
      expect(googleUrl.searchParams.get("trigger_onepick")).toBe("true");
      expect(googleUrl.searchParams.get("prompt")).toBe("consent");
      expect(googleUrl.searchParams.get("access_type")).toBe("online");
      expect(googleUrl.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/callback`);
    });

    it("adds a picked sheet to the chosen group, where that group's key can read it", async () => {
      const { call, key, state, jar } = await startPick();
      reachableSheets.set("picked-sheet-id-0123456789", "Budget <2026>");
      const done = await comeBack(state, jar, "code=pick-code&picked_file_ids=picked-sheet-id-0123456789");
      expect(done.status).toBe(200);
      const html = await done.text();
      expect(html).toContain("Sheets added");
      expect(html).toContain("Budget &#60;2026&#62;");
      expect(html).toContain("Budget project");
      expect(html).toContain("not a limit Google enforces");
      expect((await call("read_sheet", { project_key: key, spreadsheet_id: "picked-sheet-id-0123456789" })).isError).toBe(false);
    });

    it("can add a picked sheet to any chat instead of a group", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const started = await send("/pick", form(jar, { group: "open", decision: "pick" }));
      cookiesFrom(started, jar);
      const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
      reachableSheets.set("picked-sheet-id-0123456789", "Shared notes");
      const html = await (await comeBack(state, jar, "code=pick-code&picked_file_ids=picked-sheet-id-0123456789")).text();
      expect(html).toContain("from any chat on your account");
      expect((await call("read_sheet", { spreadsheet_id: "picked-sheet-id-0123456789" })).isError).toBe(false);
    });

    it("reports a sheet picked with a different Google account as not added", async () => {
      const { call, key, state, jar } = await startPick();
      const done = await comeBack(state, jar, "code=pick-code&picked_file_ids=someone-elses-sheet-0123456789");
      const html = await done.text();
      expect(html).toContain("Nothing was added");
      expect(html).toContain("1 picked file was not added");
      expect((await call("read_sheet", { project_key: key, spreadsheet_id: "someone-elses-sheet-0123456789" })).isError).toBe(true);
    });

    it("keeps no Google token from a pick", async () => {
      const { state, jar } = await startPick();
      reachableSheets.set("picked-sheet-id-0123456789", "Budget");
      const before = [...store.keys()].filter((k) => k.startsWith("connector:refresh") || k.startsWith("connector:access")).sort();
      await comeBack(state, jar, "code=pick-code&picked_file_ids=picked-sheet-id-0123456789");
      const after = [...store.keys()].filter((k) => k.startsWith("connector:refresh") || k.startsWith("connector:access")).sort();
      expect(after).toEqual(before);
    });

    it("refuses a pick that comes back to a different browser, or twice", async () => {
      const { state, jar } = await startPick();
      expect((await comeBack(state, new Map(), "code=pick-code")).status).toBe(400);
      expect((await comeBack(state, jar, "code=pick-code")).status).toBe(200);
      expect((await comeBack(state, jar, "code=pick-code")).status).toBe(400);
    });

    it("refuses to start a pick from another site, or without a session", async () => {
      await signIn();
      const { jar } = await ownerSession();
      const foreign = await send("/pick", { method: "POST", headers: { Origin: "https://evil.example", Cookie: cookieHeader(jar) }, body: "decision=pick" });
      expect(foreign.status).toBe(403);
      expect((await send("/pick", form(new Map(), { group: "x" }))).status).toBe(401);
    });
  });

  describe("the catalog", () => {
    const CATALOG = "catalog-sheet-id-0123456789";
    const rows = () => (writtenCells.get(CATALOG) ?? []) as string[][];

    it("is created only when the owner asks, lists every sheet with where it is, and starts out of every chat's reach", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const { key } = await makeGroup(jar, "Reading");
      await call("create_sheet", { project_key: key, title: "Reading log" });
      expect(reachableSheets.has(CATALOG)).toBe(false);

      expect((await send("/manage/catalog", form(jar, {}))).status).toBe(303);
      expect(rows()[0]!.slice(0, 7)).toEqual(["Title", "Link", "Where", "Created", "Last changed", "Notes", "Sheet id"]);
      expect(rows()[1]!.slice(0, 3)).toEqual(["Reading log", "https://docs.google.com/spreadsheets/d/new-sheet-id-0123456789/edit", "Reading"]);
      expect(rows().some((r) => r[6] === CATALOG)).toBe(false);

      expect((await call("read_sheet", { spreadsheet_id: CATALOG })).isError).toBe(true);
      expect((await call("read_sheet", { project_key: key, spreadsheet_id: CATALOG })).isError).toBe(true);
      const manage = await (await send("/manage", { headers: { Cookie: cookieHeader(jar) } })).text();
      expect(manage).toContain("(the catalog)");
      expect(manage).toContain("Open the catalog in Google Sheets");
    });

    it("follows a sheet when it is moved, and keeps a note the owner wrote", async () => {
      const call = await claude();
      const { jar } = await ownerSession();
      const { key } = await makeGroup(jar, "Reading");
      await call("create_sheet", { project_key: key, title: "Reading log" });
      await send("/manage/catalog", form(jar, {}));
      const edited = rows().map((r) => [...r]);
      edited[1]![5] = "Books finished, one row each.";
      writtenCells.set(CATALOG, edited);

      await send("/manage/sheets", form(jar, { sheet: "new-sheet-id-0123456789", group: "open" }));
      expect(rows()[1]![2]).toBe("Any chat");
      expect(rows()[1]![5]).toBe("Books finished, one row each.");
    });

    it("records the purpose Claude gives when it creates a sheet", async () => {
      const waiting: Promise<unknown>[] = [];
      (ctx as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil = (p) => void waiting.push(p);
      const call = await claude();
      const { jar } = await ownerSession();
      await send("/manage/catalog", form(jar, {}));
      await call("create_sheet", { title: "Reading log", purpose: "Books read this year." });
      await Promise.all(waiting);
      expect([rows()[1]![0], rows()[1]![2], rows()[1]![5]]).toEqual(["Reading log", "Any chat", "Books read this year."]);
    });
  });

  it("serves a home page that says what it is and links to a privacy policy on the same site", async () => {
    const home = await (await send("/")).text();
    expect(home).toContain("holding access only to the");
    expect(home).toContain('href="/privacy"');
    const privacy = await send("/privacy");
    expect(privacy.status).toBe(200);
    const text = await privacy.text();
    expect(text).toContain("does not store the contents of any sheet");
    expect(text).toContain("not a limit Google enforces");
  });

  it("refuses the connector endpoint without a token", async () => {
    const response = await send("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });
});
