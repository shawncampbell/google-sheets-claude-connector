import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoogleError, type SheetsApi } from "./google";
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
  .describe("The project key from this Claude Project's instructions, passed exactly as written there. Never show it to the user or save it to memory.");

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rows = z
  .array(z.array(cell).max(500))
  .min(1)
  .max(5000)
  .describe("Rows of cells, outer array top to bottom, inner arrays left to right. A string starting with = is a formula.");

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** What the tools need to know about groups. The Worker backs this with storage; tests use a fake. */
export interface GroupAccess {
  groupForKey(key: string | undefined): Promise<{ id: string; name: string } | null>;
  groupOfSheet(sheetId: string): Promise<string | null>;
  assignSheet(sheetId: string, groupId: string): Promise<void>;
  sheetsInGroup(groupId: string): Promise<Set<string>>;
}

const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

// Worded the same as Google's own refusal, so a sheet in another group and a sheet that
// was never handed over cannot be told apart.
const NOT_IN_GROUP =
  "This connector cannot reach that sheet. It can reach only sheets it created or sheets " +
  "the account holder picked for it. Check the id, or use list_sheets to see what it can reach.";

/**
 * The connector's whole surface. There is no tool that deletes, shares, moves or renames
 * a file, and none that removes a tab. Do not add one without a decision record.
 *
 * Every tool first turns the project key into a group, and works only inside that group
 * (decisions/0002). A call with no key, or a wrong one, reaches nothing.
 */
export function buildServer(api: SheetsApi, origin: string, groups: GroupAccess): McpServer {
  const pickHint = pickHintForModels(origin);
  const keyNeeded = `This call was refused because it carried no valid project key. ${keyRuleForModels(origin)}`;
  const server = new McpServer(
    { name: "google-sheets-claude-connector", version: "0.0.0" },
    { instructions: serverInstructions(origin) },
  );

  /** Runs `work` inside the key's group, answering with JSON, or with a refusal the model can read. */
  async function inGroup(key: string | undefined, work: (group: { id: string; name: string }) => Promise<unknown>): Promise<Result> {
    const group = await groups.groupForKey(key);
    if (group === null) return fail(keyNeeded);
    try {
      return { content: [{ type: "text", text: JSON.stringify(await work(group), null, 2) }] };
    } catch (error) {
      let message = error instanceof Error ? error.message : "The request failed.";
      if (error instanceof GoogleError && error.kind === "not_reachable") message += ` ${pickHint}`;
      return fail(message);
    }
  }

  /** Refuses a sheet that is not in the key's group, before anything is asked of Google. */
  async function mustHold(group: { id: string }, sheetId: string): Promise<void> {
    if ((await groups.groupOfSheet(sheetId)) !== group.id) throw new GoogleError(NOT_IN_GROUP, "not_reachable");
  }

  server.registerTool(
    "create_sheet",
    {
      title: "Create a sheet",
      description:
        "Create a new, empty Google Sheet in the account holder's Drive and return its id and link. " +
        `The new sheet joins the group of the project key used. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { project_key: projectKey, title: z.string().min(1).max(200).describe("The new sheet's title.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ project_key, title }) =>
      inGroup(project_key, async (group) => {
        const made = await api.create(title);
        await groups.assignSheet(made.spreadsheetId, group.id);
        return { ...made, group: group.name };
      }),
  );

  server.registerTool(
    "list_sheets",
    {
      title: "List reachable sheets",
      description: `List the sheets in the project key's group, newest change first. ${REACH_FOR_MODELS} ${pickHint}`,
      inputSchema: { project_key: projectKey },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ project_key }) =>
      inGroup(project_key, async (group) => {
        const held = await groups.sheetsInGroup(group.id);
        return { group: group.name, sheets: (await api.list()).filter((s) => held.has(s.spreadsheetId)) };
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
      inGroup(project_key, async (group) => {
        await mustHold(group, spreadsheet_id);
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
      inGroup(project_key, async (group) => {
        await mustHold(group, spreadsheet_id);
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
      inGroup(project_key, async (group) => {
        await mustHold(group, spreadsheet_id);
        return api.append(spreadsheet_id, range, values);
      }),
  );

  return server;
}
