import type { AppEnv } from "./env";
import { randomToken, sha256 } from "./flow";

/**
 * Groups of sheets, and the key that reaches each one (decisions/0002). A sheet belongs
 * to at most one group. A key is shown to the owner once; only its hash is kept here.
 *
 * A key is not what keeps outsiders away: a request must also come through the owner's
 * signed-in connector. Its one job is to tell the owner's own Claude Projects apart.
 */

export interface Group {
  id: string;
  name: string;
  keyHash: string;
  createdAt: string;
}

const GROUPS_KEY = "connector:groups";
const sheetKey = (sheetId: string) => `connector:sheet:${sheetId}`;
const memberPrefix = (groupId: string) => `connector:member:${groupId}:`;

export const MAX_GROUPS = 50;
export const KEY_PREFIX = "sheets-key-";

export async function listGroups(env: AppEnv): Promise<Group[]> {
  const stored = await env.OAUTH_KV.get(GROUPS_KEY);
  return stored === null ? [] : (JSON.parse(stored) as Group[]);
}

const saveGroups = (env: AppEnv, groups: Group[]) => env.OAUTH_KV.put(GROUPS_KEY, JSON.stringify(groups));

/** A cleaned group name, or null when it is empty or too long. */
export function cleanGroupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

const newKey = () => KEY_PREFIX + randomToken(24);

/** Creates a group and returns its key. This is the only time the key exists in readable form here. */
export async function createGroup(env: AppEnv, name: string): Promise<{ group: Group; key: string } | null> {
  const groups = await listGroups(env);
  if (groups.length >= MAX_GROUPS) return null;
  const key = newKey();
  const group: Group = { id: randomToken(9), name, keyHash: await sha256(key), createdAt: new Date().toISOString() };
  await saveGroups(env, [...groups, group]);
  return { group, key };
}

/** Gives a group a new key. Every chat holding the old one is cut off. */
export async function replaceKey(env: AppEnv, groupId: string): Promise<{ group: Group; key: string } | null> {
  const groups = await listGroups(env);
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  const key = newKey();
  group.keyHash = await sha256(key);
  await saveGroups(env, groups);
  return { group, key };
}

/** The group a key reaches, or null for a key that is missing, wrong or replaced. */
export async function groupForKey(env: AppEnv, key: string | undefined): Promise<Group | null> {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 200) return null;
  const hash = await sha256(key);
  return (await listGroups(env)).find((g) => g.keyHash === hash) ?? null;
}

export function groupOfSheet(env: AppEnv, sheetId: string): Promise<string | null> {
  return env.OAUTH_KV.get(sheetKey(sheetId));
}

/** Puts a sheet in a group, taking it out of any group it was in. */
export async function assignSheet(env: AppEnv, sheetId: string, groupId: string): Promise<void> {
  const previous = await groupOfSheet(env, sheetId);
  if (previous === groupId) return;
  if (previous !== null) await env.OAUTH_KV.delete(memberPrefix(previous) + sheetId);
  await env.OAUTH_KV.put(sheetKey(sheetId), groupId);
  await env.OAUTH_KV.put(memberPrefix(groupId) + sheetId, "1");
}

export async function sheetsInGroup(env: AppEnv, groupId: string): Promise<Set<string>> {
  const prefix = memberPrefix(groupId);
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_KV.list({ prefix, cursor });
    for (const key of page.keys) ids.add(key.name.slice(prefix.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}
