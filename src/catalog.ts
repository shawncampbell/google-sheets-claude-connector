import type { AppEnv } from "./env";
import type { SheetsApi } from "./google";
import { groupOfSheet, listGroups, OPEN, OPEN_NAME } from "./groups";

/**
 * The catalog: one sheet in the owner's Drive that lists every sheet the connector can
 * reach and where each one is (decisions/0004). The connector keeps it; no chat can
 * write to it. It is rewritten whole from what Google and this server know, so it
 * corrects itself. Only the Notes column is carried over, because notes live in the
 * sheet and nowhere on this server.
 *
 * It names every Project's sheets in one place, so it starts out reachable by no chat.
 */

const CATALOG_KEY = "connector:catalog";
export const CATALOG_TITLE = "Google Sheets Claude Connector Catalog";
const HEADER = ["Title", "Link", "Where", "Created", "Last changed", "Notes", "Sheet id"];
const NOTES = 5;
const ID = 6;
const MAX_NOTE = 500;

export const getCatalogId = (env: AppEnv) => env.OAUTH_KV.get(CATALOG_KEY);

export const sheetLink = (spreadsheetId: string) => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

/** Creates the catalog sheet if there is none, and fills it in. Returns its id. */
export async function createCatalog(env: AppEnv, api: SheetsApi): Promise<string> {
  const existing = await getCatalogId(env);
  if (existing !== null) return existing;
  const made = await api.create(CATALOG_TITLE);
  await env.OAUTH_KV.put(CATALOG_KEY, made.spreadsheetId);
  await refreshCatalog(env, api);
  return made.spreadsheetId;
}

/**
 * Rewrites the catalog. `newNotes` sets the note for sheets that have none yet, which is
 * how the purpose Claude gives when creating a sheet gets recorded. Does nothing when
 * there is no catalog.
 */
export async function refreshCatalog(env: AppEnv, api: SheetsApi, newNotes = new Map<string, string>()): Promise<boolean> {
  const catalogId = await getCatalogId(env);
  if (catalogId === null) return false;

  const notes = new Map<string, string>();
  for (const row of (await api.read(catalogId, "A2:G")).values) {
    const id = row[ID];
    const note = row[NOTES];
    if (typeof id === "string" && id !== "" && typeof note === "string" && note !== "") notes.set(id, note);
  }
  for (const [id, note] of newNotes) if (!notes.has(id) && note.trim() !== "") notes.set(id, note.trim().slice(0, MAX_NOTE));

  const groups = new Map((await listGroups(env)).map((g) => [g.id, g.name]));
  const sheets = (await api.list()).filter((s) => s.spreadsheetId !== catalogId);
  const rows = await Promise.all(
    sheets.map(async (s) => {
      const place = await groupOfSheet(env, s.spreadsheetId);
      const where = place === OPEN ? OPEN_NAME : place !== null && groups.has(place) ? groups.get(place)! : "Not placed";
      return [s.title, sheetLink(s.spreadsheetId), where, s.createdTime, s.modifiedTime, notes.get(s.spreadsheetId) ?? "", s.spreadsheetId];
    }),
  );
  rows.sort((a, b) => String(a[2]).localeCompare(String(b[2])) || String(a[0]).localeCompare(String(b[0])));

  const stamp = `Kept by the connector. Updated ${new Date().toISOString()}. Edit only the Notes column; the rest is rewritten.`;
  await api.clearValues(catalogId, "A:H");
  await api.writeRaw(catalogId, "A1", [[...HEADER, stamp], ...rows]);
  return true;
}

/** Refreshes the catalog and swallows any failure: keeping it current must never break the action that caused it. */
export async function refreshCatalogQuietly(env: AppEnv, api: SheetsApi, newNotes?: Map<string, string>): Promise<void> {
  try {
    await refreshCatalog(env, api, newNotes);
  } catch (error) {
    console.error("catalog refresh failed", error instanceof Error ? error.name : "unknown");
  }
}
