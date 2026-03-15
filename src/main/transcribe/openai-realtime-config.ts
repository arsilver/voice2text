export interface OpenAiRealtimeSocketConfig {
  headers: Record<string, string>;
  perMessageDeflate: boolean;
}

export function createOpenAiRealtimeSocketConfig(apiKey: string): OpenAiRealtimeSocketConfig {
  return {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    perMessageDeflate: false,
  };
}
