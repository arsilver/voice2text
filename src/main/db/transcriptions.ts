import electron from "electron";
import { randomUUID } from "node:crypto";

import { getDb } from "./database";
import type { DashboardStats, SaveTranscriptionInput, TranscriptionRecord } from "@shared/types";

const { clipboard } = electron;

export function saveTranscription(input: SaveTranscriptionInput) {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO transcriptions (
      id, created_at, raw_text, final_text, duration_ms, transcription_ms,
      provider, model, target_app, was_pasted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    createdAt,
    input.rawText,
    input.finalText,
    input.durationMs,
    input.transcriptionMs,
    input.provider,
    input.model,
    input.targetApp,
    input.wasPasted ? 1 : 0
  );

  return getTranscription(id);
}

export function getTranscription(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM transcriptions WHERE id = ?").get(id) as DbTranscriptionRow | undefined;

  if (!row) {
    throw new Error("Transcription not found.");
  }

  return mapTranscription(row);
}

export function listTranscriptions(limit = 50, offset = 0) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM transcriptions ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as DbTranscriptionRow[];
  return rows.map(mapTranscription);
}

export function deleteTranscription(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
}

export function reinsertTranscription(id: string) {
  const transcription = getTranscription(id);
  clipboard.writeText(transcription.finalText);
  return transcription.finalText.length > 0;
}

export function getDashboardStats(): DashboardStats {
  const db = getDb();
  const rows = db
    .prepare("SELECT final_text, duration_ms, created_at FROM transcriptions ORDER BY created_at DESC")
    .all() as { final_text: string; duration_ms: number; created_at: string }[];

  const totalWords = rows.reduce((count, row) => count + row.final_text.trim().split(/\s+/).filter(Boolean).length, 0);
  const speakingTimeMs = rows.reduce((sum, row) => sum + row.duration_ms, 0);
  const sessions = rows.length;
  const averagePace = speakingTimeMs > 0 ? Math.round(totalWords / (speakingTimeMs / 60000)) : 0;

  return {
    totalWords,
    speakingTimeMs,
    sessions,
    averagePace,
    lastUpdatedAt: rows[0]?.created_at ?? null,
  };
}

interface DbTranscriptionRow {
  id: string;
  created_at: string;
  raw_text: string;
  final_text: string;
  duration_ms: number;
  transcription_ms: number;
  provider: TranscriptionRecord["provider"];
  model: string;
  target_app: string;
  was_pasted: number;
}

function mapTranscription(row: DbTranscriptionRow): TranscriptionRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    rawText: row.raw_text,
    finalText: row.final_text,
    durationMs: row.duration_ms,
    transcriptionMs: row.transcription_ms,
    provider: row.provider,
    model: row.model,
    targetApp: row.target_app,
    wasPasted: row.was_pasted === 1,
  };
}
