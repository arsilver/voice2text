import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmpDir = path.join(repoRoot, "tmp");
const zipPath = path.join(tmpDir, "whisper-bin-x64.zip");
const destination = path.join(repoRoot, "resources", "whisper");
const releaseUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip";

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(destination, { recursive: true });

console.log("Downloading whisper.cpp Windows binaries...");
const response = await fetch(releaseUrl);

if (!response.ok) {
  throw new Error(`Failed to download whisper.cpp binaries (${response.status}).`);
}

fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
console.log("Extracting archive...");

execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Force -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}'`,
  ],
  { stdio: "inherit" }
);

console.log(`whisper.cpp installed to ${destination}`);

