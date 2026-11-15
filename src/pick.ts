import type { AppEnv } from "./env";
import { createSheetsApi, exchangePickCode, type Fetcher, GoogleError, googlePickUrl } from "./google";
import { messagePage, pickPage, pickResultPage } from "./pages";
import { getDeploymentOwner, getGoogleAccessToken, savePick, takePick } from "./store";

/**
 * Handing an existing sheet to the connector. Google's own picker does the choosing, as
 * part of its consent screen, and sends the browser back with the ids that were picked.
 *
 * Nothing from the pick is stored. Google records the grant against the account and this
 * app, so the access stored at sign-in covers the picked sheets from then on. That is also
 * how the account is checked: a sheet picked with some other Google account stays out of
 * reach of the stored access, and is reported as not added.
 */

export const PICK_STATE_PREFIX = "pick.";
const COOKIE_PREFIX = "__Host-pick-";
const SHEET_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_PICKED = 50;

const googleFetch: Fetcher = (input, init) => fetch(input, init);

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

export interface PickResponse {
  status: number;
  body?: string;
  location?: string;
  setCookie?: string;
}

/** GET /pick: say what picking does, and the delete limit, before anything goes to Google. */
export function showPick(): PickResponse {
  return { status: 200, body: pickPage() };
}

/** POST /pick: send the browser to Google's picker, remembering that this browser asked. */
export async function startPick(request: Request, env: AppEnv): Promise<PickResponse> {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  const self = new URL(request.url).origin;
  if ((fetchSite && fetchSite !== "same-origin") || (origin && origin !== self)) {
    return { status: 403, body: messagePage("This request did not come from the pick page", "Open the pick page and try again.") };
  }
  const state = PICK_STATE_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const stateHash = await sha256(state);
  await savePick(env, stateHash, verifier);
  return {
    status: 302,
    location: googlePickUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: `${self}/callback`,
      state,
      codeChallenge: await sha256(verifier),
    }),
    setCookie: cookie(COOKIE_PREFIX + stateHash.slice(0, 16), stateHash, 600),
  };
}

/** GET /callback with a pick's state: check which of the picked sheets are now reachable. */
export async function finishPick(request: Request, env: AppEnv): Promise<PickResponse> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const stateHash = await sha256(state);
  const cookieName = COOKIE_PREFIX + stateHash.slice(0, 16);
  const clear = cookie(cookieName, "", 0);

  if (readCookie(request, cookieName) !== stateHash) {
    return { status: 400, body: messagePage("This pick was not started in this browser", "Open the pick page and start again.") };
  }
  const verifier = await takePick(env, stateHash);
  if (verifier === null) {
    return { status: 400, setCookie: clear, body: messagePage("This pick expired or was already used", "Open the pick page and start again.") };
  }

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return { status: 200, setCookie: clear, body: pickResultPage([], 0) };
  }

  try {
    await exchangePickCode(googleFetch, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/callback`,
      code,
      codeVerifier: verifier,
    });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "The pick could not be completed.";
    return { status: 502, setCookie: clear, body: messagePage("The pick did not finish", message) };
  }

  const owner = await getDeploymentOwner(env);
  if (owner === null) {
    return {
      status: 409,
      setCookie: clear,
      body: messagePage(
        "Connect the connector in Claude first",
        "Nobody has connected this connector yet, so there is no account to give the sheet to. " +
          "Add it in Claude's connector settings, sign in, then pick again.",
      ),
    };
  }

  const picked = (url.searchParams.get("picked_file_ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .slice(0, MAX_PICKED);
  const api = createSheetsApi(googleFetch, () => getGoogleAccessToken(env, owner, googleFetch));
  const added: string[] = [];
  let notAdded = 0;
  for (const id of picked) {
    if (!SHEET_ID.test(id)) {
      notAdded += 1;
      continue;
    }
    try {
      added.push((await api.describe(id)).title);
    } catch {
      notAdded += 1;
    }
  }
  return { status: 200, setCookie: clear, body: pickResultPage(added, notAdded) };
}
