import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));

describe("token encryption", () => {
  it("returns what was stored, and never stores it readable", async () => {
    const sealed = await encrypt(key, "a-refresh-token", "connector:refresh:user-1");
    expect(sealed).not.toContain("a-refresh-token");
    await expect(decrypt(key, sealed, "connector:refresh:user-1")).resolves.toBe("a-refresh-token");
  });

  it("refuses a value moved to another account's slot, or opened with another key", async () => {
    const sealed = await encrypt(key, "a-refresh-token", "connector:refresh:user-1");
    await expect(decrypt(key, sealed, "connector:refresh:user-2")).rejects.toThrow();
    await expect(decrypt(otherKey, sealed, "connector:refresh:user-1")).rejects.toThrow();
  });

  it("refuses a key of the wrong length", async () => {
    await expect(encrypt(btoa("short"), "x", "c")).rejects.toThrow("32 bytes");
  });
});
