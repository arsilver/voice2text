import { useEffect, useMemo, useRef, useState } from "react";

import type { ImproverState, RecordingState } from "@shared/types";

const METER_WEIGHTS = [0.36, 0.56, 0.78, 1, 0.78, 0.56, 0.36];

export function WidgetApp() {
  const [state, setState] = useState<RecordingState>("idle");
  const [isToggling, setIsToggling] = useState(false);
  const [displayLevel, setDisplayLevel] = useState(0);
  const targetLevelRef = useRef(0);
  const lastLevelUpdateAtRef = useRef(0);

  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
  const [improverState, setImproverState] = useState<ImproverState>("idle");
  const [autoCopyOn, setAutoCopyOn] = useState(true);

  useEffect(() => {
    const unsubscribeState = window.craftvoice.recording.onStateChange((nextState) => {
      setState(nextState);
      if (nextState !== "recording") {
        targetLevelRef.current = 0;
        lastLevelUpdateAtRef.current = 0;
        setDisplayLevel(0);
      }
      // Clear last transcription when a new recording starts
      if (nextState === "recording") {
        setLastTranscription(null);
        setImproverState("idle");
      }
    });
    const unsubscribeLevel = window.craftvoice.recording.onLevelChange((level) => {
      targetLevelRef.current = clamp01(level);
      lastLevelUpdateAtRef.current = performance.now();
    });
    const unsubscribeResult = window.craftvoice.recording.onResult((result) => {
      setLastTranscription(result.text);
    });
    const unsubscribeImproverState = window.craftvoice.improver.onStateChange((nextState) => {
      setImproverState(nextState);
    });
    const unsubscribeImproverResult = window.craftvoice.improver.onResult(() => {
      // Result handled — state already set to "done" via onStateChange
    });

    return () => {
      unsubscribeState();
      unsubscribeLevel();
      unsubscribeResult();
      unsubscribeImproverState();
      unsubscribeImproverResult();
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
    void window.craftvoice.improver.improve(lastTranscription);
  }

  const disabled = state === "transcribing" || isToggling;
  const bars = useMemo(() => buildMeterBars(state === "recording" ? displayLevel : 0), [displayLevel, state]);
  const showActionBar = lastTranscription !== null;

  useEffect(() => {
    void window.craftvoice.app.setWidgetExpanded(showActionBar);
  }, [showActionBar]);

  return (
    <div className={`widget-wrapper${showActionBar ? " widget-wrapper-expanded" : ""}`}>
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
          <span>{widgetLabel(state, isToggling)}</span>
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
      {showActionBar && (
        <div className="widget-action-bar">
          <button
            className={`widget-improve-btn${improverState === "done" ? " widget-improve-btn-done" : ""}`}
            disabled={improverState === "improving"}
            onClick={handleImprove}
          >
            {improverState === "improving" ? "Improving\u2026" : improverState === "done" ? "Improved" : "Improve"}
          </button>
          <button
            className={`widget-copy-toggle${autoCopyOn ? " widget-copy-toggle-active" : ""}`}
            onClick={() => setAutoCopyOn(!autoCopyOn)}
            title={autoCopyOn ? "Auto-copy on" : "Auto-copy off"}
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}

function widgetLabel(state: RecordingState, isToggling: boolean) {
  if (isToggling) {
    return "Switching";
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
