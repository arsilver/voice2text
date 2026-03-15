import path from "node:path";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const external = [
  "electron",
  "electron/main",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/preload/index.ts"),
      formats: ["cjs"],
    },
    outDir: "dist/preload",
    sourcemap: true,
    target: "node20",
    rollupOptions: {
      external,
      output: {
        format: "cjs",
        entryFileNames: "index.cjs",
      },
    },
    minify: false,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
