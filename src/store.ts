import { decrypt, encrypt } from "./crypto";
import type { AppEnv } from "./env";
import { type Fetcher, refreshAccessToken } from "./google";

/**
 * What this Worker keeps in KV, beside what the OAuth library keeps. Every Google token
 * is encrypted under TOKEN_ENCRYPTION_KEY before it is written.
 */
const OWNER_KEY = "connector:owner";
const refreshKey = (sub: string) => `connector:refresh:${sub}`;
const accessKey = (sub: string) => `connector:access:${sub}`;

/**
 * A deployment serves one Google account: the first one to sign in. Returns false when
 * a different account already holds it.
 */
export async function claimDeployment(env: AppEnv, sub: string): Promise<boolean> {
  const owner = await env.OAUTH_KV.get(OWNER_KEY);
  if (owner === null) {
    await env.OAUTH_KV.put(OWNER_KEY, sub);
    return true;
  }
  return owner === sub;
}

/** The Google account this deployment serves, or null before anyone has connected. */
export function getDeploymentOwner(env: AppEnv): Promise<string | null> {
  return env.OAUTH_KV.get(OWNER_KEY);
}

const pickKey = (stateHash: string) => `connector:pick:${stateHash}`;

/** Remembers a pick that has been sent to Google, for ten minutes, sealed like a token. */
export async function savePick(env: AppEnv, stateHash: string, verifier: string): Promise<void> {
  await env.OAUTH_KV.put(pickKey(stateHash), await encrypt(env.TOKEN_ENCRYPTION_KEY, verifier, pickKey(stateHash)), {
    expirationTtl: 600,
  });
}

/** Returns the pick's verifier once, then forgets it. Null if unknown, expired or already used. */
export async function takePick(env: AppEnv, stateHash: string): Promise<string | null> {
  const sealed = await env.OAUTH_KV.get(pickKey(stateHash));
  if (sealed === null) return null;
  await env.OAUTH_KV.delete(pickKey(stateHash));
  return decrypt(env.TOKEN_ENCRYPTION_KEY, sealed, pickKey(stateHash));
}

const sessionKey = (tokenHash: string) => `connector:session:${tokenHash}`;
export const SESSION_SECONDS = 1800;

/** Remembers that a browser signed in as this account, for half an hour. Only a hash of its token is kept. */
export async function saveSession(env: AppEnv, tokenHash: string, sub: string): Promise<void> {
  await env.OAUTH_KV.put(sessionKey(tokenHash), sub, { expirationTtl: SESSION_SECONDS });
}

export function readSession(env: AppEnv, tokenHash: string): Promise<string | null> {
  return env.OAUTH_KV.get(sessionKey(tokenHash));
}

export async function endSession(env: AppEnv, tokenHash: string): Promise<void> {
  await env.OAUTH_KV.delete(sessionKey(tokenHash));
}

export async function saveGoogleAccess(
  env: AppEnv,
  sub: string,
  tokens: { refreshToken: string; accessToken: string; expiresIn: number },
): Promise<void> {
  await env.OAUTH_KV.put(refreshKey(sub), await encrypt(env.TOKEN_ENCRYPTION_KEY, tokens.refreshToken, refreshKey(sub)));
  await cacheAccessToken(env, sub, tokens.accessToken, tokens.expiresIn);
}

async function cacheAccessToken(env: AppEnv, sub: string, accessToken: string, expiresIn: number): Promise<void> {
  // Stop using it five minutes early. KV will not keep anything for under a minute.
  const ttl = Math.max(60, expiresIn - 300);
  await env.OAUTH_KV.put(accessKey(sub), await encrypt(env.TOKEN_ENCRYPTION_KEY, accessToken, accessKey(sub)), {
    expirationTtl: ttl,
  });
}

/** A Google access token for this account, refreshed when the cached one has expired. */
export async function getGoogleAccessToken(env: AppEnv, sub: string, fetcher: Fetcher): Promise<string> {
  const cached = await env.OAUTH_KV.get(accessKey(sub));
  if (cached !== null) return decrypt(env.TOKEN_ENCRYPTION_KEY, cached, accessKey(sub));

  const sealed = await env.OAUTH_KV.get(refreshKey(sub));
  if (sealed === null) {
    throw new Error("No Google access is stored for this account. Reconnect the connector in Claude's settings.");
  }
  const fresh = await refreshAccessToken(fetcher, {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: await decrypt(env.TOKEN_ENCRYPTION_KEY, sealed, refreshKey(sub)),
  });
  await cacheAccessToken(env, sub, fresh.accessToken, fresh.expiresIn);
  return fresh.accessToken;
}
