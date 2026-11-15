import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SheetsApi } from "./google";
import { DELETE_LIMIT_FOR_MODELS, REACH_FOR_MODELS } from "./statement";

export const SERVER_INSTRUCTIONS =
  `This connector creates, reads and writes Google Sheets. ${REACH_FOR_MODELS} ${DELETE_LIMIT_FOR_MODELS}`;

const spreadsheetId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,200}$/, "Pass the sheet's id, not its link or its title.")
  .describe("The sheet's id, as returned by create_sheet or list_sheets.");

const range = z
  .string()
  .min(1)
  .max(200)
  .describe('A range in A1 notation, such as "Sheet1!A1:D20" or "Sheet1" for a whole tab.');

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rows = z
  .array(z.array(cell).max(500))
  .min(1)
  .max(5000)
  .describe("Rows of cells, outer array top to bottom, inner arrays left to right. A string starting with = is a formula.");

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Every tool answers with JSON text; a failure Google explains is passed on as an error. */
async function answer(work: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request failed.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/**
 * The connector's whole surface. There is no tool that deletes, shares, moves or renames
 * a file, and none that removes a tab. Do not add one without a decision record.
 */
export function buildServer(api: SheetsApi): McpServer {
  const server = new McpServer(
    { name: "google-sheets-claude-connector", version: "0.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "create_sheet",
    {
      title: "Create a sheet",
      description:
        "Create a new, empty Google Sheet in the account holder's Drive and return its id and link. " +
        `The connector can reach the new sheet from then on. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { title: z.string().min(1).max(200).describe("The new sheet's title.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ title }) => answer(() => api.create(title)),
  );

  server.registerTool(
    "list_sheets",
    {
      title: "List reachable sheets",
      description: `List the sheets this connector can reach, newest change first. ${REACH_FOR_MODELS}`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => answer(async () => ({ sheets: await api.list() })),
  );

  server.registerTool(
    "read_sheet",
    {
      title: "Read a sheet",
      description:
        "Read cells from a sheet. With no range, return the sheet's title and the name and size of each tab, " +
        `which is the way to find a range to ask for. ${REACH_FOR_MODELS}`,
      inputSchema: { spreadsheet_id: spreadsheetId, range: range.optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ spreadsheet_id, range }) =>
      answer(() => (range === undefined ? api.describe(spreadsheet_id) : api.read(spreadsheet_id, range))),
  );

  server.registerTool(
    "write_range",
    {
      title: "Write cells",
      description:
        "Write rows of cells into a sheet starting at the range's top-left cell, replacing what is there. " +
        `Values are entered as if typed, so dates and formulas are recognised. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { spreadsheet_id: spreadsheetId, range, values: rows },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ spreadsheet_id, range, values }) => answer(() => api.write(spreadsheet_id, range, values)),
  );

  server.registerTool(
    "append_rows",
    {
      title: "Append rows",
      description:
        "Add rows after the last row of the table found in the range, without changing existing cells. " +
        `Use this to add records to a log or a list. ${DELETE_LIMIT_FOR_MODELS}`,
      inputSchema: { spreadsheet_id: spreadsheetId, range, values: rows },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ spreadsheet_id, range, values }) => answer(() => api.append(spreadsheet_id, range, values)),
  );

  return server;
}
