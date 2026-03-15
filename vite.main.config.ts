import path from "node:path";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const external = [
  "electron",
  "electron/main",
  "better-sqlite3",
  "@nut-tree-fork/nut-js",
  "electron-store",
  "ws",
  "uuid",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/main/index.ts"),
      formats: ["es"],
    },
    outDir: "dist/main",
    sourcemap: true,
    target: "node20",
    rollupOptions: {
      external,
      output: {
        format: "es",
        entryFileNames: "index.mjs",
      },
    },
    minify: false,
  },
  resolve: {
    alias: {
      "@main": path.resolve(__dirname, "src/main"),
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
