import { join } from "node:path";

import type { ImproverTool, PromptCategory } from "@shared/types";
import { getSystemPromptForCategory } from "./system-prompts";

/** Grok agent turns budget for pure text rewrite (1 is too low — hits "Max turns reached"). */
export const GROK_MAX_TURNS = "8";

export interface CliToolConfig {
  command: string;
  /** When true, write the user prompt to a temp file and pass its path to buildArgs. */
  promptViaFile?: boolean;
  buildArgs: (systemPrompt: string, promptFilePath: string | null, cwd: string) => string[];
  /** Payload for stdin (or the prompt file body when promptViaFile is true). */
  buildStdin: (rawText: string, systemPrompt: string) => string;
}

export const CLI_CONFIGS: Record<ImproverTool, CliToolConfig> = {
  claude: {
    command: "claude",
    buildArgs: (sp) => [
      "-p",
      "--bare",
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
  grok: {
    command: "grok",
    // Long dictations go via file to avoid Windows argv limits.
    promptViaFile: true,
    buildArgs: (sp, promptFilePath, cwd) => [
      "--cwd", cwd,
      "--prompt-file", promptFilePath!,
      ...(sp ? ["--system-prompt-override", sp] : []),
      "--max-turns", GROK_MAX_TURNS,
      "--output-format", "plain",
      "--no-subagents",
      "--disable-web-search",
      "--permission-mode", "dontAsk",
    ],
    // Explicit rewrite task so Grok does not try to implement the request.
    buildStdin: (rawText) =>
      `Improve the following dictated text into a clear AI prompt. Reply with ONLY the improved prompt.\n\n---\n\n${rawText}`,
  },
};

export interface CliInvocation {
  command: string;
  args: string[];
  stdinText: string;
  promptViaFile: boolean;
  cwd: string;
}

/**
 * Pure builder for CLI args/stdin — safe to unit-test without Electron.
 * Callers must pass an explicit cwd (production uses getTempDir()).
 */
export function buildCliInvocation(
  rawText: string,
  tool: ImproverTool,
  category: PromptCategory,
  cwd: string,
  customSystemPrompt?: string,
): CliInvocation {
  const config = CLI_CONFIGS[tool];
  const systemPrompt = getSystemPromptForCategory(category, tool, customSystemPrompt);
  const stdinText = config.buildStdin(rawText, systemPrompt);
  const promptFilePath = config.promptViaFile
    ? join(cwd, `improver-prompt-placeholder.txt`)
    : null;
  const args = config.buildArgs(systemPrompt, promptFilePath, cwd);

  return {
    command: config.command,
    args,
    stdinText,
    promptViaFile: Boolean(config.promptViaFile),
    cwd,
  };
}

export function formatCliError(tool: ImproverTool, detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("max turns reached") || lower.includes("max turns")) {
    return `${tool} hit its turn limit while improving. Try again, or switch improver tool.`;
  }
  return `${tool} failed: ${detail}`;
}
