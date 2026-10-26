import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".cache/**"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next resolves this itself outside plain Node/Vite -- see
      // src/test-shims/server-only.ts for why this is aliased to a no-op.
      "server-only": fileURLToPath(new URL("./src/test-shims/server-only.ts", import.meta.url)),
    },
  },
});
