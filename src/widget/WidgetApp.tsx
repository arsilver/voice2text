import { useEffect, useMemo, useRef, useState } from "react";

import type { ImproverState, ImproverTool, RecordingState } from "@shared/types";

const METER_WEIGHTS = [0.36, 0.56, 0.78, 1, 0.78, 0.56, 0.36];

const IMPROVER_TOOLS: ImproverTool[] = ["claude", "codex", "kimi", "grok"];

const TOOL_LABELS: Record<ImproverTool, string> = {
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi",
  grok: "Grok",
};

export function WidgetApp() {
  const [state, setState] = useState<RecordingState>("idle");
  const [isToggling, setIsToggling] = useState(false);
  const [displayLevel, setDisplayLevel] = useState(0);
  const targetLevelRef = useRef(0);
  const lastLevelUpdateAtRef = useRef(0);

  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
  const [improverState, setImproverState] = useState<ImproverState>("idle");
  const [autoCopyOn, setAutoCopyOn] = useState(true);
  const [improverTool, setImproverTool] = useState<ImproverTool>("claude");
  const [copyFlash, setCopyFlash] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    void window.craftvoice.settings.get().then((settings) => {
      setImproverTool(settings.improverTool);
      setAutoCopyOn(settings.improverAutoCopy);
    });

    // Keep the improver bar visible for the lifetime of the widget.
    void window.craftvoice.app.setWidgetExpanded(true);

    const unsubscribeState = window.craftvoice.recording.onStateChange((nextState) => {
      setState(nextState);
      if (nextState !== "recording") {
        targetLevelRef.current = 0;
        lastLevelUpdateAtRef.current = 0;
        setDisplayLevel(0);
      }
      // Keep lastTranscription so Improve stays usable after a take;
      // replace it only when a new transcription result arrives.
      if (nextState === "recording") {
        setImproverState("idle");
        setLastError(null);
      }
    });
    const unsubscribeLevel = window.craftvoice.recording.onLevelChange((level) => {
      targetLevelRef.current = clamp01(level);
      lastLevelUpdateAtRef.current = performance.now();
    });
    const unsubscribeResult = window.craftvoice.recording.onResult((result) => {
      setLastTranscription(result.text);
      setImproverState("idle");
      setLastError(null);
    });
    const unsubscribeImproverState = window.craftvoice.improver.onStateChange((nextState) => {
      setImproverState(nextState);
    });
    const unsubscribeImproverResult = window.craftvoice.improver.onResult(() => {
      setLastError(null);
      setCopyFlash(true);
      window.setTimeout(() => setCopyFlash(false), 1600);
    });
    const unsubscribeImproverError = window.craftvoice.improver.onError((message) => {
      setLastError(message);
    });

    return () => {
      unsubscribeState();
      unsubscribeLevel();
      unsubscribeResult();
      unsubscribeImproverState();
      unsubscribeImproverResult();
      unsubscribeImproverError();
    };
  }, []);

  useEffect(() => {
    let frame = 0;

    const animate = () => {
      const now = performance.now();
      const isStale = now - lastLevelUpdateAtRef.current > 180;
      const target = state === "recording" && !isStale ? targetLevelRef.current : 0;

      setDisplayLevel((current) => {
        const next = smoothDisplayLevel(current, target);
        return Math.abs(next - target) < 0.01 ? target : next;
      });

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  async function handleToggle() {
    if (state === "transcribing" || isToggling) {
      return;
    }

    setIsToggling(true);

    try {
      await window.craftvoice.recording.toggle();
    } finally {
      window.setTimeout(() => setIsToggling(false), 180);
    }
  }

  function handleImprove() {
    if (!lastTranscription || improverState === "improving") return;
    setLastError(null);
    void window.craftvoice.improver.improve(lastTranscription);
  }

  async function handleToolChange(tool: ImproverTool) {
    setImproverTool(tool);
    try {
      const next = await window.craftvoice.settings.save({ improverTool: tool });
      setImproverTool(next.improverTool);
    } catch {
      // Keep optimistic selection; next settings.get will correct if needed.
    }
  }

  async function handleAutoCopyToggle() {
    const nextValue = !autoCopyOn;
    setAutoCopyOn(nextValue);
    try {
      const next = await window.craftvoice.settings.save({ improverAutoCopy: nextValue });
      setAutoCopyOn(next.improverAutoCopy);
    } catch {
      // Keep optimistic toggle; reload corrects if save failed.
    }
  }

  const disabled = state === "transcribing" || isToggling;
  const bars = useMemo(() => buildMeterBars(state === "recording" ? displayLevel : 0), [displayLevel, state]);
  const canImprove = Boolean(lastTranscription?.trim()) && improverState !== "improving";
  const improveLabel =
    improverState === "improving"
      ? "Improving\u2026"
      : improverState === "done"
        ? "Improved"
        : improverState === "error"
          ? "Retry"
          : "Improve";

  const copyTitle = lastError
    ? lastError
    : autoCopyOn
      ? "Auto-copy improved text on"
      : "Auto-copy improved text off";

  return (
    <div className="widget-wrapper widget-wrapper-expanded">
      <div
        className={`widget-shell widget-shell-${state}${disabled ? " widget-shell-disabled" : ""}`}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onDoubleClick={() => void handleToggle()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !disabled) {
            event.preventDefault();
            void handleToggle();
          }
        }}
      >
        <div className={`widget-dot widget-${state}`} />
        <div className="widget-copy">
          <strong>CraftVoice</strong>
          <span>{widgetLabel(state, isToggling, improverState, lastError)}</span>
        </div>
        {state === "recording" ? (
          <div className="widget-meter" aria-hidden="true">
            {bars.map((height, index) => (
              <span key={index} style={{ height: `${height}px` }} />
            ))}
          </div>
        ) : (
          <div className="widget-wave" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div className="widget-action-bar">
        <select
          className="widget-tool-select"
          value={improverTool}
          disabled={improverState === "improving"}
          title="Prompt improver tool"
          aria-label="Prompt improver tool"
          onChange={(event) => void handleToolChange(event.target.value as ImproverTool)}
        >
          {IMPROVER_TOOLS.map((tool) => (
            <option key={tool} value={tool}>
              {TOOL_LABELS[tool]}
            </option>
          ))}
        </select>
        <button
          className={`widget-improve-btn${improverState === "done" ? " widget-improve-btn-done" : ""}${improverState === "error" ? " widget-improve-btn-error" : ""}`}
          disabled={!canImprove}
          onClick={handleImprove}
          title={lastError ?? (lastTranscription ? "Improve last transcription" : "Dictate first, then improve")}
        >
          {improveLabel}
        </button>
        <button
          className={`widget-copy-toggle${autoCopyOn ? " widget-copy-toggle-active" : ""}${copyFlash && autoCopyOn ? " widget-copy-toggle-flash" : ""}`}
          onClick={() => void handleAutoCopyToggle()}
          title={copyTitle}
        >
          {copyFlash && autoCopyOn ? "OK" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function widgetLabel(
  state: RecordingState,
  isToggling: boolean,
  improverState: ImproverState,
  lastError: string | null,
) {
  if (isToggling) {
    return "Switching";
  }

  if (improverState === "improving") {
    return "Improving";
  }

  if (improverState === "error" && lastError) {
    return "Improve failed";
  }

  if (improverState === "done") {
    return "Improved";
  }

  switch (state) {
    case "recording":
      return "Recording";
    case "transcribing":
      return "Transcribing";
    case "error":
      return "Retry ready";
    default:
      return "Double-click";
  }
}

function buildMeterBars(level: number) {
  return METER_WEIGHTS.map((weight) => {
    const scaled = 4 + level * weight * 18;
    return Math.max(4, Math.min(22, Math.round(scaled)));
  });
}

function smoothDisplayLevel(current: number, target: number) {
  const factor = target > current ? 0.36 : 0.16;
  return current + (target - current) * factor;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
