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
  }

  return database;
}

export function closeDb() {
  database?.close();
  database = null;
}
