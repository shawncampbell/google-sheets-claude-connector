import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authHandler } from "./auth";
import type { AppEnv } from "./env";
import { mcpHandler } from "./mcp";

/**
 * One Worker that is both the sign-in server Claude talks to and the connector itself.
 * The provider is built from the address the request arrived on, so no deployment's
 * hostname is written anywhere in this repository.
 */
const providers = new Map<string, OAuthProvider<AppEnv>>();

function providerFor(origin: string): OAuthProvider<AppEnv> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<AppEnv>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: authHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: ["sheets", "offline_access"],
      requiredScopes: ["sheets"],
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
};
