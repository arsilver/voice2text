import { useEffect, useState } from "react";

import type { AppSettings } from "@shared/types";

interface ShortcutsPageProps {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
}

export function ShortcutsPage({ settings, onSave }: ShortcutsPageProps) {
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);

  useEffect(() => {
    setHotkey(settings.hotkey);
  }, [settings.hotkey]);

  useEffect(() => {
    if (!isCapturing) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsCapturing(false);
        setSaveState("idle");
        setSaveMessage("");
        return;
      }

      const nextHotkey = buildAccelerator(event);
      if (!nextHotkey) {
        setSaveState("error");
        setSaveMessage("Use at least one modifier plus another key.");
        return;
      }

      setHotkey(nextHotkey);
      setIsCapturing(false);
      setSaveState("idle");
      setSaveMessage("");
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isCapturing]);

  const canSave = isValidAccelerator(hotkey) && !isCapturing;

  return (
    <section className="panel page-stack">
      <div className="section-heading-row section-heading-row-tight">
        <div>
          <h1>Recording hotkey</h1>
          <p>Single hotkey toggle for capture and stop.</p>
        </div>
        {saveMessage ? <div className={`inline-feedback feedback-${saveState === "error" ? "error" : saveState === "saved" ? "success" : "warning"}`}>{saveMessage}</div> : null}
      </div>

      <div className="page-stack">
        <span className="stat-label">Recording Hotkey</span>
        <button
          className={`hotkey-capture${isCapturing ? " hotkey-capture-active" : ""}`}
          onClick={() => {
            setIsCapturing(true);
            setSaveMessage("");
            setSaveState("idle");
          }}
        >
          <strong className="hotkey-chord">{isCapturing ? "Press a new shortcut..." : hotkey}</strong>
          <span className="hotkey-caption">{isCapturing ? "Esc cancels capture." : "Click, then press a modifier combo."}</span>
        </button>
      </div>

      <button
        className="primary-button compact-button"
        disabled={saveState === "saving" || !canSave}
        onClick={async () => {
          setSaveState("saving");
          setSaveMessage("Saving hotkey...");
          try {
            await onSave({ hotkey });
            setSaveState("saved");
            setSaveMessage("Hotkey saved.");
          } catch (error) {
            setSaveState("error");
            setSaveMessage(error instanceof Error ? error.message : "Unable to save hotkey.");
          }
        }}
      >
        {saveState === "saving" ? "Saving..." : "Save hotkey"}
      </button>

      <div className="info-card">
        <strong>Behavior</strong>
        <p>Press once to start, press again to stop. Widget remains as a fallback control.</p>
      </div>
    </section>
  );
}

function buildAccelerator(event: KeyboardEvent) {
  const key = normalizeKey(event);

  if (!key) {
    return "";
  }

  const modifiers = [
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Super" : "",
  ].filter(Boolean);

  if (modifiers.length === 0) {
    return "";
  }

  return [...modifiers, key].join("+");
}

function normalizeKey(event: KeyboardEvent) {
  if (event.code.startsWith("Key")) {
    return event.code.replace("Key", "");
  }

  if (event.code.startsWith("Digit")) {
    return event.code.replace("Digit", "");
  }

  if (/^F\d{1,2}$/.test(event.key)) {
    return event.key.toUpperCase();
  }

  const specialKeys: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    " ": "Space",
    Spacebar: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
  };

  if (event.key in specialKeys) {
    return specialKeys[event.key];
  }

  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
    return "";
  }

  return event.key.length === 1 ? event.key.toUpperCase() : "";
}

function isValidAccelerator(value: string) {
  const parts = value.split("+").filter(Boolean);
  return parts.length >= 2 && parts.slice(0, -1).some((part) => ["Control", "Alt", "Shift", "Super"].includes(part));
}
