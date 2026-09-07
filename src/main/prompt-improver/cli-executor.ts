import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ImproverTool, PromptCategory } from "@shared/types";
import { getLogger } from "@main/utils/logger";
import { getTempDir } from "@main/utils/paths";
import { getSystemPromptForCategory } from "./system-prompts";
import { CLI_CONFIGS, formatCliError, GROK_MAX_TURNS } from "./cli-invocation";

export { buildCliInvocation, GROK_MAX_TURNS, formatCliError } from "./cli-invocation";
export type { CliInvocation } from "./cli-invocation";

const log = getLogger("cli-executor");

const STRIP_ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

const TIMEOUT_MS = 120_000;

export interface CliExecution {
  promise: Promise<string>;
  cancel: () => void;
}

/**
 * Resolves a CLI command name to its full path on Windows using `where`.
 * Falls back to the bare command name if resolution fails.
 */
function resolveCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("where", [command], { windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(command);
        return;
      }
      // `where` may return multiple lines; take the first match.
      resolve(stdout.trim().split(/\r?\n/)[0]);
    });
  });
}

export function improveWithCli(
  rawText: string,
  tool: ImproverTool,
  category: PromptCategory,
  customSystemPrompt?: string,
): CliExecution {
  const config = CLI_CONFIGS[tool];
  const systemPrompt = getSystemPromptForCategory(category, tool, customSystemPrompt);
  const stdinText = config.buildStdin(rawText, systemPrompt);
  const cwd = getTempDir();

  let child: ChildProcess | null = null;
  let killed = false;
  let promptFilePath: string | null = null;

  const promise = (async () => {
    if (config.promptViaFile) {
      promptFilePath = join(cwd, `improver-prompt-${randomUUID()}.txt`);
      writeFileSync(promptFilePath, stdinText, "utf8");
    }

    const args = config.buildArgs(systemPrompt, promptFilePath, cwd);
    const resolvedCommand = await resolveCommand(config.command);
    log.info(`Spawning ${resolvedCommand}`, {
      tool,
      argsCount: args.length,
      cwd,
      promptViaFile: Boolean(config.promptViaFile),
      maxTurns: tool === "grok" ? GROK_MAX_TURNS : undefined,
    });

    try {
      return await new Promise<string>((resolve, reject) => {
        // Use execFile (no shell) with the resolved path to avoid DEP0190.
        child = execFile(resolvedCommand, args, {
          windowsHide: true,
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          encoding: "buffer",
        }, (error, stdoutBuf, stderrBuf) => {
          if (killed) {
            reject(new Error("Improvement cancelled."));
            return;
          }

          const stdout = (stdoutBuf as unknown as Buffer).toString("utf8").replace(STRIP_ANSI_RE, "").trim();
          const stderr = (stderrBuf as unknown as Buffer).toString("utf8").trim();

          if (error) {
            const detail = stderr || error.message || `exit code ${(error as NodeJS.ErrnoException).code}`;
            log.error(`CLI failed: ${detail}`, { tool, code: (error as { code?: unknown }).code });
            reject(new Error(formatCliError(tool, detail)));
            return;
          }

          if (!stdout) {
            log.warn("CLI returned empty output", { tool });
            reject(new Error(`${tool} returned empty output.`));
            return;
          }

          log.info(`CLI success`, { tool, outputLength: stdout.length });
          resolve(stdout);
        });

        if (!config.promptViaFile) {
          child.stdin?.write(stdinText);
          child.stdin?.end();
        } else {
          child.stdin?.end();
        }
      });
    } finally {
      if (promptFilePath) {
        try {
          unlinkSync(promptFilePath);
        } catch {
          // best-effort cleanup
        }
      }
    }
  })();

  function cancel() {
    if (child && !killed) {
      killed = true;
      child.kill();
      log.info("CLI process cancelled", { tool });
    }
  }

  return { promise, cancel };
}
