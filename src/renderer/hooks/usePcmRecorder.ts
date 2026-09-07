import { useRef } from "react";

import workletUrl from "@renderer/audio/pcm-worklet.js?url";

const FINAL_WAV_SAMPLE_RATE = 16000;
const MAX_RECORDING_DURATION_MS = 10 * 60 * 1000;
/** Peak RMS below this is treated as a silent capture (muted mic / suspended graph). */
const SILENCE_PEAK_RMS = 0.0008;

interface RecorderRefs {
  audioContext: AudioContext | null;
  chunks: Float32Array[];
  inputSampleRate: number;
  lastLevelPublishAt: number;
  peakRms: number;
  recordingId: string | null;
  sink: GainNode | null;
  smoothedLevel: number;
  source: MediaStreamAudioSourceNode | null;
  startedAt: number;
  stream: MediaStream | null;
  totalSamples: number;
  workletNode: AudioWorkletNode | null;
}

export function usePcmRecorder() {
  const refs = useRef<RecorderRefs>({
    audioContext: null,
    chunks: [],
    inputSampleRate: 0,
    lastLevelPublishAt: 0,
    peakRms: 0,
    recordingId: null,
    sink: null,
    smoothedLevel: 0,
    source: null,
    startedAt: 0,
    stream: null,
    totalSamples: 0,
    workletNode: null,
  });

  async function start(selectedMicrophoneId?: string) {
    if (refs.current.audioContext) {
      return;
    }

    const recordingId = crypto.randomUUID();
    logRecorderEvent("start-requested", { microphone: selectedMicrophoneId || "default", recordingId });

    const stream = await openMicrophoneStream(selectedMicrophoneId);

    // Hotkey starts are not a user-gesture on this window. Without resume(), Chromium
    // often leaves AudioContext suspended and the worklet captures silence.
    const audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    await audioContext.audioWorklet.addModule(workletUrl);
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "pcm-recorder-processor");
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    refs.current.audioContext = audioContext;
    refs.current.chunks = [];
    refs.current.inputSampleRate = audioContext.sampleRate;
    refs.current.lastLevelPublishAt = 0;
    refs.current.peakRms = 0;
    refs.current.recordingId = recordingId;
    refs.current.sink = sink;
    refs.current.smoothedLevel = 0;
    refs.current.source = source;
    refs.current.startedAt = Date.now();
    refs.current.stream = stream;
    refs.current.totalSamples = 0;
    refs.current.workletNode = workletNode;
    window.craftvoice.recording.publishLevel(0);

    logRecorderEvent("started", {
      audioContextState: audioContext.state,
      inputSampleRate: audioContext.sampleRate,
      recordingId,
      trackLabel: stream.getAudioTracks()[0]?.label || "unknown",
    });

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = new Float32Array(event.data);
      refs.current.chunks.push(chunk);
      refs.current.totalSamples += chunk.length;

      const rms = calculateRms(chunk);
      if (rms > refs.current.peakRms) {
        refs.current.peakRms = rms;
      }

      const now = performance.now();
      const nextLevel = smoothLevel(refs.current.smoothedLevel, normalizeLevel(rms));
      refs.current.smoothedLevel = nextLevel;

      if (now - refs.current.lastLevelPublishAt >= 40) {
        refs.current.lastLevelPublishAt = now;
        window.craftvoice.recording.publishLevel(nextLevel);
      }

      const bufferedDurationMs = getBufferedDurationMs(refs.current.totalSamples, refs.current.inputSampleRate);

      if (bufferedDurationMs >= MAX_RECORDING_DURATION_MS) {
        logRecorderEvent("max-duration-reached", {
          bufferedDurationMs: Math.round(bufferedDurationMs),
          recordingId: refs.current.recordingId,
        });
        void stop();
      }
    };

    source.connect(workletNode);
    workletNode.connect(sink);
    sink.connect(audioContext.destination);
  }

  async function stop() {
    const { audioContext, chunks, inputSampleRate, peakRms, recordingId, sink, source, startedAt, stream, totalSamples, workletNode } =
      refs.current;

    if (!audioContext || !stream || !source || !workletNode || !sink || !recordingId) {
      return;
    }

    logRecorderEvent("stop-requested", {
      audioContextState: audioContext.state,
      bufferedChunks: chunks.length,
      peakRms: Number(peakRms.toFixed(6)),
      recordingId,
      totalSamples,
    });

    source.disconnect();
    workletNode.disconnect();
    sink.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();

    const durationMs = Date.now() - startedAt;
    window.craftvoice.recording.publishLevel(0);

    try {
      if (totalSamples === 0) {
        throw new Error(
          "No audio frames were captured. Check Windows microphone privacy, unmute the mic, and try again."
        );
      }

      if (peakRms < SILENCE_PEAK_RMS) {
        throw new Error(
          "Recording was silent. Unmute the mic (hardware key / OS), confirm the right input in Settings, and watch the level meter while speaking."
        );
      }

      const encoded = await encodeAudioInWorker(chunks, inputSampleRate, recordingId);
      logRecorderEvent("submit-audio", {
        durationMs,
        encodedBytes: encoded.byteLength,
        encodeMs: encoded.encodeMs,
        peakRms: Number(peakRms.toFixed(6)),
        recordingId,
        sampleCount: encoded.sampleCount,
      });

      await window.craftvoice.recording.submitAudio({
        recordingId,
        audioBytes: encoded.audioBytes,
        durationMs,
        sampleRate: FINAL_WAV_SAMPLE_RATE,
      });
    } finally {
      resetRecorderState();
    }
  }

  function resetRecorderState() {
    refs.current.audioContext = null;
    refs.current.chunks = [];
    refs.current.inputSampleRate = 0;
    refs.current.lastLevelPublishAt = 0;
    refs.current.peakRms = 0;
    refs.current.recordingId = null;
    refs.current.sink = null;
    refs.current.smoothedLevel = 0;
    refs.current.source = null;
    refs.current.startedAt = 0;
    refs.current.stream = null;
    refs.current.totalSamples = 0;
    refs.current.workletNode = null;
  }

  return { start, stop };
}

async function openMicrophoneStream(selectedMicrophoneId?: string) {
  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (!selectedMicrophoneId) {
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...baseConstraints,
        deviceId: { exact: selectedMicrophoneId },
      },
    });
  } catch (error) {
    // Device IDs are machine-specific — a setting copied from another PC fails exact match.
    logRecorderEvent("microphone-fallback-default", {
      error: error instanceof Error ? error.message : String(error),
      selectedMicrophoneId,
    });
    return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
  }
}

async function encodeAudioInWorker(chunks: Float32Array[], inputSampleRate: number, recordingId: string) {
  logRecorderEvent("encode-started", {
    chunkCount: chunks.length,
    inputSampleRate,
    recordingId,
  });

  const worker = new Worker(new URL("../audio/audio-encoder.worker.ts", import.meta.url), { type: "module" });

  return new Promise<{
    audioBytes: Uint8Array;
    byteLength: number;
    encodeMs: number;
    sampleCount: number;
  }>((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<{ audioBytes?: ArrayBuffer; byteLength?: number; encodeMs?: number; error?: string; sampleCount?: number }>) => {
      cleanup();

      if (event.data.error) {
        logRecorderEvent("encode-failed", { error: event.data.error, recordingId });
        reject(new Error(event.data.error));
        return;
      }

      const audioBytes = new Uint8Array(event.data.audioBytes ?? new ArrayBuffer(0));
      logRecorderEvent("encode-finished", {
        byteLength: event.data.byteLength ?? audioBytes.byteLength,
        encodeMs: event.data.encodeMs ?? 0,
        recordingId,
        sampleCount: event.data.sampleCount ?? 0,
      });

      resolve({
        audioBytes,
        byteLength: event.data.byteLength ?? audioBytes.byteLength,
        encodeMs: event.data.encodeMs ?? 0,
        sampleCount: event.data.sampleCount ?? 0,
      });
    };

    worker.onerror = (event) => {
      cleanup();
      const message = event.message || "Audio encoder worker failed.";
      logRecorderEvent("encode-failed", { error: message, recordingId });
      reject(new Error(message));
    };

    worker.postMessage(
      {
        chunks,
        inputSampleRate,
        outputSampleRate: FINAL_WAV_SAMPLE_RATE,
      },
      chunks.map((chunk) => chunk.buffer)
    );
  });
}

function calculateRms(chunk: Float32Array) {
  if (chunk.length === 0) {
    return 0;
  }

  let sumSquares = 0;

  for (let index = 0; index < chunk.length; index += 1) {
    sumSquares += chunk[index] * chunk[index];
  }

  return Math.sqrt(sumSquares / chunk.length);
}

function normalizeLevel(rms: number) {
  const lifted = Math.sqrt(rms * 7.5);
  return Math.max(0, Math.min(1, lifted));
}

function smoothLevel(previous: number, next: number) {
  const factor = next > previous ? 0.42 : 0.18;
  return previous + (next - previous) * factor;
}

function getBufferedDurationMs(totalSamples: number, sampleRate: number) {
  if (sampleRate <= 0) {
    return 0;
  }

  return (totalSamples / sampleRate) * 1000;
}

function logRecorderEvent(event: string, details: Record<string, unknown>) {
  console.info(`[CraftVoice] recorder:${event} ${JSON.stringify(details)}`);
}
