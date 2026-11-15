import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppEnv, AuthProps } from "./env";
import { createSheetsApi, type Fetcher } from "./google";
import { assignSheet, groupForKey, groupOfSheet, sheetsInGroup } from "./groups";
import { getGoogleAccessToken } from "./store";
import { buildServer } from "./tools";

const googleFetch: Fetcher = (input, init) => fetch(input, init);

/**
 * The connector's endpoint. The OAuth library has already checked the caller's token
 * and hands over the props stored at sign-in. Each request gets a fresh server; nothing
 * is remembered between requests.
 */
export const mcpHandler = {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const sub = (ctx.props as Partial<AuthProps> | undefined)?.sub;
    if (typeof sub !== "string" || sub === "") {
      return new Response("This connection has no signed-in Google account.", { status: 401 });
    }
    const api = createSheetsApi(googleFetch, () => getGoogleAccessToken(env, sub, googleFetch));
    const server = buildServer(api, new URL(request.url).origin, {
      groupForKey: (key) => groupForKey(env, key),
      groupOfSheet: (sheetId) => groupOfSheet(env, sheetId),
      assignSheet: (sheetId, groupId) => assignSheet(env, sheetId, groupId),
      sheetsInGroup: (groupId) => sheetsInGroup(env, groupId),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
