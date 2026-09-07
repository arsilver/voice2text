import { useCallback, useEffect, useRef, useState } from "react";

import type { AppSettings, ImprovedPrompt, ImproverLogEntry, ImproveResult, ImproverState, ImproverTool, PromptCategory } from "@shared/types";
import { ALL_CATEGORIES, CATEGORY_LABELS, CATEGORY_SYSTEM_PROMPTS } from "@shared/prompt-categories";

interface PromptImproverPageProps {
  improvements: ImprovedPrompt[];
  settings: AppSettings;
  pendingTranscription?: string;
  onConsumeTranscription?: () => void;
  onImprove: (rawText: string, categoryOverride?: PromptCategory) => Promise<void>;
  onCancel: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCopy: (text: string) => void;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

const TOOL_LABELS: Record<ImproverTool, string> = {
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi",
  grok: "Grok",
};

const TOOLS: ImproverTool[] = ["claude", "codex", "kimi", "grok"];

/** Lightweight client-side keyword classifier (mirrors main process logic). */
function detectCategory(text: string): PromptCategory {
  const lower = text.toLowerCase();
  const scores: Partial<Record<PromptCategory, number>> = {};

  const rules: [PromptCategory, string[], number][] = [
    ["coding", ["implement", "function", "component", "endpoint", "api", "class", "module", "method", "hook", "route", "handler", "middleware", "callback", "async", "await", "react", "vue", "express", "vite", "tailwind", "write code", "add feature", "create component", "add a button", "add a page", "build a", "create a", "wire up", "integrate with"], 1],
    ["debugging", ["bug", "error", "fix", "broken", "crash", "failing", "exception", "stack trace", "null", "undefined", "timeout", "freeze", "hang", "slow", "leak", "race condition", "wrong", "incorrect", "missing", "doesn't work", "not working", "throws error", "breaks when", "fails when", "crashes when", "can't figure out why", "used to work", "regression"], 1],
    ["planning", ["plan", "strategy", "approach", "roadmap", "milestone", "timeline", "prioritize", "deadline", "sprint", "scope", "estimate", "backlog", "should we", "next steps", "action items", "what order", "how to approach", "where do we start", "what to prioritize"], 1],
    ["brainstorming", ["ideas", "brainstorm", "explore", "possibilities", "creative", "alternatives", "options", "imagine", "what if", "how about", "could we", "what are some", "ways to improve", "how might we", "any ideas for"], 1],
    ["architecture", ["architecture", "design", "system", "scale", "microservice", "database", "infrastructure", "pattern", "pipeline", "queue", "cache", "container", "kubernetes", "docker", "serverless", "event-driven", "tenant", "shard", "system design", "data model", "how to scale", "how should we structure"], 1],
    ["documentation", ["document", "readme", "docs", "explain", "guide", "tutorial", "docstring", "changelog", "wiki", "runbook", "spec", "write documentation", "add docs", "document this", "write a tutorial", "explain how"], 1],
    ["code-review", ["review", "pull request", "code review", "refactor", "clean up", "code quality", "lint", "tech debt", "readability", "complexity", "dead code", "check this pr", "review my changes", "is this code okay", "any issues with"], 1],
  ];

  for (const [cat, keywords, weight] of rules) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += weight;
    }
    if (score > 0) scores[cat] = score;
  }

  let best: PromptCategory = "general";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = cat as PromptCategory;
    }
  }
  return best;
}

export function PromptImproverPage({
  improvements,
  settings,
  pendingTranscription,
  onConsumeTranscription,
  onImprove,
  onCancel,
  onDelete,
  onCopy,
  onSaveSettings,
}: PromptImproverPageProps) {
  const [rawInput, setRawInput] = useState("");
  const [improvedText, setImprovedText] = useState("");
  const [improverState, setImproverState] = useState<ImproverState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [availableTools, setAvailableTools] = useState<Record<ImproverTool, boolean>>({ claude: false, codex: false, kimi: false, grok: false });
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [templatePreviewCategory, setTemplatePreviewCategory] = useState<PromptCategory>("general");
  const [detectedCategory, setDetectedCategory] = useState<PromptCategory>("general");
  const [categoryOverride, setCategoryOverride] = useState<PromptCategory | null>(null);
  const activeCategory = categoryOverride ?? detectedCategory;
  const [logEntries, setLogEntries] = useState<ImproverLogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [leftFraction, setLeftFraction] = useState(0.6);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startFraction = leftFraction;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = startFraction + dx / rect.width;
      setLeftFraction(Math.max(0.3, Math.min(0.75, next)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [leftFraction]);

  // Auto-populate raw input from voice transcription
  useEffect(() => {
    if (pendingTranscription && improverState !== "improving") {
      setRawInput(pendingTranscription);
      onConsumeTranscription?.();
    }
  }, [pendingTranscription, improverState, onConsumeTranscription]);

  useEffect(() => {
    setDetectedCategory(detectCategory(rawInput));
    setCategoryOverride(null);
  }, [rawInput]);

  // Keep template preview in sync with active category
  useEffect(() => {
    setTemplatePreviewCategory(activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEntries]);

  useEffect(() => {
    void window.craftvoice.improver.detectTools().then(setAvailableTools);

    const unsubState = window.craftvoice.improver.onStateChange(setImproverState);
    const unsubResult = window.craftvoice.improver.onResult((result: ImproveResult) => {
      setImprovedText(result.improvedText);
      setErrorMessage("");
    });
    const unsubError = window.craftvoice.improver.onError((msg: string) => {
      setErrorMessage(msg);
    });
    const unsubLog = window.craftvoice.improver.onLog((entry: ImproverLogEntry) => {
      setLogEntries((prev) => [...prev.slice(-99), entry]);
    });

    return () => {
      unsubState();
      unsubResult();
      unsubError();
      unsubLog();
    };
  }, []);

  async function handleImprove() {
    if (!rawInput.trim() || improverState === "improving") return;
    setImprovedText("");
    setErrorMessage("");
    try {
      await onImprove(rawInput.trim(), activeCategory);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error during improvement";
      setErrorMessage(msg);
    }
  }

  function handleCopyResult() {
    if (!improvedText) return;
    onCopy(improvedText);
  }

  return (
    <div
      className="split-layout split-layout-improver"
      ref={containerRef}
      style={{ gridTemplateColumns: `${leftFraction}fr 6px ${1 - leftFraction}fr` }}
    >
      <section className="panel split-editor-panel page-stack">
        <div className="section-heading-row section-heading-row-tight">
          <div>
            <h1>Improve prompt</h1>
            <p>Paste or dictate rough text, then improve it with AI.</p>
          </div>
        </div>

        <div className="page-stack">
          <label className="field">
            <span>Raw input</span>
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Paste your voice-to-text transcription here, or dictate and it will appear in history..."
              rows={5}
            />
          </label>

          {rawInput.trim() && (
            <div className="category-chips">
              {ALL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`category-chip${activeCategory === cat ? " category-chip-active" : ""}`}
                  onClick={() => setCategoryOverride(cat === detectedCategory ? null : cat)}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}

          <div className="improver-controls">
            <select
              className="improver-tool-select"
              value={settings.improverTool}
              onChange={(e) => void onSaveSettings({ improverTool: e.target.value as ImproverTool })}
            >
              {TOOLS.map((tool) => (
                <option key={tool} value={tool} disabled={!availableTools[tool]}>
                  {TOOL_LABELS[tool]}{availableTools[tool] ? "" : " (not found)"}
                </option>
              ))}
            </select>
            {improverState === "improving" ? (
              <button className="ghost-button compact-button" onClick={() => void onCancel()}>
                Cancel
              </button>
            ) : (
              <button
                className="primary-button compact-button"
                disabled={!rawInput.trim()}
                onClick={() => void handleImprove()}
              >
                Improve
              </button>
            )}
          </div>

          {errorMessage && (
            <div className="inline-feedback feedback-error">{errorMessage}</div>
          )}

          {improverState === "improving" && (
            <div className="inline-feedback feedback-warning">Improving with {TOOL_LABELS[settings.improverTool]}...</div>
          )}

          {improvedText && (
            <label className="field">
              <span>Improved prompt</span>
              <textarea value={improvedText} readOnly rows={8} className="improved-output" />
            </label>
          )}

          {improvedText && (
            <div className="panel-actions split-editor-actions">
              <button className="primary-button compact-button" onClick={handleCopyResult}>
                Copy result
              </button>
            </div>
          )}

          <div className="improver-settings-toggle">
            <button className="ghost-button compact-button" onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
              {showSystemPrompt ? "Hide system prompt" : "Custom system prompt"}
            </button>
          </div>

          {showSystemPrompt && (
            <>
              <label className="field">
                <span>Custom override (leave empty to use the template below)</span>
                <textarea
                  value={settings.improverSystemPrompt}
                  onChange={(e) => void onSaveSettings({ improverSystemPrompt: e.target.value })}
                  placeholder="Your custom system prompt..."
                  rows={4}
                />
              </label>
              <div className="field">
                <div className="template-header">
                  <span>Template:</span>
                  <select
                    className="template-category-select"
                    value={templatePreviewCategory}
                    onChange={(e) => setTemplatePreviewCategory(e.target.value as PromptCategory)}
                  >
                    {ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}{cat === activeCategory ? " (active)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="template-preview"
                  value={CATEGORY_SYSTEM_PROMPTS[templatePreviewCategory]}
                  readOnly
                  rows={14}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <div className="resize-handle" onMouseDown={handleResizeStart} />

      <section className="improver-right-stack">
        <div className="panel improver-log-section">
          <div className="improver-section-header">
            <span className="improver-section-title">Logs</span>
            {logEntries.length > 0 && (
              <button className="ghost-button compact-button" onClick={() => setLogEntries([])}>Clear</button>
            )}
          </div>
          <div className="improver-log-panel">
            {logEntries.length === 0 ? (
              <div className="empty-state empty-state-compact">No logs yet.</div>
            ) : (
              <div className="improver-log-list">
                {logEntries.map((entry, i) => (
                  <div key={i} className={`improver-log-entry improver-log-${entry.level}`}>
                    <span className="improver-log-time">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="improver-log-msg">{entry.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="panel improver-history-section-panel">
          <div className="improver-section-header">
            <span className="improver-section-title">History ({improvements.length})</span>
          </div>
          {improvements.length === 0 ? (
            <div className="empty-state empty-state-compact">No improvements yet.</div>
          ) : (
            <div className="prompt-list">
              {improvements.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <article
                    key={item.id}
                    className={`prompt-list-item${isExpanded ? " prompt-list-item-expanded" : ""}`}
                  >
                    <div
                      className="prompt-list-head"
                      onClick={() => setExpandedId(isExpanded ? "" : item.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="prompt-list-copy">
                        <strong className="improver-history-preview">
                          {item.rawInput.slice(0, 80)}{item.rawInput.length > 80 ? "..." : ""}
                        </strong>
                        {!isExpanded && (
                          <div className="history-meta">
                            <span className="improver-tool-badge">{TOOL_LABELS[item.tool]}</span>
                            <span className="category-badge">{CATEGORY_LABELS[item.category]}</span>
                            <span>{new Date(item.createdAt).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                      <span className="prompt-chevron">{isExpanded ? "\u25BE" : "\u25B8"}</span>
                    </div>
                    {isExpanded && (
                      <>
                        <div className="history-meta" style={{ marginTop: 4 }}>
                          <span className="improver-tool-badge">{TOOL_LABELS[item.tool]}</span>
                          <span className="category-badge">{CATEGORY_LABELS[item.category]}</span>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                          <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                        </div>
                        <div className="improver-history-section">
                          <span className="improver-history-label">Raw</span>
                          <div className="prompt-list-body">{item.rawInput}</div>
                        </div>
                        <div className="improver-history-section improver-history-section-improved">
                          <span className="improver-history-label">Improved</span>
                          <div className="prompt-list-body">{item.improvedText}</div>
                        </div>
                        <div className="prompt-list-actions" style={{ marginTop: 6 }}>
                          <button
                            className="ghost-button compact-button"
                            disabled={copiedId === item.id || deletingId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCopy(item.improvedText);
                              setCopiedId(item.id);
                              window.setTimeout(() => setCopiedId(""), 500);
                            }}
                          >
                            {copiedId === item.id ? "Copied" : "Copy"}
                          </button>
                          <button
                            className="ghost-button compact-button"
                            disabled={deletingId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRawInput(item.rawInput);
                            }}
                          >
                            Re-use input
                          </button>
                          <button
                            className="ghost-button danger-button compact-button"
                            disabled={copiedId === item.id || deletingId === item.id}
                            onClick={async (e) => {
                              e.stopPropagation();
                              setDeletingId(item.id);
                              try {
                                await onDelete(item.id);
                                if (expandedId === item.id) setExpandedId("");
                              } finally {
                                setDeletingId("");
                              }
                            }}
                          >
                            {deletingId === item.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
