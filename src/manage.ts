import { createCatalog, getCatalogId, refreshCatalog, refreshCatalogQuietly, sheetLink } from "./catalog";
import type { AppEnv } from "./env";
import { type PageResponse, postedFromThisSite } from "./flow";
import { createSheetsApi, type Fetcher } from "./google";
import { assignSheet, cleanGroupName, createGroup, groupOfSheet, isPlace, listGroups, MAX_GROUPS, OPEN, replaceKey } from "./groups";
import { keyPage, managePage, messagePage, signInPage } from "./pages";
import { hasOwnerSession } from "./session";
import { getDeploymentOwner, getGoogleAccessToken } from "./store";

/**
 * The owner's page for groups and keys (decisions/0002). Every action here needs the
 * owner's session, and every change is a form posted from this site.
 */

const googleFetch: Fetcher = (input, init) => fetch(input, init);
const SHEET_ID = /^[A-Za-z0-9_-]{10,200}$/;

const back: PageResponse = { status: 303, location: "/manage" };

async function ownerApi(env: AppEnv) {
  const owner = await getDeploymentOwner(env);
  return owner === null ? null : createSheetsApi(googleFetch, () => getGoogleAccessToken(env, owner, googleFetch));
}

async function guard(request: Request, env: AppEnv, isPost: boolean): Promise<PageResponse | null> {
  if (isPost && !postedFromThisSite(request)) {
    return { status: 403, body: messagePage("This request did not come from the manage page", "Open the manage page and try again.") };
  }
  if (!(await hasOwnerSession(request, env))) return { status: isPost ? 401 : 200, body: signInPage("/manage") };
  return null;
}

/** GET /manage: every group with its sheets, and the sheets that are in no group yet. */
export async function showManage(request: Request, env: AppEnv): Promise<PageResponse> {
  const refused = await guard(request, env, false);
  if (refused) return refused;
  const owner = await getDeploymentOwner(env);
  const groups = await listGroups(env);
  let sheets: Array<{ spreadsheetId: string; title: string }> = [];
  let googleFailed = false;
  try {
    if (owner !== null) sheets = await createSheetsApi(googleFetch, () => getGoogleAccessToken(env, owner, googleFetch)).list();
  } catch {
    googleFailed = true;
  }
  const catalogId = await getCatalogId(env);
  const placed = await Promise.all(
    sheets.map(async (s) => ({
      ...s,
      title: s.spreadsheetId === catalogId ? `${s.title} (the catalog)` : s.title,
      groupId: await groupOfSheet(env, s.spreadsheetId),
    })),
  );
  return {
    status: 200,
    body: managePage({
      groups: groups.map((g) => ({ id: g.id, name: g.name, sheets: placed.filter((s) => s.groupId === g.id) })),
      open: placed.filter((s) => s.groupId === OPEN),
      unplaced: placed.filter((s) => s.groupId !== OPEN && !groups.some((g) => g.id === s.groupId)),
      googleFailed,
      catalogLink: catalogId === null ? null : sheetLink(catalogId),
      canAddGroup: groups.length < MAX_GROUPS,
    }),
  };
}

/** POST /manage/groups: make a group and show its key, once. */
export async function addGroup(request: Request, env: AppEnv): Promise<PageResponse> {
  const refused = await guard(request, env, true);
  if (refused) return refused;
  const name = cleanGroupName(String((await request.formData()).get("name") ?? ""));
  if (name === null) return { status: 400, body: messagePage("That name will not work", "Give the group a name of 1 to 60 characters.") };
  const made = await createGroup(env, name);
  if (made === null) return { status: 400, body: messagePage("No more groups can be added", `A deployment holds at most ${MAX_GROUPS} groups.`) };
  return { status: 200, body: keyPage(made.group.name, made.key, false) };
}

/** POST /manage/key: replace a group's key and show the new one, once. */
export async function newKey(request: Request, env: AppEnv): Promise<PageResponse> {
  const refused = await guard(request, env, true);
  if (refused) return refused;
  const made = await replaceKey(env, String((await request.formData()).get("group") ?? ""));
  if (made === null) return back;
  return { status: 200, body: keyPage(made.group.name, made.key, true) };
}

/** POST /manage/sheets: put a sheet in a group, moving it out of any other. */
export async function placeSheet(request: Request, env: AppEnv): Promise<PageResponse> {
  const refused = await guard(request, env, true);
  if (refused) return refused;
  const form = await request.formData();
  const sheetId = String(form.get("sheet") ?? "");
  const groupId = String(form.get("group") ?? "");
  if (SHEET_ID.test(sheetId) && (await isPlace(env, groupId))) {
    await assignSheet(env, sheetId, groupId);
    const api = await ownerApi(env);
    if (api) await refreshCatalogQuietly(env, api);
  }
  return back;
}

/** POST /manage/catalog: create the catalog sheet if there is none, and bring it up to date. */
export async function updateCatalog(request: Request, env: AppEnv): Promise<PageResponse> {
  const refused = await guard(request, env, true);
  if (refused) return refused;
  const api = await ownerApi(env);
  if (api === null) return back;
  try {
    if ((await getCatalogId(env)) === null) await createCatalog(env, api);
    else if (!(await refreshCatalog(env, api))) return back;
  } catch {
    return { status: 502, body: messagePage("The catalog could not be updated", "Google could not be reached, or the catalog sheet is gone. Try again in a moment.") };
  }
  return back;
}
