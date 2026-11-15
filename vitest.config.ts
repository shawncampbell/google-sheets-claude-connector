import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    alias: {
      // The OAuth library imports a Workers-only module. Tests run under Node.
      "cloudflare:workers": fileURLToPath(new URL("./test/cloudflare-workers-stub.ts", import.meta.url)),
    },
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
