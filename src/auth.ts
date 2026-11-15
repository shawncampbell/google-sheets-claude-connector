import { AuthorizationError, authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import type { AppEnv, AuthProps } from "./env";
import { exchangeCode, GoogleError, googleAuthorizeUrl } from "./google";
import { consentPage, homePage, htmlHeaders, messagePage } from "./pages";
import { claimDeployment, saveGoogleAccess } from "./store";

function html(body: string, status = 200, headers = new Headers()): Response {
  return new Response(body, { status, headers: htmlHeaders(headers) });
}

function redirect(location: string, headers = new Headers()): Response {
  headers.set("Location", location);
  return new Response(null, { status: 302, headers });
}

function isConfigured(env: AppEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const callbackUrl = (request: Request) => `${new URL(request.url).origin}/callback`;

/** GET /authorize: say what is about to be granted, before anything goes to Google. */
async function showConsent(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  return html(consentPage(details, consent.handle), 200, consent.headers);
}

/** POST /authorize: the person agreed, so hand them to Google. */
async function startGoogleSignIn(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  return redirect(
    googleAuthorizeUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: callbackUrl(request),
      state,
      codeChallenge: await s256(verifier),
    }),
    headers,
  );
}

/** GET /callback: Google sent the person back. Store their access and finish. */
async function finishGoogleSignIn(request: Request, env: AppEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (params.get("error") || !code) {
    return redirect(authorizationErrorRedirect(original, "access_denied"), headers);
  }

  let signIn;
  try {
    signIn = await exchangeCode((input, init) => fetch(input, init), {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: callbackUrl(request),
      code,
      codeVerifier: data.verifier,
    });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "The sign-in could not be completed.";
    return html(messagePage("Sign-in did not finish", message), 502, headers);
  }

  if (!(await claimDeployment(env, signIn.sub))) {
    return html(
      messagePage(
        "This connector belongs to another Google account",
        "This deployment serves the first Google account that signed in to it, and that was a different account. " +
          "Sign in with that account, or deploy your own copy of the connector.",
      ),
      403,
      headers,
    );
  }

  await saveGoogleAccess(env, signIn.sub, signIn);
  const props: AuthProps = { sub: signIn.sub };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: signIn.sub,
    metadata: {},
    scope: original.scope,
    props,
  });
  return redirect(redirectTo, headers);
}

/** Everything that is not the connector endpoint or an endpoint the OAuth library owns. */
export const authHandler = {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/" && request.method === "GET") return html(homePage());
      if (pathname === "/authorize" || pathname === "/callback") {
        if (!isConfigured(env)) {
          return html(
            messagePage(
              "This connector is not set up yet",
              "Its Google client id, client secret and encryption key have not all been added as Worker secrets. " +
                "The install runbook says how.",
            ),
            503,
          );
        }
        if (pathname === "/authorize" && request.method === "GET") return await showConsent(request, env);
        if (pathname === "/authorize" && request.method === "POST") return await startGoogleSignIn(request, env);
        if (pathname === "/callback" && request.method === "GET") return await finishGoogleSignIn(request, env);
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        if (error.redirectTo) return redirect(error.redirectTo);
        return html(messagePage("This sign-in link is not valid", error.description), 400);
      }
      console.error("sign-in failed", error instanceof Error ? error.name : "unknown");
      return html(messagePage("Something went wrong", "The sign-in could not be completed. Please try connecting again."), 500);
    }
  },
};
