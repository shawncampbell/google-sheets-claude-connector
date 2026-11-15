import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GoogleError, type SheetsApi } from "../src/google";
import { buildServer, type GroupAccess } from "../src/tools";

function fakeApi(overrides: Partial<SheetsApi> = {}): SheetsApi {
  const unused = async () => {
    throw new Error("not expected in this test");
  };
  return { create: unused, list: unused, describe: unused, read: unused, write: unused, append: unused, clearValues: unused, writeRaw: unused, ...overrides };
}

const KEY = "sheets-key-for-project-a";
const SHEET = "abcdefghij1234567890";
const OPEN_SHEET = "sheet-open-to-any-chat-0123456789";

/** One group, reached by KEY, holding SHEET. `assigned` records what create_sheet adds. */
const CATALOG = "the-catalog-sheet-0123456789";
const created: Array<[string, string | undefined]> = [];

function fakeGroups(assigned: Array<[string, string]> = []): GroupAccess {
  return {
    catalogId: async () => CATALOG,
    sheetCreated: (sheetId, purpose) => void created.push([sheetId, purpose]),
    groupForKey: async (key) => (key === KEY ? { id: "group-a", name: "Project A" } : null),
    groupOfSheet: async (id) =>
      id === SHEET ? "group-a" : id === "sheet-in-group-b-0123456789" ? "group-b" : id === OPEN_SHEET || id === CATALOG ? "open" : null,
    assignSheet: async (sheetId, groupId) => void assigned.push([sheetId, groupId]),
    sheetsInGroup: async (groupId) => new Set(groupId === "group-a" ? [SHEET] : groupId === "open" ? [OPEN_SHEET] : []),
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

    it("with no key, reaches the open sheets and nothing kept to a Project", async () => {
      const client = await connect(
        fakeApi({
          read: async (_id, range) => ({ range, values: [["open"]] }),
          list: async () => [
            { spreadsheetId: SHEET, title: "Project A's", modifiedTime: "t", createdTime: "t" },
            { spreadsheetId: OPEN_SHEET, title: "Shared", modifiedTime: "t", createdTime: "t" },
            { spreadsheetId: "sheet-in-no-place-0123456789", title: "Unplaced", modifiedTime: "t", createdTime: "t" },
          ],
        }),
      );
      expect((await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: OPEN_SHEET, range: "A1" } })).isError).toBeFalsy();
      for (const id of [SHEET, "sheet-in-group-b-0123456789", "sheet-in-no-place-0123456789"]) {
        const refused = await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: id, range: "A1" } });
        expect(refused.isError, id).toBe(true);
        expect(text(refused), id).toContain("cannot reach that sheet");
      }
      const listed = JSON.parse(text(await client.callTool({ name: "list_sheets", arguments: {} })));
      expect(listed.sheets.map((s: { title: string }) => s.title)).toEqual(["Shared"]);
      expect(listed.kept_to_this_project).toBeNull();
    });

    it("with no key, creates a sheet open to any chat and says so", async () => {
      const assigned: Array<[string, string]> = [];
      const client = await connect(
        fakeApi({ create: async (title) => ({ spreadsheetId: "new-sheet-0123456789", url: "u", title }) }),
        fakeGroups(assigned),
      );
      const made = JSON.parse(text(await client.callTool({ name: "create_sheet", arguments: { title: "Notes" } })));
      expect(assigned).toEqual([["new-sheet-0123456789", "open"]]);
      expect(made.open_to).toBe("Any chat");
      expect(made.note).toContain("any chat on the account");
    });

    it("refuses a wrong key outright, and does not fall back to the open sheets", async () => {
      const client = await connect(untouched());
      for (const name of ["list_sheets", "read_sheet"] as const) {
        const result = await client.callTool({ name, arguments: { project_key: "sheets-key-wrong", spreadsheet_id: OPEN_SHEET } });
        expect(result.isError, name).toBe(true);
        expect(text(result), name).toContain("project key is not valid");
        expect(text(result), name).toContain("https://connector.example/manage");
      }
    });

    it("with a key, reaches its own group and the open sheets", async () => {
      const client = await connect(fakeApi({ read: async (_id, range) => ({ range, values: [] }) }));
      for (const id of [SHEET, OPEN_SHEET]) {
        expect((await client.callTool({ name: "read_sheet", arguments: { project_key: KEY, spreadsheet_id: id, range: "A1" } })).isError, id).toBeFalsy();
      }
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
      expect(JSON.parse(text(result)).kept_to).toBe("Project A");
      expect(assigned).toEqual([["new-sheet-0123456789", "group-a"]]);
    });

    it("lists the key's own sheets and the open ones, and says which is which", async () => {
      const client = await connect(
        fakeApi({
          list: async () => [
            { spreadsheetId: SHEET, title: "Mine", modifiedTime: "t", createdTime: "t" },
            { spreadsheetId: "sheet-in-group-b-0123456789", title: "Other project's", modifiedTime: "t", createdTime: "t" },
            { spreadsheetId: OPEN_SHEET, title: "Shared", modifiedTime: "t", createdTime: "t" },
          ],
        }),
      );
      const result = await client.callTool({ name: "list_sheets", arguments: { project_key: KEY } });
      expect(JSON.parse(text(result)).sheets.map((s: { title: string; where: string }) => [s.title, s.where])).toEqual([
        ["Mine", "Project A"],
        ["Shared", "Any chat"],
      ]);
    });

    it("tells Claude never to repeat a key or save it to memory", async () => {
      const client = await connect(fakeApi());
      expect(client.getInstructions()).toContain("Never repeat a key in a reply, and never save one to memory");
    });
  });

  describe("the catalog", () => {
    it("can be read when the owner has placed it, and never written", async () => {
      const client = await connect(fakeApi({ read: async (_id, range) => ({ range, values: [] }) }));
      expect((await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: CATALOG, range: "A1" } })).isError).toBeFalsy();
      for (const name of ["write_range", "append_rows"] as const) {
        const result = await client.callTool({ name, arguments: { spreadsheet_id: CATALOG, range: "A1", values: [["x"]] } });
        expect(result.isError, name).toBe(true);
        expect(text(result), name).toContain("connector's own catalog");
      }
    });

    it("is told when a sheet is created, with the purpose Claude gave", async () => {
      created.length = 0;
      const client = await connect(fakeApi({ create: async (title) => ({ spreadsheetId: "new-sheet-0123456789", url: "u", title }) }));
      await client.callTool({ name: "create_sheet", arguments: { project_key: KEY, title: "Log", purpose: "Books read this year." } });
      expect(created).toEqual([["new-sheet-0123456789", "Books read this year."]]);
    });
  });
});
