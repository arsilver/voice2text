import { randomUUID } from "node:crypto";

import { getDb } from "./database";
import type { ImprovedPrompt, ImproverTool, PromptCategory } from "@shared/types";

export interface SaveImprovedPromptInput {
  transcriptionId: string | null;
  rawInput: string;
  improvedText: string;
  tool: ImproverTool;
  category: PromptCategory;
  durationMs: number;
}

export function listImprovedPrompts(limit = 50, offset = 0): ImprovedPrompt[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM improved_prompts ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as DbImprovedPromptRow[];
  return rows.map(mapRow);
}

export function saveImprovedPrompt(input: SaveImprovedPromptInput): ImprovedPrompt {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO improved_prompts (id, transcription_id, created_at, raw_input, improved_text, tool, category, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.transcriptionId, now, input.rawInput, input.improvedText, input.tool, input.category, input.durationMs);

  return getImprovedPrompt(id);
}

export function getImprovedPrompt(id: string): ImprovedPrompt {
  const db = getDb();
  const row = db.prepare("SELECT * FROM improved_prompts WHERE id = ?").get(id) as DbImprovedPromptRow | undefined;

  if (!row) {
    throw new Error("Improved prompt not found.");
  }

  return mapRow(row);
}

export function deleteImprovedPrompt(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM improved_prompts WHERE id = ?").run(id);
}

interface DbImprovedPromptRow {
  id: string;
  transcription_id: string | null;
  created_at: string;
  raw_input: string;
  improved_text: string;
  tool: string;
  category: string;
  duration_ms: number;
}

function mapRow(row: DbImprovedPromptRow): ImprovedPrompt {
  return {
    id: row.id,
    transcriptionId: row.transcription_id,
    createdAt: row.created_at,
    rawInput: row.raw_input,
    improvedText: row.improved_text,
    tool: row.tool as ImproverTool,
    category: (row.category || "general") as PromptCategory,
    durationMs: row.duration_ms,
  };
}
