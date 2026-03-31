import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const appArgs = process.argv.slice(2);
const electronPath = resolveElectronBinary();
const env = { ...process.env };

if (Object.hasOwn(env, "ELECTRON_RUN_AS_NODE")) {
  console.log(`[craftvoice-launcher] Removed inherited ELECTRON_RUN_AS_NODE=${JSON.stringify(env.ELECTRON_RUN_AS_NODE)}`);
  delete env.ELECTRON_RUN_AS_NODE;
}

const child = spawn(electronPath, appArgs.length > 0 ? appArgs : ["."], {
  env,
  stdio: "inherit",
  windowsHide: false,
  detached: process.platform === "win32",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  console.error("[craftvoice-launcher] Failed to start Electron.", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function resolveElectronBinary() {
  const packagePath = require.resolve("electron/package.json");
  const electronDir = path.dirname(packagePath);

  if (process.platform === "win32") {
    return path.join(electronDir, "dist", "electron.exe");
  }

  if (process.platform === "darwin") {
    return path.join(electronDir, "dist", "Electron.app", "Contents", "MacOS", "Electron");
  }

  return path.join(electronDir, "dist", "electron");
}
