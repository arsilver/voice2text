import { useEffect, useEffectEvent } from "react";

import { usePcmRecorder } from "@renderer/hooks/usePcmRecorder";

interface RecordingControllerProps {
  selectedMicrophoneId?: string;
}

export function RecordingController({ selectedMicrophoneId }: RecordingControllerProps) {
  const recorder = usePcmRecorder();

  const handleCommand = useEffectEvent(async (command: "start" | "stop") => {
    try {
      if (command === "start") {
        await recorder.start(selectedMicrophoneId);
        return;
      }

      await recorder.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording failed.";
      await window.craftvoice.recording.reportError(message);
    }
  });

  useEffect(() => window.craftvoice.recording.onCommand(handleCommand), [handleCommand]);

  return null;
}
