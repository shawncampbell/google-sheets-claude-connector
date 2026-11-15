import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GoogleError, type SheetsApi } from "../src/google";
import { buildServer } from "../src/tools";

function fakeApi(overrides: Partial<SheetsApi> = {}): SheetsApi {
  const unused = async () => {
    throw new Error("not expected in this test");
  };
  return { create: unused, list: unused, describe: unused, read: unused, write: unused, append: unused, ...overrides };
}

async function connect(api: SheetsApi) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer(api).connect(serverSide);
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

  it("describes a sheet when read without a range, and reads cells with one", async () => {
    const client = await connect(
      fakeApi({
        describe: async (id) => ({ spreadsheetId: id, title: "Log", url: "u", tabs: [{ title: "Sheet1", rows: 1000, columns: 26 }] }),
        read: async (_id, range) => ({ range, values: [["a"]] }),
      }),
    );
    const described = await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: "abcdefghij1234567890" } });
    expect(JSON.parse(text(described)).tabs[0].title).toBe("Sheet1");
    const read = await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: "abcdefghij1234567890", range: "Sheet1!A1" } });
    expect(JSON.parse(text(read))).toEqual({ range: "Sheet1!A1", values: [["a"]] });
  });

  it("refuses a link where an id is expected", async () => {
    const client = await connect(fakeApi());
    const result = await client.callTool({ name: "read_sheet", arguments: { spreadsheet_id: "https://example.com/spreadsheets/d/abc/edit" } });
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
    const result = await client.callTool({ name: "write_range", arguments: { spreadsheet_id: "abcdefghij1234567890", range: "A1", values: [["x"]] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("cannot reach that sheet");
  });
});
