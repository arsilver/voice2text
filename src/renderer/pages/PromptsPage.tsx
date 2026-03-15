import { useEffect, useState } from "react";

import type { PromptCard, SavePromptCardInput } from "@shared/types";

interface PromptsPageProps {
  prompts: PromptCard[];
  onAdd: (entry: SavePromptCardInput) => Promise<void>;
  onUpdate: (id: string, entry: SavePromptCardInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCopy: (id: string) => Promise<void>;
}

const EMPTY_FORM: SavePromptCardInput = {
  title: "",
  body: "",
};

export function PromptsPage({ prompts, onAdd, onUpdate, onDelete, onCopy }: PromptsPageProps) {
  const [form, setForm] = useState<SavePromptCardInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [copyingId, setCopyingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [expandedId, setExpandedId] = useState("");

  useEffect(() => {
    if (editingId && !prompts.some((prompt) => prompt.id === editingId)) {
      resetEditor();
    }
  }, [editingId, prompts]);

  const isSaving = saveState === "saving";
  const editorTitle = editingId ? "Edit prompt" : "New prompt";

  async function handleSubmit() {
    if (!form.title.trim() || !form.body.trim()) {
      return;
    }

    setSaveState("saving");
    setSaveMessage(editingId ? "Saving..." : "Adding...");

    try {
      if (editingId) {
        await onUpdate(editingId, form);
        setSaveMessage("Updated.");
      } else {
        await onAdd(form);
        setSaveMessage("Added.");
      }

      setSaveState("saved");
      resetEditor();
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error instanceof Error ? error.message : "Unable to save prompt.");
    }
  }

  function resetEditor() {
    setEditingId("");
    setForm(EMPTY_FORM);
    if (saveState !== "error") {
      setSaveState("idle");
    }
  }

  function startEditing(prompt: PromptCard) {
    setEditingId(prompt.id);
    setForm({
      title: prompt.title,
      body: prompt.body,
    });
    setSaveState("idle");
    setSaveMessage("");
  }

  return (
    <div className="split-layout split-layout-prompts">
      <section className="panel split-editor-panel">
        <div className="section-heading-row section-heading-row-tight">
          <div>
            <h1>{editorTitle}</h1>
            <p>Local copy-first snippets for agent work.</p>
          </div>
          {saveMessage ? <div className={`inline-feedback feedback-${saveState === "error" ? "error" : saveState === "saved" ? "success" : "warning"}`}>{saveMessage}</div> : null}
        </div>

        <div className="page-stack">
          <label className="field">
            <span>Title</span>
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Bug triage" />
          </label>

          <label className="field">
            <span>Prompt</span>
            <textarea
              value={form.body}
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Write the reusable prompt body here."
              rows={8}
            />
          </label>

          <div className="panel-actions split-editor-actions">
            {editingId ? (
              <button className="ghost-button compact-button" disabled={isSaving} onClick={() => resetEditor()}>
                Cancel
              </button>
            ) : null}
            <button className="primary-button compact-button" disabled={isSaving || !form.title.trim() || !form.body.trim()} onClick={() => void handleSubmit()}>
              {isSaving ? "Saving..." : editingId ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel split-list-panel">
        <div className="section-heading-row section-heading-row-tight">
          <div>
            <h1>Saved prompts</h1>
            <p>{prompts.length} ready to copy.</p>
          </div>
        </div>

        {prompts.length === 0 ? (
          <div className="empty-state empty-state-compact">No prompts saved yet.</div>
        ) : (
          <div className="prompt-list">
            {prompts.map((prompt) => {
              const isExpanded = expandedId === prompt.id;
              return (
                <article key={prompt.id} className={`prompt-list-item${isExpanded ? " prompt-list-item-expanded" : ""}`}>
                  <div
                    className="prompt-list-head"
                    onClick={() => setExpandedId(isExpanded ? "" : prompt.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="prompt-list-copy">
                      <strong>{prompt.title}</strong>
                      {!isExpanded && (
                        <div className="history-meta">
                          <span>{new Date(prompt.updatedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <span className="prompt-chevron">{isExpanded ? "▾" : "▸"}</span>
                  </div>
                  {isExpanded && (
                    <>
                      <div className="history-meta" style={{ marginTop: 4 }}>
                        <span>{new Date(prompt.updatedAt).toLocaleString()}</span>
                      </div>
                      <div className="prompt-list-body">{prompt.body}</div>
                      <div className="prompt-list-actions" style={{ marginTop: 6 }}>
                        <button
                          className="ghost-button compact-button"
                          disabled={copyingId === prompt.id || deletingId === prompt.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setCopyingId(prompt.id);
                            try {
                              await onCopy(prompt.id);
                            } finally {
                              window.setTimeout(() => setCopyingId(""), 500);
                            }
                          }}
                        >
                          {copyingId === prompt.id ? "Copied" : "Copy"}
                        </button>
                        <button className="ghost-button compact-button" disabled={deletingId === prompt.id} onClick={(e) => { e.stopPropagation(); startEditing(prompt); }}>
                          Edit
                        </button>
                        <button
                          className="ghost-button danger-button compact-button"
                          disabled={copyingId === prompt.id || deletingId === prompt.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            setDeletingId(prompt.id);
                            try {
                              await onDelete(prompt.id);
                              if (editingId === prompt.id) {
                                resetEditor();
                              }
                            } finally {
                              setDeletingId("");
                            }
                          }}
                        >
                          {deletingId === prompt.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
