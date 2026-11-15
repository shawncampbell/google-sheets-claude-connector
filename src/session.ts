import type { AppEnv } from "./env";
import { beginFlow, cookie, finishFlow, type PageResponse, randomToken, readCookie, sha256 } from "./flow";
import { exchangeIdentityCode, type Fetcher, GoogleError, googleIdentityUrl } from "./google";
import { messagePage } from "./pages";
import { endSession, getDeploymentOwner, readSession, saveSession, SESSION_SECONDS } from "./store";

/**
 * Signing the owner in to the Worker's own pages. Only the Google account this
 * deployment serves gets a session; anyone else is told so and gets nothing.
 */

export const OWNER_STATE_PREFIX = "owner.";
const SESSION_COOKIE = "__Host-session";
const RETURN_PATHS = new Set(["/manage", "/pick"]);

const googleFetch: Fetcher = (input, init) => fetch(input, init);

/** True when this browser is signed in as the account the deployment serves. */
export async function hasOwnerSession(request: Request, env: AppEnv): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const sub = await readSession(env, await sha256(token));
  return sub !== null && sub === (await getDeploymentOwner(env));
}

export async function startOwnerSignIn(request: Request, env: AppEnv, returnTo: string): Promise<PageResponse> {
  const flow = await beginFlow(env, OWNER_STATE_PREFIX, { returnTo: RETURN_PATHS.has(returnTo) ? returnTo : "/manage" });
  return {
    status: 302,
    location: googleIdentityUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: `${new URL(request.url).origin}/callback`,
      state: flow.state,
      codeChallenge: flow.challenge,
    }),
    setCookies: [flow.setCookie],
  };
}

export async function finishOwnerSignIn(request: Request, env: AppEnv): Promise<PageResponse> {
  const flow = await finishFlow<{ returnTo: string }>(request, env);
  if (!flow.ok) {
    return {
      status: 400,
      setCookies: flow.clearCookie ? [flow.clearCookie] : [],
      body: messagePage("This sign-in could not be matched to this browser", "Open the page again and sign in once more."),
    };
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return { status: 200, setCookies: [flow.clearCookie], body: messagePage("You are not signed in", "The sign-in was cancelled.") };
  }
  let sub: string;
  try {
    sub = await exchangeIdentityCode(googleFetch, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/callback`,
      code,
      codeVerifier: flow.verifier,
    });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "The sign-in could not be completed.";
    return { status: 502, setCookies: [flow.clearCookie], body: messagePage("Sign-in did not finish", message) };
  }
  const owner = await getDeploymentOwner(env);
  if (owner === null) {
    return {
      status: 409,
      setCookies: [flow.clearCookie],
      body: messagePage(
        "Connect the connector in Claude first",
        "Nobody has connected this connector yet. Add it in Claude's connector settings and sign in there, then come back.",
      ),
    };
  }
  if (sub !== owner) {
    return {
      status: 403,
      setCookies: [flow.clearCookie],
      body: messagePage(
        "This connector belongs to another Google account",
        "Sign in with the Google account that is connected in Claude.",
      ),
    };
  }
  const token = randomToken(32);
  await saveSession(env, await sha256(token), sub);
  return {
    status: 302,
    location: RETURN_PATHS.has(flow.data.returnTo) ? flow.data.returnTo : "/manage",
    setCookies: [flow.clearCookie, cookie(SESSION_COOKIE, token, SESSION_SECONDS)],
  };
}

export async function signOut(request: Request, env: AppEnv): Promise<PageResponse> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await endSession(env, await sha256(token));
  return { status: 302, location: "/", setCookies: [cookie(SESSION_COOKIE, "", 0)] };
}
