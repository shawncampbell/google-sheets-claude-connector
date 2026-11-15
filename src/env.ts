import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** Everything the Worker reads from its environment. Values are set in the dashboard. */
export interface AppEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 32 random bytes, base64. Encrypts every Google token before it is stored. */
  TOKEN_ENCRYPTION_KEY: string;
}

/** What the sign-in attaches to each Claude connection. No Google token is in here. */
export interface AuthProps extends Record<string, unknown> {
  /** Google's opaque id for the signed-in account. */
  sub: string;
}
