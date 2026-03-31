import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { RecordingController } from "@renderer/components/RecordingController";
import { Sidebar } from "@renderer/components/Sidebar";
import { DictionaryPage } from "@renderer/pages/DictionaryPage";
import { HistoryPage } from "@renderer/pages/HistoryPage";
import { OverviewPage } from "@renderer/pages/OverviewPage";
import { PromptImproverPage } from "@renderer/pages/PromptImproverPage";
import { PromptsPage } from "@renderer/pages/PromptsPage";
import { SettingsPage } from "@renderer/pages/SettingsPage";
import { ShortcutsPage } from "@renderer/pages/ShortcutsPage";
import { reportStartupStageOnce } from "@renderer/startup-heartbeat";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { formatProviderName } from "@shared/provider-order";
import type {
  AppSettings,
  DashboardStats,
  DictionaryEntry,
  HotkeyStatus,
  ImprovedPrompt,
  LocalModelInfo,
  PromptCard,
  ProviderHealth,
  ProviderId,
  RecordingState,
  SettingsSaveInput,
  TranscriptionRecord,
  TranscriptionResult,
  WhisperModelOption,
} from "@shared/types";

const EMPTY_STATS: DashboardStats = {
  totalWords: 0,
  speakingTimeMs: 0,
  sessions: 0,
  averagePace: 0,
  lastUpdatedAt: null,
};

const ROUTE_LABELS: Record<string, string> = {
  "/overview": "Overview",
  "/prompts": "Prompts",
  "/history": "History",
  "/dictionary": "Dictionary",
  "/shortcuts": "Shortcuts",
  "/settings": "Settings",
  "/prompt-improver": "Improver",
};

export function App() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [prompts, setPrompts] = useState<PromptCard[]>([]);
  const [improvements, setImprovements] = useState<ImprovedPrompt[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [whisperModels, setWhisperModels] = useState<WhisperModelOption[]>([]);
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus>({
    accelerator: DEFAULT_SETTINGS.hotkey,
    registered: false,
    message: "Checking hotkey...",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [lastTranscriptionText, setLastTranscriptionText] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);
  const [headerAction, setHeaderAction] = useState<"idle" | "toggling" | "minimizing">("idle");
  const noticeTimeoutRef = useRef<number | null>(null);
  const location = useLocation();

  const HISTORY_PAGE_SIZE = 50;

  const refreshData = useEffectEvent(async () => {
    const [nextStats, nextHistory, nextDictionary, nextPrompts, nextImprovements, nextSettings, nextHealth, nextHotkeyStatus] = await Promise.all([
      window.craftvoice.stats.get(),
      window.craftvoice.transcriptions.list(HISTORY_PAGE_SIZE),
      window.craftvoice.dictionary.list(),
      window.craftvoice.prompts.list(),
      window.craftvoice.improver.list(),
      window.craftvoice.settings.get(),
      window.craftvoice.settings.providerHealth(),
      window.craftvoice.app.getHotkeyStatus(),
    ]);

    setStats(nextStats);
    setHistory(nextHistory);
    setHistoryHasMore(nextHistory.length >= HISTORY_PAGE_SIZE);
    setDictionary(nextDictionary);
    setPrompts(nextPrompts);
    setImprovements(nextImprovements);
    setSettings(nextSettings);
    setProviderHealth(nextHealth);
    setHotkeyStatus(nextHotkeyStatus);

    if (location.pathname === "/settings") {
      const nextLocalModels = await window.craftvoice.settings.localModels();
      const nextWhisperModels = await window.craftvoice.settings.whisperModels();

      setLocalModels(nextLocalModels);
      setWhisperModels(nextWhisperModels);
    }
  });

  const showNotice = useEffectEvent((message: string, tone: "success" | "warning" | "error" = "success", durationMs = 2600) => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    setNotice({ tone, message });
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, durationMs);
  });

  const handleRecordingResult = useEffectEvent((result: TranscriptionResult) => {
    setErrorMessage("");
    setLastTranscriptionText(result.text);
    showNotice(getRecordingNotice(result, settings), getRecordingNoticeTone(result, settings));
    void refreshData();
  });

  const handleRecordingError = useEffectEvent((message: string) => {
    setErrorMessage(message);
    setNotice(null);
    void refreshData();
  });

  useEffect(() => {
    // Effect events are intentionally omitted from deps here; we want a single
    // subscription lifecycle for the renderer process, not a re-subscribe loop.
    const unsubscribeState = window.craftvoice.recording.onStateChange(setRecordingState);
    const unsubscribeResult = window.craftvoice.recording.onResult(handleRecordingResult);
    const unsubscribeError = window.craftvoice.recording.onError(handleRecordingError);

    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
      unsubscribeState();
      unsubscribeResult();
      unsubscribeError();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Refresh on first mount and when the route changes, but do not couple this
    // to the startup heartbeat effect or every re-render.
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    reportStartupStageOnce("app-mounted");

    const interactiveTimer = window.setTimeout(() => {
      reportStartupStageOnce("interactive");
    }, 250);

    return () => {
      window.clearTimeout(interactiveTimer);
    };
  }, []);

  async function savePatch(input: Partial<AppSettings> | SettingsSaveInput) {
    const nextSettings = await window.craftvoice.settings.save(input);
    setSettings(nextSettings);
    setProviderHealth(await window.craftvoice.settings.providerHealth());
    setHotkeyStatus(await window.craftvoice.app.getHotkeyStatus());
  }

  async function handleToggleRecording() {
    if (recordingState === "transcribing" || headerAction !== "idle") {
      return;
    }

    setHeaderAction("toggling");

    try {
      await window.craftvoice.recording.toggle();
    } finally {
      window.setTimeout(() => setHeaderAction("idle"), 180);
    }
  }

  async function handleMinimizeToTray() {
    if (headerAction !== "idle") {
      return;
    }

    setHeaderAction("minimizing");

    try {
      await window.craftvoice.app.minimizeToTray();
    } finally {
      setHeaderAction("idle");
    }
  }

  const toggleLabel =
    headerAction === "toggling"
      ? "Switching..."
      : recordingState === "recording"
        ? "Stop recording"
        : recordingState === "transcribing"
          ? "Transcribing..."
          : "Start recording";
  const routeLabel = ROUTE_LABELS[location.pathname] ?? "CraftVoice";

  return (
    <div className="app-shell">
      <RecordingController selectedMicrophoneId={settings.selectedMicrophoneId} />
      <Sidebar />

      <main className="content-shell">
        <header className="top-toolbar">
          <div className="toolbar-route">
            <span className="toolbar-route-label">{routeLabel}</span>
          </div>
          <div className="toolbar-actions">
            {notice ? <div className={`toolbar-notice toolbar-notice-${notice.tone}`}>{notice.message}</div> : null}
            {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
            <button
              className={`ghost-button compact-button toolbar-record-button${recordingState === "recording" ? " toolbar-record-button-active" : ""}`}
              disabled={recordingState === "transcribing" || headerAction !== "idle"}
              onClick={() => void handleToggleRecording()}
            >
              {toggleLabel}
            </button>
            <button className="ghost-button compact-button" disabled={headerAction !== "idle"} onClick={() => void handleMinimizeToTray()}>
              {headerAction === "minimizing" ? "Minimizing..." : "Minimize to tray"}
            </button>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route
            path="/overview"
            element={<OverviewPage stats={stats} recordingState={recordingState} providerHealth={providerHealth} hotkeyStatus={hotkeyStatus} />}
          />
          <Route
            path="/prompts"
            element={
              <PromptsPage
                prompts={prompts}
                onAdd={async (entry) => {
                  await window.craftvoice.prompts.add(entry);
                  await refreshData();
                }}
                onUpdate={async (id, entry) => {
                  await window.craftvoice.prompts.update(id, entry);
                  await refreshData();
                }}
                onDelete={async (id) => {
                  await window.craftvoice.prompts.delete(id);
                  await refreshData();
                }}
                onCopy={async (id) => {
                  await window.craftvoice.prompts.copy(id);
                  showNotice("Prompt copied.", "success", 1800);
                }}
              />
            }
          />
          <Route
            path="/prompt-improver"
            element={
              <PromptImproverPage
                improvements={improvements}
                settings={settings}
                pendingTranscription={lastTranscriptionText}
                onConsumeTranscription={() => setLastTranscriptionText("")}
                onImprove={async (rawText, categoryOverride) => {
                  await window.craftvoice.improver.improve(rawText, undefined, categoryOverride);
                  void refreshData();
                }}
                onCancel={async () => {
                  await window.craftvoice.improver.cancel();
                }}
                onDelete={async (id) => {
                  await window.craftvoice.improver.delete(id);
                  await refreshData();
                }}
                onCopy={(text) => {
                  navigator.clipboard.writeText(text);
                  showNotice("Copied to clipboard.", "success", 1800);
                }}
                onSaveSettings={savePatch}
              />
            }
          />
          <Route
            path="/history"
            element={
              <HistoryPage
                items={history}
                hasMore={historyHasMore}
                onDelete={async (id) => {
                  await window.craftvoice.transcriptions.delete(id);
                  await refreshData();
                }}
                onReinsert={async (id) => {
                  const inserted = await window.craftvoice.transcriptions.reinsert(id);
                  showNotice(inserted ? "Transcript copied again." : "Transcript is no longer available.", inserted ? "success" : "error", 1800);
                }}
                onLoadMore={async () => {
                  const more = await window.craftvoice.transcriptions.list(HISTORY_PAGE_SIZE, history.length);
                  setHistory((prev) => [...prev, ...more]);
                  setHistoryHasMore(more.length >= HISTORY_PAGE_SIZE);
                }}
              />
            }
          />
          <Route
            path="/dictionary"
            element={
              <DictionaryPage
                entries={dictionary}
                onAdd={async (entry) => {
                  await window.craftvoice.dictionary.add(entry);
                  await refreshData();
                }}
                onDelete={async (id) => {
                  await window.craftvoice.dictionary.delete(id);
                  await refreshData();
                }}
              />
            }
          />
          <Route path="/shortcuts" element={<ShortcutsPage settings={settings} onSave={savePatch} />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                settings={settings}
                providerHealth={providerHealth}
                whisperModels={whisperModels}
                localModels={localModels}
                onSave={savePatch}
                onTestProvider={(provider, draft) => window.craftvoice.settings.testProvider(provider, draft)}
                onOpenDiagnosticsFolder={() => window.craftvoice.settings.openDiagnosticsFolder()}
                onInstallLocalModel={async (modelId) => {
                  await window.craftvoice.settings.installLocalModel(modelId);
                  await refreshData();
                }}
                onRemoveLocalModel={async (modelId) => {
                  await window.craftvoice.settings.removeLocalModel(modelId);
                  await refreshData();
                }}
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function getRecordingNotice(result: TranscriptionResult, _settings: AppSettings) {
  const providerLabel = formatProviderName(result.provider);

  if (result.usedFallback) {
    const selectedLabel = formatProviderName(result.selectedProvider);
    const reasonText = result.failureMessage ? ` ${result.failureMessage}` : ` ${selectedLabel} could not complete this pass.`;

    return `${providerLabel} backup handled this pass.${reasonText} Text copied to clipboard.`;
  }

  return "Copied to clipboard.";
}

function getRecordingNoticeTone(result: TranscriptionResult, _settings: AppSettings) {
  if (result.usedFallback) {
    return "warning" as const;
  }

  return "success" as const;
}
