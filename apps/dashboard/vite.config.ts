import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    port: 4400,
    proxy: {
      "/api": "http://127.0.0.1:4401"
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022"
    }
  },
  preview: {
    port: 4400
  },
  build: {
    target: "es2022",
    outDir: "../../dist/dashboard",
    emptyOutDir: true
  },
  resolve: {
    alias: [
      {
        find: "@startup-os/shared/browser",
        replacement: fileURLToPath(new URL("../../packages/shared/src/browser.ts", import.meta.url))
      },
      {
        find: "@startup-os/shared",
        replacement: fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url))
      }
    ]
  }
});
