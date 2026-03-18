import { useEffect, useMemo, useRef, useState } from "react";

import type { RecordingState } from "@shared/types";

const METER_WEIGHTS = [0.36, 0.56, 0.78, 1, 0.78, 0.56, 0.36];

export function WidgetApp() {
  const [state, setState] = useState<RecordingState>("idle");
  const [isToggling, setIsToggling] = useState(false);
  const [displayLevel, setDisplayLevel] = useState(0);
  const targetLevelRef = useRef(0);
  const lastLevelUpdateAtRef = useRef(0);

  useEffect(() => {
    const unsubscribeState = window.craftvoice.recording.onStateChange((nextState) => {
      setState(nextState);
      if (nextState !== "recording") {
        targetLevelRef.current = 0;
        lastLevelUpdateAtRef.current = 0;
        setDisplayLevel(0);
      }
    });
    const unsubscribeLevel = window.craftvoice.recording.onLevelChange((level) => {
      targetLevelRef.current = clamp01(level);
      lastLevelUpdateAtRef.current = performance.now();
    });

    return () => {
      unsubscribeState();
      unsubscribeLevel();
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

  const disabled = state === "transcribing" || isToggling;
  const bars = useMemo(() => buildMeterBars(state === "recording" ? displayLevel : 0), [displayLevel, state]);

  return (
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
