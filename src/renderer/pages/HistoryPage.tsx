import { formatProviderName } from "@shared/provider-order";
import { useState } from "react";

import type { TranscriptionRecord } from "@shared/types";

interface HistoryPageProps {
  items: TranscriptionRecord[];
  hasMore: boolean;
  onDelete: (id: string) => Promise<void>;
  onReinsert: (id: string) => Promise<void>;
  onLoadMore: () => Promise<void>;
}

export function HistoryPage({ items, hasMore, onDelete, onReinsert, onLoadMore }: HistoryPageProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const [pendingReinsertId, setPendingReinsertId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  async function handleCopy(item: TranscriptionRecord) {
    const text = item.finalText || item.rawText;
    if (!text) return;
    setCopiedId(item.id);
    try {
      await navigator.clipboard.writeText(text);
    } finally {
      window.setTimeout(() => setCopiedId(""), 600);
    }
  }

  return (
    <section className="panel page-stack">
      <div className="section-heading-row section-heading-row-tight">
        <div>
          <h1>Stored transcripts</h1>
          <p>Compact transcript history with one-click reinsert.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">No transcriptions yet. Use the hotkey to start your first session.</div>
      ) : (
        <div className="history-list">
          {items.map((item: TranscriptionRecord) => (
            <article key={item.id} className="history-item">
              <div className="history-item-header">
                <div className="history-meta">
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                  <span>{formatProviderName(item.provider)}</span>
                  <span>{item.model}</span>
                  <span>{Math.round(item.durationMs / 1000)}s</span>
                  <span>{item.transcriptionMs}ms</span>
                </div>
                <div className="history-actions">
                  <button
                    className="ghost-button compact-button"
                    disabled={copiedId === item.id}
                    onClick={() => void handleCopy(item)}
                  >
                    {copiedId === item.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    className="ghost-button compact-button"
                    disabled={pendingDeleteId === item.id || pendingReinsertId === item.id}
                    onClick={async () => {
                      setPendingReinsertId(item.id);
                      try {
                        await onReinsert(item.id);
                      } finally {
                        setPendingReinsertId("");
                      }
                    }}
                  >
                    {pendingReinsertId === item.id ? "..." : "Reinsert"}
                  </button>
                  <button
                    className="ghost-button danger-button compact-button"
                    disabled={pendingDeleteId === item.id || pendingReinsertId === item.id}
                    onClick={async () => {
                      setPendingDeleteId(item.id);
                      try {
                        await onDelete(item.id);
                      } finally {
                        setPendingDeleteId("");
                      }
                    }}
                  >
                    {pendingDeleteId === item.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
              <div className="history-text">{item.finalText || item.rawText}</div>
            </article>
          ))}
          {hasMore ? (
            <button
              className="ghost-button compact-button"
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                try {
                  await onLoadMore();
                } finally {
                  setLoadingMore(false);
                }
              }}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
