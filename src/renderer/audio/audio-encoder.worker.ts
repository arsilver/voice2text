/// <reference lib="webworker" />

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const startedAt = performance.now();

  try {
    const merged = mergeChunks(event.data.chunks);
    const downsampled = downsampleBuffer(merged, event.data.inputSampleRate, event.data.outputSampleRate);
    const wav = encodeWav(downsampled, event.data.outputSampleRate);

    ctx.postMessage(
      {
        audioBytes: wav.buffer,
        byteLength: wav.byteLength,
        encodeMs: Math.round((performance.now() - startedAt) * 100) / 100,
        sampleCount: downsampled.length,
      } satisfies EncodeSuccessMessage,
      [wav.buffer]
    );
  } catch (error) {
    ctx.postMessage({
      error: error instanceof Error ? error.message : "Audio encoding failed.",
    } satisfies EncodeErrorMessage);
  }
};

interface EncodeRequest {
  chunks: Float32Array[];
  inputSampleRate: number;
  outputSampleRate: number;
}

interface EncodeSuccessMessage {
  audioBytes: ArrayBuffer;
  byteLength: number;
  encodeMs: number;
  sampleCount: number;
}

interface EncodeErrorMessage {
  error: string;
}

function mergeChunks(chunks: Float32Array[]) {
  let totalLength = 0;

  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
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

function writeString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
