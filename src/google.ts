/**
 * Everything this Worker says to Google. There is deliberately no function here that
 * deletes, trashes, shares or moves a file. Do not add one.
 */

export const GOOGLE_SCOPES = ["openid", "https://www.googleapis.com/auth/drive.file"];
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** An error whose message is safe and useful to show to the model or the person. */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly kind: "not_reachable" | "reconnect" | "bad_request" | "unavailable",
  ) {
    super(message);
  }
}

export function googleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // offline + consent makes Google return a refresh token every time.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/**
 * Google's own file picker, shown as part of its consent screen. Google allows only the
 * per-file permission here, with no other scope beside it. `online` means no second
 * lasting token is issued: the access already stored covers whatever is picked.
 */
export function googlePickUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_FILE_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("trigger_onepick", "true");
  url.searchParams.set("allow_multiple", "true");
  url.searchParams.set("mimetypes", SHEET_MIME);
  return url.toString();
}

/** Google asks that the code from a pick be exchanged. The token it returns is not kept. */
export async function exchangePickCode(
  fetcher: Fetcher,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
): Promise<void> {
  const json = await postToken(fetcher, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  if (json.error || !json.access_token) {
    throw new GoogleError("Google did not complete the pick. Please try again.", "unavailable");
  }
}

export interface GoogleSignIn {
  sub: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
}

async function postToken(fetcher: Fetcher, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok && !json.error) json.error = `http_${response.status}`;
  return json;
}

/** Reads the account id out of an ID token that came straight from Google over TLS. */
function subjectFromIdToken(idToken: string, clientId: string): string {
  const payload = idToken.split(".")[1];
  if (!payload) throw new GoogleError("Google's sign-in response was not in the expected form.", "unavailable");
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const claims = JSON.parse(atob(padded)) as { sub?: string; aud?: string; iss?: string };
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!claims.sub || claims.aud !== clientId || !issuerOk) {
    throw new GoogleError("Google's sign-in response was for a different app.", "unavailable");
  }
  return claims.sub;
}

export async function exchangeCode(
  fetcher: Fetcher,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
): Promise<GoogleSignIn> {
  const json = await postToken(fetcher, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  if (json.error || !json.access_token || !json.id_token) {
    throw new GoogleError("Google did not complete the sign-in. Please try connecting again.", "unavailable");
  }
  if (!(json.scope ?? "").split(" ").includes(DRIVE_FILE_SCOPE)) {
    throw new GoogleError(
      "The per-file permission was not granted, so the connector could not do anything. " +
        "Connect again and leave the Google Drive box ticked.",
      "reconnect",
    );
  }
  if (!json.refresh_token) {
    throw new GoogleError("Google did not return lasting access. Please try connecting again.", "reconnect");
  }
  return {
    sub: subjectFromIdToken(json.id_token, input.clientId),
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function refreshAccessToken(
  fetcher: Fetcher,
  input: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<{ accessToken: string; expiresIn: number }> {
  const json = await postToken(fetcher, {
    grant_type: "refresh_token",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
  });
  if (json.error === "invalid_grant") {
    throw new GoogleError(
      "Google no longer accepts this connector's access. The account holder needs to " +
        "disconnect and reconnect the connector in Claude's settings.",
      "reconnect",
    );
  }
  if (json.error || !json.access_token) {
    throw new GoogleError("Google could not be reached just now. Try again in a moment.", "unavailable");
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

const NOT_REACHABLE =
  "This connector cannot reach that sheet. It can reach only sheets it created or sheets " +
  "the account holder picked for it. Check the id, or use list_sheets to see what it can reach.";

/** The calls the tools need. Tests replace this with a fake. */
export interface SheetsApi {
  create(title: string): Promise<{ spreadsheetId: string; url: string; title: string }>;
  list(): Promise<Array<{ spreadsheetId: string; title: string; modifiedTime: string }>>;
  describe(spreadsheetId: string): Promise<{
    spreadsheetId: string;
    title: string;
    url: string;
    tabs: Array<{ title: string; rows: number; columns: number }>;
  }>;
  read(spreadsheetId: string, range: string): Promise<{ range: string; values: unknown[][] }>;
  write(spreadsheetId: string, range: string, values: unknown[][]): Promise<{ updatedRange: string; updatedCells: number }>;
  append(spreadsheetId: string, range: string, values: unknown[][]): Promise<{ updatedRange: string; updatedRows: number }>;
}

export function createSheetsApi(fetcher: Fetcher, getAccessToken: () => Promise<string>): SheetsApi {
  async function call<T>(url: string, init: { method: "GET" | "POST" | "PUT"; body?: unknown }): Promise<T> {
    const token = await getAccessToken();
    const response = await fetcher(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.ok) return (await response.json()) as T;
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message = detail?.error?.message ?? `Google answered ${response.status}.`;
    if (response.status === 403 || response.status === 404) throw new GoogleError(NOT_REACHABLE, "not_reachable");
    if (response.status === 401) {
      throw new GoogleError(
        "Google refused this connector's access. The account holder may need to reconnect it.",
        "reconnect",
      );
    }
    if (response.status === 400) throw new GoogleError(`Google rejected the request: ${message}`, "bad_request");
    throw new GoogleError(`Google could not complete the request: ${message}`, "unavailable");
  }

  const sheet = (id: string) => `${SHEETS_URL}/${encodeURIComponent(id)}`;
  const values = (id: string, range: string) => `${sheet(id)}/values/${encodeURIComponent(range)}`;

  return {
    async create(title) {
      const made = await call<{ spreadsheetId: string; spreadsheetUrl: string; properties: { title: string } }>(
        SHEETS_URL,
        { method: "POST", body: { properties: { title } } },
      );
      return { spreadsheetId: made.spreadsheetId, url: made.spreadsheetUrl, title: made.properties.title };
    },

    async list() {
      const url = new URL(DRIVE_FILES_URL);
      url.searchParams.set("q", `mimeType='${SHEET_MIME}' and trashed=false`);
      url.searchParams.set("fields", "files(id,name,modifiedTime)");
      url.searchParams.set("orderBy", "modifiedTime desc");
      url.searchParams.set("pageSize", "100");
      const found = await call<{ files?: Array<{ id: string; name: string; modifiedTime: string }> }>(
        url.toString(),
        { method: "GET" },
      );
      return (found.files ?? []).map((f) => ({ spreadsheetId: f.id, title: f.name, modifiedTime: f.modifiedTime }));
    },

    async describe(spreadsheetId) {
      const fields = "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(title,gridProperties)";
      const found = await call<{
        spreadsheetId: string;
        spreadsheetUrl: string;
        properties: { title: string };
        sheets?: Array<{ properties: { title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
      }>(`${sheet(spreadsheetId)}?fields=${encodeURIComponent(fields)}`, { method: "GET" });
      return {
        spreadsheetId: found.spreadsheetId,
        title: found.properties.title,
        url: found.spreadsheetUrl,
        tabs: (found.sheets ?? []).map((s) => ({
          title: s.properties.title,
          rows: s.properties.gridProperties?.rowCount ?? 0,
          columns: s.properties.gridProperties?.columnCount ?? 0,
        })),
      };
    },

    async read(spreadsheetId, range) {
      const found = await call<{ range: string; values?: unknown[][] }>(values(spreadsheetId, range), {
        method: "GET",
      });
      return { range: found.range, values: found.values ?? [] };
    },

    async write(spreadsheetId, range, rows) {
      const done = await call<{ updatedRange: string; updatedCells?: number }>(
        `${values(spreadsheetId, range)}?valueInputOption=USER_ENTERED`,
        { method: "PUT", body: { values: rows } },
      );
      return { updatedRange: done.updatedRange, updatedCells: done.updatedCells ?? 0 };
    },

    async append(spreadsheetId, range, rows) {
      const done = await call<{ updates?: { updatedRange?: string; updatedRows?: number } }>(
        `${values(spreadsheetId, range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: { values: rows } },
      );
      return { updatedRange: done.updates?.updatedRange ?? range, updatedRows: done.updates?.updatedRows ?? 0 };
    },
  };
}
