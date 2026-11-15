import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoogleError, type SheetsApi } from "./google";
import { OPEN, OPEN_NAME } from "./groups";
import { DELETE_LIMIT_FOR_MODELS, keyRuleForModels, pickHintForModels, REACH_FOR_MODELS } from "./statement";

export const serverInstructions = (origin: string) =>
  `This connector creates, reads and writes Google Sheets. ${keyRuleForModels(origin)} ${REACH_FOR_MODELS} ${pickHintForModels(origin)} ${DELETE_LIMIT_FOR_MODELS}`;

const spreadsheetId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,200}$/, "Pass the sheet's id, not its link or its title.")
  .describe("The sheet's id, as returned by create_sheet or list_sheets.");

const range = z
  .string()
  .min(1)
  .max(200)
  .describe('A range in A1 notation, such as "Sheet1!A1:D20" or "Sheet1" for a whole tab.');

const projectKey = z
  .string()
  .max(200)
  .optional()
  .describe("The project key from this Claude Project's instructions, passed exactly as written there. Leave it out when the instructions hold no key. Never show it to the user or save it to memory.");

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rows = z
  .array(z.array(cell).max(500))
  .min(1)
  .max(5000)
  .describe("Rows of cells, outer array top to bottom, inner arrays left to right. A string starting with = is a formula.");

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** What the tools need to know about groups. The Worker backs this with storage; tests use a fake. */
export interface GroupAccess {
  /** The group a key reaches, or null when the key is wrong or has been replaced. */
  groupForKey(key: string): Promise<{ id: string; name: string } | null>;
  groupOfSheet(sheetId: string): Promise<string | null>;
  assignSheet(sheetId: string, groupId: string): Promise<void>;
  sheetsInGroup(groupId: string): Promise<Set<string>>;
  /** The id of the connector's own catalog sheet, or null when there is none. */
  catalogId(): Promise<string | null>;
  /** Called after a sheet is created, so the catalog can be brought up to date. */
  sheetCreated(sheetId: string, purpose: string | undefined): void;
}

const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

// Worded the same as Google's own refusal, so a sheet in another group and a sheet that
// was never handed over cannot be told apart.
const NOT_IN_GROUP =
  "This connector cannot reach that sheet. It can reach only sheets it created or sheets " +
  "the account holder picked for it. Check the id, or use list_sheets to see what it can reach.";

/** Where a call may work: one group plus the open sheets, or the open sheets alone. */
type Scope = { group: { id: string; name: string } | null };

/**
 * The connector's whole surface. There is no tool that deletes, shares, moves or renames
 * a file, and none that removes a tab. Do not add one without a decision record.
 *
 * A call with a valid project key works in that key's group and in the sheets open to any
 * chat. A call with no key works only in the open sheets. A call with a wrong key is
 * refused outright, so a Project whose key was replaced fails loudly instead of quietly
 * working in the open space (decisions/0002 and 0003).
 */
export function buildServer(api: SheetsApi, origin: string, groups: GroupAccess): McpServer {
  const pickHint = pickHintForModels(origin);
  const badKey =
    "This call was refused because its project key is not valid. It may have been replaced. " +
    `Do not retry without the key. Tell the user to open ${origin}/manage, replace the group's key, ` +
    "and paste the new one into this Project's instructions.";
  const server = new McpServer(
    { name: "google-sheets-claude-connector", version: "0.0.0" },
    { instructions: serverInstructions(origin) },
  );

  /** Runs `work` in the scope the key allows, answering with JSON, or with a refusal the model can read. */
  async function inScope(key: string | undefined, work: (scope: Scope) => Promise<unknown>): Promise<Result> {
    let scope: Scope = { group: null };
    if (key !== undefined && key.trim() !== "") {
      const group = await groups.groupForKey(key.trim());
      if (group === null) return fail(badKey);
      scope = { group };
    }
    try {
      return { content: [{ type: "text", text: JSON.stringify(await work(scope), null, 2) }] };
    } catch (error) {
      let message = error instanceof Error ? error.message : "The request failed.";
      if (error instanceof GoogleError && error.kind === "not_reachable") message += ` ${pickHint}`;
      return fail(message);
    }
  }

  const CATALOG_IS_READ_ONLY =
    "That sheet is the connector's own catalog. The connector keeps it up to date itself, so it cannot be " +
    "written through the connector. The account holder can edit its Notes column in Google Sheets.";

  /** Refuses a write to the catalog, which only the connector itself may change. */
  async function mustNotBeCatalog(sheetId: string): Promise<void> {
    if ((await groups.catalogId()) === sheetId) throw new GoogleError(CATALOG_IS_READ_ONLY, "bad_request");
  }

  /** Refuses a sheet outside the scope, before anything is asked of Google. */
  async function mustHold(scope: Scope, sheetId: string): Promise<void> {
    const place = await groups.groupOfSheet(sheetId);
    if (place !== OPEN && (scope.group === null || place !== scope.group.id)) {
      throw new GoogleError(NOT_IN_GROUP, "not_reachable");
    }
  }

  server.registerTool(
    "create_sheet",
    {
      title: "Create a sheet",
      description:
        "Create a new, empty Google Sheet in the account holder's Drive and return its id and link. " +
        `With a project key the new sheet is kept to that key's Project; with no key it is open to any chat on the account. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: {
        project_key: projectKey,
        title: z.string().min(1).max(200).describe("The new sheet's title."),
        purpose: z
          .string()
          .max(300)
          .optional()
          .describe("One plain sentence on what the sheet is for. It is recorded in the account holder's catalog of sheets, if they keep one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project_key, title, purpose }) =>
      inScope(project_key, async (scope) => {
        const made = await api.create(title);
        await groups.assignSheet(made.spreadsheetId, scope.group?.id ?? OPEN);
        groups.sheetCreated(made.spreadsheetId, purpose);
        return scope.group
          ? { ...made, kept_to: scope.group.name }
          : { ...made, open_to: OPEN_NAME, note: `This sheet can be reached from any chat on the account. To keep it to one Project, the account holder moves it at ${origin}/manage.` };
      }),
  );

  server.registerTool(
    "list_sheets",
    {
      title: "List reachable sheets",
      description: `List the sheets this call can reach, newest change first: the project key's own sheets, if a key is passed, and the sheets open to any chat. ${REACH_FOR_MODELS} ${pickHint}`,
      inputSchema: { project_key: projectKey },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ project_key }) =>
      inScope(project_key, async (scope) => {
        const held = scope.group ? await groups.sheetsInGroup(scope.group.id) : new Set<string>();
        const open = await groups.sheetsInGroup(OPEN);
        const sheets = (await api.list())
          .filter((s) => held.has(s.spreadsheetId) || open.has(s.spreadsheetId))
          .map((s) => ({ ...s, where: held.has(s.spreadsheetId) ? scope.group!.name : OPEN_NAME }));
        return { kept_to_this_project: scope.group?.name ?? null, sheets };
      }),
  );

  server.registerTool(
    "read_sheet",
    {
      title: "Read a sheet",
      description:
        "Read cells from a sheet. With no range, return the sheet's title and the name and size of each tab, " +
        `which is the way to find a range to ask for. ${REACH_FOR_MODELS}`,
      inputSchema: { project_key: projectKey, spreadsheet_id: spreadsheetId, range: range.optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ project_key, spreadsheet_id, range }) =>
      inScope(project_key, async (scope) => {
        await mustHold(scope, spreadsheet_id);
        return range === undefined ? api.describe(spreadsheet_id) : api.read(spreadsheet_id, range);
      }),
  );

  server.registerTool(
    "write_range",
    {
      title: "Write cells",
      description:
        "Write rows of cells into a sheet starting at the range's top-left cell, replacing what is there. " +
        `Values are entered as if typed, so dates and formulas are recognised. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { project_key: projectKey, spreadsheet_id: spreadsheetId, range, values: rows },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ project_key, spreadsheet_id, range, values }) =>
      inScope(project_key, async (scope) => {
        await mustHold(scope, spreadsheet_id);
        await mustNotBeCatalog(spreadsheet_id);
        return api.write(spreadsheet_id, range, values);
      }),
  );

  server.registerTool(
    "append_rows",
    {
      title: "Append rows",
      description:
        "Add rows after the last row of the table found in the range, without changing existing cells. " +
        `Use this to add records to a log or a list. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { project_key: projectKey, spreadsheet_id: spreadsheetId, range, values: rows },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project_key, spreadsheet_id, range, values }) =>
      inScope(project_key, async (scope) => {
        await mustHold(scope, spreadsheet_id);
        await mustNotBeCatalog(spreadsheet_id);
        return api.append(spreadsheet_id, range, values);
      }),
  );

  return server;
}
