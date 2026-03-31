import type { ImproverTool, PromptCategory } from "@shared/types";
import { CATEGORY_SYSTEM_PROMPTS } from "@shared/prompt-categories";

export { CATEGORY_LABELS, CATEGORY_SYSTEM_PROMPTS, ALL_CATEGORIES } from "@shared/prompt-categories";

/**
 * Wraps a system prompt in the preferred format for the target CLI tool.
 * Claude prefers XML-tagged instructions, Codex works best with markdown
 * headers, and Kimi takes plain text.
 */
export function formatForTool(basePrompt: string, tool: ImproverTool): string {
  switch (tool) {
    case "claude":
      return `<instructions>\n${basePrompt}\n</instructions>`;
    case "codex":
      return `## System Instructions\n\n${basePrompt}`;
    case "kimi":
      return basePrompt;
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
