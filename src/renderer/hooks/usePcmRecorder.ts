import { useRef } from "react";

import workletUrl from "@renderer/audio/pcm-worklet.js?url";
import type { RecordingSessionInfo } from "@shared/types";

const FINAL_WAV_SAMPLE_RATE = 16000;
const MAX_RECORDING_DURATION_MS = 10 * 60 * 1000;

interface RecorderRefs {
  audioContext: AudioContext | null;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  workletNode: AudioWorkletNode | null;
  sink: GainNode | null;
  chunks: Float32Array[];
  totalSamples: number;
  inputSampleRate: number;
  startedAt: number;
  lastLevelPublishAt: number;
  smoothedLevel: number;
  session: RecordingSessionInfo | null;
  nextChunkFlushAtMs: number;
  nextChunkIndex: number;
  lastSubmittedRangeKey: string;
  lastSubmittedChunkEndMs: number;
}

export function usePcmRecorder() {
  const refs = useRef<RecorderRefs>({
    audioContext: null,
    stream: null,
    source: null,
    workletNode: null,
    sink: null,
    chunks: [],
    totalSamples: 0,
    inputSampleRate: 0,
    startedAt: 0,
    lastLevelPublishAt: 0,
    smoothedLevel: 0,
    session: null,
    nextChunkFlushAtMs: 0,
    nextChunkIndex: 0,
    lastSubmittedRangeKey: "",
    lastSubmittedChunkEndMs: 0,
  });

  async function start(selectedMicrophoneId?: string) {
    if (refs.current.audioContext) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedMicrophoneId
        ? {
            deviceId: { exact: selectedMicrophoneId },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          }
        : {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
    });

    const audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(workletUrl);

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "pcm-recorder-processor");
    const sink = audioContext.createGain();
    sink.gain.value = 0;

    refs.current.chunks = [];
    refs.current.totalSamples = 0;
    refs.current.inputSampleRate = audioContext.sampleRate;
    refs.current.startedAt = Date.now();
    refs.current.lastLevelPublishAt = 0;
    refs.current.smoothedLevel = 0;
    refs.current.audioContext = audioContext;
    refs.current.stream = stream;
    refs.current.source = source;
    refs.current.workletNode = workletNode;
    refs.current.sink = sink;
    refs.current.session = await window.craftvoice.recording.beginSession();
    refs.current.nextChunkFlushAtMs = refs.current.session.chunkIntervalMs;
    refs.current.nextChunkIndex = 0;
    refs.current.lastSubmittedRangeKey = "";
    refs.current.lastSubmittedChunkEndMs = 0;
    window.craftvoice.recording.publishLevel(0);

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const chunk = new Float32Array(event.data);
      refs.current.chunks.push(chunk);
      refs.current.totalSamples += chunk.length;

      const now = performance.now();
      const nextLevel = smoothLevel(refs.current.smoothedLevel, normalizeLevel(calculateRms(chunk)));
      refs.current.smoothedLevel = nextLevel;

      if (now - refs.current.lastLevelPublishAt >= 40) {
        refs.current.lastLevelPublishAt = now;
        window.craftvoice.recording.publishLevel(nextLevel);
      }

      if (refs.current.session && refs.current.session.chunkIntervalMs > 0) {
        const bufferedDurationMs = getBufferedDurationMs(refs.current.totalSamples, refs.current.inputSampleRate);

        if (bufferedDurationMs >= MAX_RECORDING_DURATION_MS) {
          console.warn("CraftVoice: max recording duration reached, auto-stopping");
          void stop();
          return;
        }

        if (bufferedDurationMs >= refs.current.nextChunkFlushAtMs) {
          refs.current.nextChunkFlushAtMs += refs.current.session.chunkIntervalMs;
          void submitChunkWindow(bufferedDurationMs, false);
        }
      }
    };

    source.connect(workletNode);
    workletNode.connect(sink);
    sink.connect(audioContext.destination);
  }

  async function stop() {
    const { audioContext, stream, source, workletNode, sink, chunks, startedAt, inputSampleRate, session } = refs.current;

    if (!audioContext || !stream || !source || !workletNode || !sink) {
      return;
    }

    source.disconnect();
    workletNode.disconnect();
    sink.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();

    const durationMs = Date.now() - startedAt;
    const merged = mergeChunks(chunks);
    const downsampled = downsampleBuffer(merged, inputSampleRate, FINAL_WAV_SAMPLE_RATE);
    const wav = encodeWav(downsampled, FINAL_WAV_SAMPLE_RATE);
    window.craftvoice.recording.publishLevel(0);

    if (!session) {
      resetRecorderState();
      return;
    }

    try {
      if (session.chunkIntervalMs > 0) {
        await submitChunkWindow(durationMs, true, session);
      }

      await window.craftvoice.recording.finishSession({
        sessionId: session.sessionId,
        audioBytes: wav,
        durationMs,
        sampleRate: FINAL_WAV_SAMPLE_RATE,
      });
    } finally {
      resetRecorderState();
    }
  }

  async function submitChunkWindow(durationMs: number, isFinalChunk: boolean, sessionOverride?: RecordingSessionInfo) {
    const session = sessionOverride ?? refs.current.session;

    if (
      !session ||
      session.chunkIntervalMs <= 0 ||
      refs.current.inputSampleRate === 0
    ) {
      return;
    }

    if (session.transport === "rolling-window") {
      const endMs = durationMs;
      const startMs = Math.max(0, endMs - session.rollingWindowMs - session.overlapMs);
      const rangeKey = buildRangeKey(startMs, endMs);

      if (rangeKey === refs.current.lastSubmittedRangeKey) {
        return;
      }

      const startSample = Math.max(0, Math.floor((startMs / 1000) * refs.current.inputSampleRate));
      const endSample = Math.min(refs.current.totalSamples, Math.ceil((endMs / 1000) * refs.current.inputSampleRate));
      const slice = extractSampleRange(refs.current.chunks, startSample, endSample);

      if (slice.length === 0) {
        return;
      }

      const downsampled = downsampleBuffer(slice, refs.current.inputSampleRate, session.captureSampleRate);
      const audioBytes = session.captureFormat === "wav" ? encodeWav(downsampled, session.captureSampleRate) : encodePcm16(downsampled);
      refs.current.lastSubmittedRangeKey = rangeKey;

      try {
        await window.craftvoice.recording.submitChunk({
          sessionId: session.sessionId,
          chunkIndex: refs.current.nextChunkIndex,
          startMs: Math.round(startMs),
          endMs: Math.round(endMs),
          sampleRate: session.captureSampleRate,
          format: session.captureFormat,
          isFinalChunk,
          audioBytes,
        });
        refs.current.nextChunkIndex += 1;
      } catch (error) {
        console.error("CraftVoice local chunk submission failed", error);
      }

      return;
    }

    const startMs = refs.current.lastSubmittedChunkEndMs;
    const endMs = durationMs;

    if (endMs <= startMs) {
      return;
    }

    const startSample = Math.max(0, Math.floor((startMs / 1000) * refs.current.inputSampleRate));
    const endSample = Math.min(refs.current.totalSamples, Math.ceil((endMs / 1000) * refs.current.inputSampleRate));
    const slice = extractSampleRange(refs.current.chunks, startSample, endSample);

    if (slice.length === 0) {
      return;
    }

    const downsampled = downsampleBuffer(slice, refs.current.inputSampleRate, session.captureSampleRate);
    const audioBytes = session.captureFormat === "wav" ? encodeWav(downsampled, session.captureSampleRate) : encodePcm16(downsampled);

    try {
      await window.craftvoice.recording.submitChunk({
        sessionId: session.sessionId,
        chunkIndex: refs.current.nextChunkIndex,
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
        sampleRate: session.captureSampleRate,
        format: session.captureFormat,
        isFinalChunk,
        audioBytes,
      });
      refs.current.nextChunkIndex += 1;
      refs.current.lastSubmittedChunkEndMs = endMs;
    } catch (error) {
      console.error("CraftVoice streaming chunk submission failed", error);
    }
  }

  function resetRecorderState() {
    refs.current.audioContext = null;
    refs.current.stream = null;
    refs.current.source = null;
    refs.current.workletNode = null;
    refs.current.sink = null;
    refs.current.chunks = [];
    refs.current.totalSamples = 0;
    refs.current.inputSampleRate = 0;
    refs.current.lastLevelPublishAt = 0;
    refs.current.smoothedLevel = 0;
    refs.current.session = null;
    refs.current.nextChunkFlushAtMs = 0;
    refs.current.nextChunkIndex = 0;
    refs.current.lastSubmittedRangeKey = "";
    refs.current.lastSubmittedChunkEndMs = 0;
  }

  return { start, stop };
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

function buildRangeKey(startMs: number, endMs: number) {
  return `${Math.round(startMs)}:${Math.round(endMs)}`;
}

function getBufferedDurationMs(totalSamples: number, sampleRate: number) {
  if (sampleRate <= 0) {
    return 0;
  }

  return (totalSamples / sampleRate) * 1000;
}

function mergeChunks(chunks: Float32Array[]) {
  return extractSampleRange(chunks, 0, chunks.reduce((sum, chunk) => sum + chunk.length, 0));
}

function extractSampleRange(chunks: Float32Array[], startSample: number, endSample: number) {
  const targetLength = Math.max(0, endSample - startSample);
  const result = new Float32Array(targetLength);
  let writeOffset = 0;
  let cursor = 0;

  for (const chunk of chunks) {
    const chunkStart = cursor;
    const chunkEnd = cursor + chunk.length;
    const copyStart = Math.max(startSample, chunkStart);
    const copyEnd = Math.min(endSample, chunkEnd);

    if (copyEnd > copyStart) {
      const sourceStart = copyStart - chunkStart;
      const sourceEnd = copyEnd - chunkStart;
      result.set(chunk.subarray(sourceStart, sourceEnd), writeOffset);
      writeOffset += sourceEnd - sourceStart;
    }

    cursor = chunkEnd;

    if (cursor >= endSample) {
      break;
    }
  }

  return writeOffset === result.length ? result : result.subarray(0, writeOffset);
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(outputLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let index = offsetBuffer; index < nextOffsetBuffer && index < buffer.length; index += 1) {
      accum += buffer[index];
      count += 1;
    }

    result[offsetResult] = count === 0 ? 0 : accum / count;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const headerSize = 44;
  const wav = new ArrayBuffer(headerSize + samples.length * bytesPerSample);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return bytes;
}

function encodePcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
