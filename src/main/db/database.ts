import Database from "better-sqlite3";

import { getDatabasePath } from "@main/utils/paths";
import schemaSql from "./schema.sql?raw";

let database: Database.Database | null = null;

export function getDb() {
  if (!database) {
    database = new Database(getDatabasePath());
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.exec(schemaSql);
    runMigrations(database);
  }

  return database;
}

function runMigrations(db: Database.Database) {
  // Add category column to improved_prompts if it doesn't exist yet.
  const columns = db.pragma("table_info(improved_prompts)") as { name: string }[];
  const hasCategory = columns.some((c) => c.name === "category");
  if (!hasCategory) {
    db.prepare("ALTER TABLE improved_prompts ADD COLUMN category TEXT NOT NULL DEFAULT 'general'").run();
  }
}

export function closeDb() {
  database?.close();
  database = null;
}
