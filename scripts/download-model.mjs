import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const modelsDir = path.join(repoRoot, "resources", "models");
const models = [
  {
    fileName: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  },
  {
    fileName: "ggml-small.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
  },
  {
    fileName: "ggml-medium.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
  },
];

fs.mkdirSync(modelsDir, { recursive: true });

for (const model of models) {
  const destination = path.join(modelsDir, model.fileName);
  if (fs.existsSync(destination)) {
    console.log(`Skipping ${model.fileName}; already present.`);
    continue;
  }

  console.log(`Downloading ${model.fileName}...`);

  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${model.fileName} (${response.status}).`);
  }

  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  console.log(`Model saved to ${destination}`);
}
