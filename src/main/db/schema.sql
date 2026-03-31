CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  final_text TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  transcription_ms INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  target_app TEXT NOT NULL DEFAULT '',
  was_pasted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id TEXT PRIMARY KEY,
  original_text TEXT NOT NULL UNIQUE,
  replacement_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dictionary_original ON dictionary_entries(original_text);
CREATE INDEX IF NOT EXISTS idx_prompt_cards_updated_at ON prompt_cards(updated_at DESC);

CREATE TABLE IF NOT EXISTS improved_prompts (
  id TEXT PRIMARY KEY,
  transcription_id TEXT,
  created_at TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  improved_text TEXT NOT NULL,
  tool TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  duration_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_improved_prompts_created_at ON improved_prompts(created_at DESC);
