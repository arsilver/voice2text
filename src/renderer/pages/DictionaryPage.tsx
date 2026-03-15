import { useState } from "react";

import type { DictionaryEntry } from "@shared/types";

interface DictionaryPageProps {
  entries: DictionaryEntry[];
  onAdd: (entry: { original: string; replacement: string; category: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function DictionaryPage({ entries, onAdd, onDelete }: DictionaryPageProps) {
  const [form, setForm] = useState({ original: "", replacement: "", category: "" });
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading-row section-heading-row-tight">
          <div>
            <h1>Replacement dictionary</h1>
            <p>Protect names, commands, and shorthand.</p>
          </div>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Original term</span>
            <input value={form.original} onChange={(event) => setForm({ ...form, original: event.target.value })} placeholder="web hook" />
          </label>
          <label className="field">
            <span>Replacement</span>
            <input value={form.replacement} onChange={(event) => setForm({ ...form, replacement: event.target.value })} placeholder="webhook" />
          </label>
          <label className="field field-full">
            <span>Category</span>
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="framework, acronym, command" />
          </label>
        </div>

        <button
          className="primary-button compact-button"
          disabled={isAdding}
          onClick={async () => {
            if (!form.original.trim() || !form.replacement.trim()) {
              return;
            }

            setIsAdding(true);
            try {
              await onAdd(form);
              setForm({ original: "", replacement: "", category: "" });
            } finally {
              setIsAdding(false);
            }
          }}
        >
          {isAdding ? "Adding..." : "Add term"}
        </button>
      </section>

      <section className="panel">
        <div className="section-heading-row section-heading-row-tight">
          <div>
            <h2>Saved Terms</h2>
            <p>{entries.length} local replacements.</p>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">No terms saved yet.</div>
        ) : (
          <div className="dictionary-list">
            {entries.map((entry) => (
              <div key={entry.id} className="dictionary-item">
                <div>
                  <strong>{entry.original}</strong>
                  <p>{entry.category ? `${entry.replacement} | ${entry.category}` : entry.replacement}</p>
                </div>
                <button
                  className="ghost-button danger-button compact-button"
                  disabled={deletingId === entry.id}
                  onClick={async () => {
                    setDeletingId(entry.id);
                    try {
                      await onDelete(entry.id);
                    } finally {
                      setDeletingId("");
                    }
                  }}
                >
                  {deletingId === entry.id ? "Removing..." : "Remove"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
