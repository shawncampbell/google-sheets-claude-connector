import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GoogleError, type SheetsApi } from "../src/google";
import { buildServer, type GroupAccess } from "../src/tools";

function fakeApi(overrides: Partial<SheetsApi> = {}): SheetsApi {
  const unused = async () => {
    throw new Error("not expected in this test");
  };
  return { create: unused, list: unused, describe: unused, read: unused, write: unused, append: unused, ...overrides };
}

const KEY = "sheets-key-for-project-a";
const SHEET = "abcdefghij1234567890";

/** One group, reached by KEY, holding SHEET. `assigned` records what create_sheet adds. */
function fakeGroups(assigned: Array<[string, string]> = []): GroupAccess {
  return {
    groupForKey: async (key) => (key === KEY ? { id: "group-a", name: "Project A" } : null),
    groupOfSheet: async (id) => (id === SHEET ? "group-a" : id === "sheet-in-group-b-0123456789" ? "group-b" : null),
    assignSheet: async (sheetId, groupId) => void assigned.push([sheetId, groupId]),
    sheetsInGroup: async (groupId) => new Set(groupId === "group-a" ? [SHEET] : []),
  };
}

async function connect(api: SheetsApi, groups: GroupAccess = fakeGroups()) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(api, "https://connector.example", groups).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text;

describe("the connector's tools", () => {
  it("offers exactly five tools and none that deletes", async () => {
    const client = await connect(fakeApi());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["append_rows", "create_sheet", "list_sheets", "read_sheet", "write_range"]);
    for (const tool of tools) expect(tool.name).not.toMatch(/delete|remove|trash|share|clear/);
  });

  it("states the delete limit on every tool that writes, and in the server instructions", async () => {
    const client = await connect(fakeApi());
    const { tools } = await client.listTools();
    for (const name of ["create_sheet", "write_range", "append_rows"]) {
      expect(tools.find((t) => t.name === name)?.description).toContain("that limit is kept by this server, not by Google");
    }
    expect(client.getInstructions()).toContain("that limit is kept by this server, not by Google");
  });

  it("tells Claude where an existing sheet is handed over, and nowhere else", async () => {
    const client = await connect(fakeApi());
    expect(client.getInstructions()).toContain("opens https://connector.example/pick in a browser");
    expect(client.getInstructions()).toContain("do not send the user anywhere else");
  });

  it("adds the pick page to a refusal for a sheet it cannot reach", async () => {
    const client = await connect(
      fakeApi({
        read: async () => {
          throw new GoogleError("This connector cannot reach that sheet.", "not_reachable");
        },
      }),
    );
    const result = await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: SHEET, range: "A1" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("https://connector.example/pick");
  });

  it("describes a sheet when read without a range, and reads cells with one", async () => {
    const client = await connect(
      fakeApi({
        describe: async (id) => ({ spreadsheetId: id, title: "Log", url: "u", tabs: [{ title: "Sheet1", rows: 1000, columns: 26 }] }),
        read: async (_id, range) => ({ range, values: [["a"]] }),
      }),
    );
    const described = await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: SHEET } });
    expect(JSON.parse(text(described)).tabs[0].title).toBe("Sheet1");
    const read = await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: SHEET, range: "Sheet1!A1" } });
    expect(JSON.parse(text(read))).toEqual({ range: "Sheet1!A1", values: [["a"]] });
  });

  it("refuses a link where an id is expected", async () => {
    const client = await connect(fakeApi());
    const result = await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: "https://example.com/spreadsheets/d/abc/edit" } });
    expect(result.isError).toBe(true);
  });

  it("passes Google's refusal on as a tool error the model can read", async () => {
    const client = await connect(
      fakeApi({
        write: async () => {
          throw new GoogleError("This connector cannot reach that sheet.", "not_reachable");
        },
      }),
    );
    const result = await client.callTool({ name: "write_range", arguments: { project_key: KEY, spreadsheet_id: SHEET, range: "A1", values: [["x"]] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("cannot reach that sheet");
  });

  describe("project keys", () => {
    const untouched = () =>
      fakeApi({
        create: async () => {
          throw new Error("Google must not be asked");
        },
      });

    it("refuses every tool when the call carries no key, without asking Google anything", async () => {
      const client = await connect(untouched());
      for (const [name, args] of [
        ["create_sheet", { title: "x" }],
        ["list_sheets", {}],
        ["read_sheet", { spreadsheet_id: SHEET }],
        ["write_range", { spreadsheet_id: SHEET, range: "A1", values: [["x"]] }],
        ["append_rows", { spreadsheet_id: SHEET, range: "A1", values: [["x"]] }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, name).toBe(true);
        expect(text(result), name).toContain("no valid project key");
        expect(text(result), name).toContain("https://connector.example/manage");
      }
    });

    it("refuses a wrong key the same way", async () => {
      const client = await connect(untouched());
      const result = await client.callTool({ name: "list_sheets", arguments: { project_key: "sheets-key-wrong" } });
      expect(text(result)).toContain("no valid project key");
    });

    it("refuses a sheet in another group, or in no group, before asking Google", async () => {
      const client = await connect(untouched());
      for (const id of ["sheet-in-group-b-0123456789", "sheet-in-no-group-0123456789"]) {
        const result = await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: id } });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("cannot reach that sheet");
      }
    });

    it("puts a newly created sheet in the key's group", async () => {
      const assigned: Array<[string, string]> = [];
      const client = await connect(
        fakeApi({ create: async (title) => ({ spreadsheetId: "new-sheet-0123456789", url: "u", title }) }),
        fakeGroups(assigned),
      );
      const result = await client.callTool({ name: "create_sheet", arguments: { project_key: KEY, title: "Log" } });
      expect(JSON.parse(text(result)).group).toBe("Project A");
      expect(assigned).toEqual([["new-sheet-0123456789", "group-a"]]);
    });

    it("lists only the sheets in the key's group", async () => {
      const client = await connect(
        fakeApi({
          list: async () => [
            { spreadsheetId: SHEET, title: "Mine", modifiedTime: "t" },
            { spreadsheetId: "sheet-in-group-b-0123456789", title: "Other project's", modifiedTime: "t" },
          ],
        }),
      );
      const result = await client.callTool({ name: "list_sheets", arguments: { project_key: KEY } });
      expect(JSON.parse(text(result)).sheets.map((s: { title: string }) => s.title)).toEqual(["Mine"]);
    });

    it("tells Claude never to repeat a key or save it to memory", async () => {
      const client = await connect(fakeApi());
      expect(client.getInstructions()).toContain("Never repeat a key in a reply, and never save one to memory");
    });
  });
});
