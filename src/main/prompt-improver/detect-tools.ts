import { spawn } from "node:child_process";

import type { ImproverTool } from "@shared/types";
import { getLogger } from "@main/utils/logger";

const log = getLogger("detect-tools");

const TOOLS: ImproverTool[] = ["claude", "codex", "kimi", "grok"];
const DETECT_TIMEOUT_MS = 5_000;

export async function detectCliTools(): Promise<Record<ImproverTool, boolean>> {
  const results = await Promise.all(TOOLS.map(probeCommand));
  const map = {} as Record<ImproverTool, boolean>;
  for (let i = 0; i < TOOLS.length; i++) {
    map[TOOLS[i]] = results[i];
  }
  log.info("CLI tool detection", map);
  return map;
}

function probeCommand(tool: ImproverTool): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(tool, ["--version"], {
        windowsHide: true,
        shell: true,
        stdio: ["ignore", "ignore", "ignore"],
        timeout: DETECT_TIMEOUT_MS,
      });

      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}
