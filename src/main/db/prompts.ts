import { randomUUID } from "node:crypto";

import { getDb } from "./database";
import type { PromptCard, SavePromptCardInput } from "@shared/types";

export function listPromptCards() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM prompt_cards ORDER BY updated_at DESC").all() as DbPromptRow[];
  return rows.map(mapPromptCard);
}

export function addPromptCard(entry: SavePromptCardInput) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO prompt_cards (id, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, entry.title.trim(), entry.body.trim(), now, now);

  return getPromptCard(id);
}

export function updatePromptCard(id: string, entry: SavePromptCardInput) {
  const db = getDb();

  db.prepare(
    `UPDATE prompt_cards
     SET title = ?, body = ?, updated_at = ?
     WHERE id = ?`
  ).run(entry.title.trim(), entry.body.trim(), new Date().toISOString(), id);

  return getPromptCard(id);
}

export function deletePromptCard(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM prompt_cards WHERE id = ?").run(id);
}

export function getPromptCard(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM prompt_cards WHERE id = ?").get(id) as DbPromptRow | undefined;

  if (!row) {
    throw new Error("Prompt card not found.");
  }

  return mapPromptCard(row);
}

interface DbPromptRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function mapPromptCard(row: DbPromptRow): PromptCard {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
