import { randomUUID } from "node:crypto";

import { getDb } from "./database";
import type { DictionaryEntry, SaveDictionaryInput } from "@shared/types";

let cachedEntries: DictionaryEntry[] | null = null;

function invalidateCache() {
  cachedEntries = null;
}

function getCachedEntries() {
  if (!cachedEntries) {
    cachedEntries = listDictionaryEntries();
  }

  return cachedEntries;
}

export function listDictionaryEntries(search = "") {
  const db = getDb();
  const query = search.trim()
    ? db.prepare(
        "SELECT * FROM dictionary_entries WHERE original_text LIKE ? OR replacement_text LIKE ? ORDER BY updated_at DESC"
      )
    : db.prepare("SELECT * FROM dictionary_entries ORDER BY updated_at DESC");
  const rows = search.trim()
    ? (query.all(`%${search}%`, `%${search}%`) as DbDictionaryRow[])
    : (query.all() as DbDictionaryRow[]);

  return rows.map(mapDictionary);
}

export function addDictionaryEntry(entry: SaveDictionaryInput) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO dictionary_entries (id, original_text, replacement_text, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, entry.original.trim(), entry.replacement.trim(), entry.category.trim(), now, now);

  invalidateCache();
  return getDictionaryEntry(id);
}

export function updateDictionaryEntry(id: string, entry: SaveDictionaryInput) {
  const db = getDb();
  db.prepare(
    `UPDATE dictionary_entries
     SET original_text = ?, replacement_text = ?, category = ?, updated_at = ?
     WHERE id = ?`
  ).run(entry.original.trim(), entry.replacement.trim(), entry.category.trim(), new Date().toISOString(), id);

  invalidateCache();
  return getDictionaryEntry(id);
}

export function deleteDictionaryEntry(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM dictionary_entries WHERE id = ?").run(id);
  invalidateCache();
}

export function applyDictionary(text: string) {
  let output = text;
  for (const entry of getCachedEntries()) {
    const pattern = new RegExp(escapeRegExp(entry.original), "gi");
    output = output.replace(pattern, entry.replacement);
  }
  return output;
}

function getDictionaryEntry(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM dictionary_entries WHERE id = ?").get(id) as DbDictionaryRow | undefined;

  if (!row) {
    throw new Error("Dictionary entry not found.");
  }

  return mapDictionary(row);
}

interface DbDictionaryRow {
  id: string;
  original_text: string;
  replacement_text: string;
  category: string;
  created_at: string;
  updated_at: string;
}

function mapDictionary(row: DbDictionaryRow): DictionaryEntry {
  return {
    id: row.id,
    original: row.original_text,
    replacement: row.replacement_text,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

