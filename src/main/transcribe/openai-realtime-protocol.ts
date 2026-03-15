export const OPENAI_REALTIME_QUIET_PERIOD_MS = 1500;

interface OpenAiRealtimeDrainState {
  clientCommitCount: number;
  serverCommitCount: number;
  pendingItemCount: number;
  failedItemCount: number;
  lastServerEventAt: number;
  now: number;
  quietPeriodMs?: number;
}

export function createOpenAiRealtimeSessionUpdate(model: string) {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          noise_reduction: {
            type: "near_field",
          },
          transcription: {
            model,
            language: "en",
            prompt: "",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  };
}

export function shouldResolveOpenAiRealtimeDrain(state: OpenAiRealtimeDrainState) {
  const quietPeriodMs = state.quietPeriodMs ?? OPENAI_REALTIME_QUIET_PERIOD_MS;

  if (state.clientCommitCount === 0 && state.serverCommitCount === 0) {
    return state.now - state.lastServerEventAt >= quietPeriodMs;
  }

  if (state.pendingItemCount === 0) {
    return true;
  }

  return state.now - state.lastServerEventAt >= quietPeriodMs;
}
