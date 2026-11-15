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

  const send = (path: string, init?: RequestInit) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);

  beforeEach(() => {
    const { data, kv } = fakeKv();
    store = data;
    googleCalls = [];
    googleSubject = "google-user-1";
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
        return Response.json({ spreadsheetId: "new-sheet-id-0123456789", spreadsheetUrl: "https://example.com/sheet", properties: { title: "Reading log" } });
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

  it("shows the delete limit before anything is sent to Google", async () => {
    const { consent, consentHtml } = await signIn();
    expect(consent.status).toBe(200);
    expect(consentHtml).toContain("not a limit Google enforces");
    expect(consentHtml).toContain("claude.example");
    expect(consent.headers.get("X-Frame-Options")).toBe("DENY");
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
    expect(tools.map((t) => t.name).sort()).toEqual(["append_rows", "create_sheet", "list_sheets", "read_sheet", "write_range"]);

    const created = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_sheet", arguments: { title: "Reading log" } } });
    const result = ((await created.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }).result;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).spreadsheetId).toBe("new-sheet-id-0123456789");
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

  it("refuses the connector endpoint without a token", async () => {
    const response = await send("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });
});
