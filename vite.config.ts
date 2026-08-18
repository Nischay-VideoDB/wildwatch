import path from "node:path";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { workflow } from "workflow/vite";

export default defineConfig({
  plugins: [
    nitro(),
    workflow({ runtime: "nodejs24.x", dirs: [path.resolve(import.meta.dirname, "workflows")] }),
  ],
  nitro: {
    rootDir: path.resolve(import.meta.dirname),
    serverDir: path.resolve(import.meta.dirname),
    output: { dir: path.resolve(import.meta.dirname, ".vercel/output") },
    vercel: { functions: { maxDuration: 300 } },
  },
});
