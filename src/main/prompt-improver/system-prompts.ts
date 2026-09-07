import type { ImproverTool, PromptCategory } from "@shared/types";
// Relative import keeps unit tests (node --test on tsc CJS emit) path-alias free.
import { CATEGORY_SYSTEM_PROMPTS } from "../../shared/prompt-categories";

export { CATEGORY_LABELS, CATEGORY_SYSTEM_PROMPTS, ALL_CATEGORIES } from "../../shared/prompt-categories";

/** Trailer that keeps Grok in pure text-rewrite mode (no coding-agent tool loop). */
export const GROK_REWRITE_ONLY_TRAILER = [
  "",
  "CRITICAL RUNTIME RULES:",
  "- You only rewrite the user's dictated text into a better AI prompt.",
  "- Output ONLY that improved prompt — no preamble, no commentary, no code fences around the whole answer.",
  "- Do NOT implement the request, explore files, edit code, or call tools.",
  "- Do NOT search the web or inspect a repository.",
].join("\n");

/**
 * Wraps a system prompt in the preferred format for the target CLI tool.
 * Claude prefers XML-tagged instructions, Codex works best with markdown
 * headers, and Kimi/Grok take plain text.
 */
export function formatForTool(basePrompt: string, tool: ImproverTool): string {
  switch (tool) {
    case "claude":
      return `<instructions>\n${basePrompt}\n</instructions>`;
    case "codex":
      return `## System Instructions\n\n${basePrompt}`;
    case "kimi":
      return basePrompt;
    case "grok":
      return `${basePrompt}${GROK_REWRITE_ONLY_TRAILER}`;
  }
}

/**
 * Returns the full system prompt for a given category and tool,
 * falling back to a custom prompt if provided.
 */
export function getSystemPromptForCategory(
  category: PromptCategory,
  tool: ImproverTool,
  customOverride?: string,
): string {
  const base = customOverride?.trim() || CATEGORY_SYSTEM_PROMPTS[category];
  return formatForTool(base, tool);
}
