import { refreshCatalogQuietly } from "./catalog";
import type { AppEnv } from "./env";
import { beginFlow, finishFlow, type PageResponse, postedFromThisSite } from "./flow";
import { createSheetsApi, exchangePickCode, type Fetcher, GoogleError, googlePickUrl } from "./google";
import { assignSheet, isPlace, listGroups, OPEN, OPEN_NAME } from "./groups";
import { messagePage, pickPage, pickResultPage, signInPage } from "./pages";
import { hasOwnerSession } from "./session";
import { getDeploymentOwner, getGoogleAccessToken } from "./store";

/**
 * Handing an existing sheet to the connector. Google's own picker does the choosing, as
 * part of its consent screen, and sends the browser back with the ids that were picked.
 *
 * No Google token from the pick is stored. Google records the grant against the account
 * and this app, so the access stored at sign-in covers the picked sheets from then on.
 * That is also how the account is checked: a sheet picked with some other Google account
 * stays out of reach of the stored access, and is reported as not added.
 *
 * What is stored is which group each picked sheet joins, so only the owner may pick.
 */

export const PICK_STATE_PREFIX = "pick.";
const SHEET_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_PICKED = 50;

const googleFetch: Fetcher = (input, init) => fetch(input, init);
const notFromHere: PageResponse = {
  status: 403,
  body: messagePage("This request did not come from the pick page", "Open the pick page and try again."),
};

/** GET /pick: say what picking does, and the delete limit, before anything goes to Google. */
export async function showPick(request: Request, env: AppEnv): Promise<PageResponse> {
  if (!(await hasOwnerSession(request, env))) return { status: 200, body: signInPage("/pick") };
  return { status: 200, body: pickPage(await listGroups(env)) };
}

/** POST /pick: send the browser to Google's picker, remembering which group was chosen. */
export async function startPick(request: Request, env: AppEnv): Promise<PageResponse> {
  if (!postedFromThisSite(request)) return notFromHere;
  if (!(await hasOwnerSession(request, env))) return { status: 401, body: signInPage("/pick") };
  const groupId = String((await request.formData()).get("group") ?? "");
  if (!(await isPlace(env, groupId))) {
    return { status: 400, body: messagePage("Choose where the sheets go first", "Open the pick page and choose a group, or any chat.") };
  }
  const flow = await beginFlow(env, PICK_STATE_PREFIX, { groupId });
  return {
    status: 302,
    location: googlePickUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: `${new URL(request.url).origin}/callback`,
      state: flow.state,
      codeChallenge: flow.challenge,
    }),
    setCookies: [flow.setCookie],
  };
}

/** GET /callback with a pick's state: add the picked sheets the connected account can reach. */
export async function finishPick(request: Request, env: AppEnv): Promise<PageResponse> {
  const flow = await finishFlow<{ groupId: string }>(request, env);
  if (!flow.ok) {
    return flow.reason === "other_browser"
      ? { status: 400, body: messagePage("This pick was not started in this browser", "Open the pick page and start again.") }
      : {
          status: 400,
          setCookies: flow.clearCookie ? [flow.clearCookie] : [],
          body: messagePage("This pick expired or was already used", "Open the pick page and start again."),
        };
  }
  const clear = [flow.clearCookie];
  if (!(await hasOwnerSession(request, env))) return { status: 401, setCookies: clear, body: signInPage("/pick") };

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return { status: 200, setCookies: clear, body: pickResultPage("", [], 0) };

  try {
    await exchangePickCode(googleFetch, {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${url.origin}/callback`,
      code,
      codeVerifier: flow.verifier,
    });
  } catch (error) {
    const message = error instanceof GoogleError ? error.message : "The pick could not be completed.";
    return { status: 502, setCookies: clear, body: messagePage("The pick did not finish", message) };
  }

  const owner = await getDeploymentOwner(env);
  const openToAll = flow.data.groupId === OPEN;
  const group = openToAll ? { id: OPEN, name: OPEN_NAME } : (await listGroups(env)).find((g) => g.id === flow.data.groupId);
  if (owner === null || !group) {
    return { status: 409, setCookies: clear, body: messagePage("That group no longer exists", "Open the pick page and start again.") };
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
      const { title } = await api.describe(id);
      await assignSheet(env, id, group.id);
      added.push(title);
    } catch {
      notAdded += 1;
    }
  }
  if (added.length) await refreshCatalogQuietly(env, api);
  return { status: 200, setCookies: clear, body: pickResultPage(group.name, added, notAdded, openToAll) };
}
