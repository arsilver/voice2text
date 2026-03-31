import electron from "electron";

import type { ImproveResult, ImproverLogEntry, ImproverState, ImproverTool, PromptCategory } from "@shared/types";
import { getLogger } from "@main/utils/logger";
import { broadcast } from "@main/windows";
import { IPC_CHANNELS } from "@shared/types";
import { getSettings } from "@main/db/settings";
import { saveImprovedPrompt, type SaveImprovedPromptInput } from "@main/db/improved-prompts";
import { improveWithCli, type CliExecution } from "./cli-executor";
import { classifyIntent } from "./intent-classifier";
import { sanitizeOutput, checkOutputLength } from "./output-sanitizer";
import { CATEGORY_LABELS } from "@shared/prompt-categories";

const log = getLogger("prompt-improver");

let improverState: ImproverState = "idle";
let activeExecution: CliExecution | null = null;

export function getImproverState() {
  return improverState;
}

function setImproverState(state: ImproverState) {
  improverState = state;
  broadcast(IPC_CHANNELS.improverStateChanged, state);
}

function emitLog(level: ImproverLogEntry["level"], message: string) {
  const entry: ImproverLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  broadcast(IPC_CHANNELS.improverLog, entry);
}

export async function handleImprovePrompt(rawText: string, transcriptionId?: string, categoryOverride?: PromptCategory) {
  if (improverState === "improving") {
    log.warn("Improvement already in progress, ignoring request");
    emitLog("warn", "Improvement already in progress, ignoring request.");
    return;
  }

  const settings = getSettings();
  const tool: ImproverTool = settings.improverTool;
  const customSystemPrompt: string = settings.improverSystemPrompt;

  // Classify intent or use the caller-supplied override.
  const { category, confidence } = classifyIntent(rawText);
  const finalCategory = categoryOverride ?? category;
  log.info("Intent classified", { detected: category, confidence, override: categoryOverride ?? null, final: finalCategory });
  emitLog("info", `Category: ${CATEGORY_LABELS[finalCategory]} (confidence: ${(confidence * 100).toFixed(0)}%${categoryOverride ? ", user override" : ""})`);

  setImproverState("improving");
  const startedAt = Date.now();
  emitLog("info", `Starting ${tool}...`);

  try {
    const execution = improveWithCli(rawText, tool, finalCategory, customSystemPrompt || undefined);
    activeExecution = execution;
    emitLog("info", `Waiting for ${tool} response...`);

    const rawOutput = await execution.promise;
    activeExecution = null;

    // Sanitize: strip model preamble/commentary
    const { text: improvedText, stripped } = sanitizeOutput(rawOutput);
    for (const msg of stripped) {
      emitLog("info", msg);
    }

    // Length sanity check
    const lengthWarning = checkOutputLength(rawText, improvedText);
    if (lengthWarning) {
      emitLog("warn", lengthWarning);
    }

    const durationMs = Date.now() - startedAt;

    const saved = saveImprovedPrompt({
      transcriptionId: transcriptionId ?? null,
      rawInput: rawText,
      improvedText,
      tool,
      category: finalCategory,
      durationMs,
    } satisfies SaveImprovedPromptInput);

    if (settings.improverAutoCopy) {
      electron.clipboard.writeText(improvedText);
      log.info("Improved text copied to clipboard", { chars: improvedText.length });
    }

    const result: ImproveResult = {
      id: saved.id,
      rawInput: rawText,
      improvedText,
      tool,
      category: finalCategory,
      durationMs,
    };

    setImproverState("done");
    broadcast(IPC_CHANNELS.improverResult, result);
    emitLog("info", `Done in ${(durationMs / 1000).toFixed(1)}s (${improvedText.length} chars). ${settings.improverAutoCopy ? "Copied to clipboard." : ""}`);
    log.info("Improvement complete", { tool, category: finalCategory, durationMs, outputLength: improvedText.length });
  } catch (error) {
    activeExecution = null;
    setImproverState("error");
    const message = error instanceof Error ? error.message : "Unknown error";
    broadcast(IPC_CHANNELS.improverError, message);
    emitLog("error", message);
    log.error("Improvement failed", { tool, error: message });
  }
}

export function cancelActiveImprovement() {
  if (activeExecution) {
    activeExecution.cancel();
    activeExecution = null;
    setImproverState("idle");
    emitLog("warn", "Improvement cancelled by user.");
    log.info("Improvement cancelled by user");
  }
}
