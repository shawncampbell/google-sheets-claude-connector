import type { AppEnv } from "./env";
import { savePick, takePick } from "./store";

/**
 * What the Worker's own pages share: a response shape, a check that a form was posted
 * from this site, and a way to send a browser to Google and recognise it when it returns.
 */

export interface PageResponse {
  status: number;
  body?: string;
  location?: string;
  setCookies?: string[];
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export const randomToken = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** True when a form post came from one of this site's own pages. */
export function postedFromThisSite(request: Request): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  const self = new URL(request.url).origin;
  return !(fetchSite && fetchSite !== "same-origin") && !(origin && origin !== self);
}

const FLOW_COOKIE = "__Host-flow-";

/**
 * Starts a trip to Google. `prefix` names the kind of trip and is the start of the state
 * Google hands back. `data` is kept sealed for ten minutes and returned once.
 */
export async function beginFlow<T>(
  env: AppEnv,
  prefix: string,
  data: T,
): Promise<{ state: string; verifier: string; challenge: string; setCookie: string }> {
  const state = prefix + randomToken(32);
  const verifier = randomToken(48);
  const stateHash = await sha256(state);
  await savePick(env, stateHash, JSON.stringify({ verifier, data }));
  return {
    state,
    verifier,
    challenge: await sha256(verifier),
    setCookie: cookie(FLOW_COOKIE + stateHash.slice(0, 16), stateHash, 600),
  };
}

export type FinishedFlow<T> =
  | { ok: true; verifier: string; data: T; clearCookie: string }
  | { ok: false; reason: "other_browser" | "expired"; clearCookie?: string };

/** Recognises the browser coming back from Google. Each trip can be finished once. */
export async function finishFlow<T>(request: Request, env: AppEnv): Promise<FinishedFlow<T>> {
  const state = new URL(request.url).searchParams.get("state") ?? "";
  const stateHash = await sha256(state);
  const name = FLOW_COOKIE + stateHash.slice(0, 16);
  if (readCookie(request, name) !== stateHash) return { ok: false, reason: "other_browser" };
  const clearCookie = cookie(name, "", 0);
  const stored = await takePick(env, stateHash);
  if (stored === null) return { ok: false, reason: "expired", clearCookie };
  const { verifier, data } = JSON.parse(stored) as { verifier: string; data: T };
  return { ok: true, verifier, data, clearCookie };
}
