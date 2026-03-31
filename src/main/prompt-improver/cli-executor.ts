import { execFile, type ChildProcess } from "node:child_process";

import type { ImproverTool, PromptCategory } from "@shared/types";
import { getLogger } from "@main/utils/logger";
import { getTempDir } from "@main/utils/paths";
import { getSystemPromptForCategory } from "./system-prompts";

const log = getLogger("cli-executor");

const STRIP_ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;

interface CliToolConfig {
  command: string;
  buildArgs: (systemPrompt: string) => string[];
  buildStdin: (rawText: string, systemPrompt: string) => string;
}

const CLI_CONFIGS: Record<ImproverTool, CliToolConfig> = {
  claude: {
    command: "claude",
    buildArgs: (sp) => [
      "-p",
      "--tools", "",
      "--no-session-persistence",
      ...(sp ? ["--system-prompt", sp] : []),
    ],
    buildStdin: (rawText) => rawText,
  },
  codex: {
    command: "codex",
    buildArgs: () => [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s", "read-only",
      "-",
    ],
    // Codex has no --system-prompt flag, so embed instructions in the input
    buildStdin: (rawText, systemPrompt) =>
      `${systemPrompt}\n\n---\n\n${rawText}`,
  },
  kimi: {
    command: "kimi",
    buildArgs: () => ["--quiet"],
    // Kimi has no --system-prompt flag, so embed instructions in the input
    buildStdin: (rawText, systemPrompt) =>
      `${systemPrompt}\n\n---\n\nImprove the following dictated text:\n\n${rawText}`,
  },
};

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
  const args = config.buildArgs(systemPrompt);
  const stdinText = config.buildStdin(rawText, systemPrompt);
  const cwd = getTempDir();

  let child: ChildProcess | null = null;
  let killed = false;

  const promise = (async () => {
    const resolvedCommand = await resolveCommand(config.command);
    log.info(`Spawning ${resolvedCommand}`, { tool, argsCount: args.length, cwd });

    return new Promise<string>((resolve, reject) => {
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
          reject(new Error(`${tool} failed: ${detail}`));
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

      child.stdin?.write(stdinText);
      child.stdin?.end();
    });
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
