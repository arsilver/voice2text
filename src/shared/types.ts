export type RecordingState = "idle" | "recording" | "transcribing" | "error";
export type RecordingCommand = "start" | "stop";
export type ProviderId = "whisper-local" | "openai" | "groq" | "deepgram";
export type RemoteProviderId = Exclude<ProviderId, "whisper-local">;
export type ProviderTier = "economy" | "best";
export type DeliveryMode = "copy" | "paste-and-copy";
export type LocalModelSource = "managed" | "bundled";
export type LocalModelStage = "idle" | "downloading" | "installing" | "ready" | "error";
export type StartupProfile = "normal" | "minimal" | "safe";
export type StartupStage = "dom-ready" | "app-mounted" | "interactive";

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface AppSettings {
  defaultProvider: ProviderId;
  fallbackEnabled: boolean;
  fallbackOrder: ProviderId[];
  whisperModel: string;
  openaiModel: string;
  groqModel: string;
  deepgramModel: string;
  groqApiKey: string;
  openaiApiKey: string;
  deepgramApiKey: string;
  hotkey: string;
  autoPaste: boolean;
  autoCopyClipboard: boolean;
  playSounds: boolean;
  aiTextPolish: boolean;
  showFloatingWidget: boolean;
  widgetPosition: WidgetPosition;
  selectedMicrophoneId: string;
  theme: "dark";
}

export interface DashboardStats {
  totalWords: number;
  speakingTimeMs: number;
  sessions: number;
  averagePace: number;
  lastUpdatedAt: string | null;
}

export interface TranscriptionRecord {
  id: string;
  createdAt: string;
  rawText: string;
  finalText: string;
  durationMs: number;
  transcriptionMs: number;
  provider: ProviderId;
  model: string;
  targetApp: string;
  wasPasted: boolean;
}

export interface DictionaryEntry {
  id: string;
  original: string;
  replacement: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptCard {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderHealth {
  provider: ProviderId;
  configured: boolean;
  available: boolean;
  message: string;
}

export interface HotkeyStatus {
  accelerator: string;
  registered: boolean;
  message: string;
}

export interface TranscriptionResult {
  provider: ProviderId;
  model: string;
  text: string;
  rawText: string;
  durationMs: number;
  transcriptionMs: number;
  usedFallback: boolean;
  selectedProvider: ProviderId;
  fallbackProvider: ProviderId | null;
  selectedProviderFailed: boolean;
  failureMessage: string | null;
  wasPasted?: boolean;
}

export interface AudioSubmission {
  recordingId: string;
  audioBytes: Uint8Array;
  durationMs: number;
  sampleRate: number;
}

export interface SaveDictionaryInput {
  original: string;
  replacement: string;
  category: string;
}

export interface SavePromptCardInput {
  title: string;
  body: string;
}

export interface SaveTranscriptionInput {
  rawText: string;
  finalText: string;
  durationMs: number;
  transcriptionMs: number;
  provider: ProviderId;
  model: string;
  targetApp: string;
  wasPasted: boolean;
}

export interface ProviderTestResult {
  provider: ProviderId;
  ok: boolean;
  message: string;
}

export interface LocalModelInfo {
  id: string;
  label: string;
  description: string;
  installed: boolean;
  selected: boolean;
  warm: boolean;
  source: LocalModelSource | null;
  sizeBytes: number | null;
}

export interface LocalModelProgress {
  modelId: string;
  stage: LocalModelStage;
  downloadedBytes: number;
  totalBytes: number | null;
  message: string;
}

export interface ProviderPresetOption {
  provider: ProviderId;
  value: string;
  label: string;
  description: string;
  model: string;
}

export interface WhisperModelOption {
  value: string;
  label: string;
}

export interface CraftVoiceApi {
  app: {
    getVersion: () => Promise<string>;
    getStartupProfile: () => Promise<StartupProfile>;
    reportStartupHeartbeat: (stage: StartupStage) => Promise<void>;
    showMainWindow: () => Promise<void>;
    minimizeToTray: () => Promise<void>;
    quit: () => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    getHotkeyStatus: () => Promise<HotkeyStatus>;
  };
  recording: {
    toggle: () => Promise<RecordingState>;
    submitAudio: (submission: AudioSubmission) => Promise<void>;
    reportError: (message: string) => Promise<void>;
    publishLevel: (level: number) => void;
    onStateChange: (listener: (state: RecordingState) => void) => () => void;
    onLevelChange: (listener: (level: number) => void) => () => void;
    onCommand: (listener: (command: RecordingCommand) => void) => () => void;
    onResult: (listener: (result: TranscriptionResult) => void) => () => void;
    onError: (listener: (message: string) => void) => () => void;
  };
  stats: {
    get: () => Promise<DashboardStats>;
  };
  transcriptions: {
    list: (limit?: number, offset?: number) => Promise<TranscriptionRecord[]>;
    delete: (id: string) => Promise<void>;
    reinsert: (id: string) => Promise<boolean>;
  };
  dictionary: {
    list: (search?: string) => Promise<DictionaryEntry[]>;
    add: (entry: SaveDictionaryInput) => Promise<DictionaryEntry>;
    update: (id: string, entry: SaveDictionaryInput) => Promise<DictionaryEntry>;
    delete: (id: string) => Promise<void>;
  };
  prompts: {
    list: () => Promise<PromptCard[]>;
    add: (entry: SavePromptCardInput) => Promise<PromptCard>;
    update: (id: string, entry: SavePromptCardInput) => Promise<PromptCard>;
    delete: (id: string) => Promise<void>;
    copy: (id: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    save: (patch: Partial<AppSettings>) => Promise<AppSettings>;
    providerHealth: () => Promise<ProviderHealth[]>;
    whisperModels: () => Promise<WhisperModelOption[]>;
    localModels: () => Promise<LocalModelInfo[]>;
    installLocalModel: (modelId: string) => Promise<void>;
    removeLocalModel: (modelId: string) => Promise<void>;
    testProvider: (provider: ProviderId, draft?: Partial<AppSettings>) => Promise<ProviderTestResult>;
    openDiagnosticsFolder: () => Promise<void>;
    onLocalModelProgress: (listener: (progress: LocalModelProgress) => void) => () => void;
  };
}

export const IPC_CHANNELS = {
  appGetVersion: "app:get-version",
  appGetStartupProfile: "app:get-startup-profile",
  appStartupHeartbeat: "app:startup-heartbeat",
  appShowMainWindow: "app:show-main-window",
  appMinimizeToTray: "app:minimize-to-tray",
  appQuit: "app:quit",
  appOpenExternal: "app:open-external",
  appGetHotkeyStatus: "app:get-hotkey-status",
  recordingToggle: "recording:toggle",
  recordingSubmitAudio: "recording:submit-audio",
  recordingReportError: "recording:report-error",
  recordingPublishLevel: "recording:publish-level",
  recordingStateChanged: "recording:state-changed",
  recordingLevelChanged: "recording:level-changed",
  recordingCommand: "recording:command",
  recordingResult: "recording:result",
  recordingError: "recording:error",
  statsGet: "stats:get",
  transcriptionsList: "transcriptions:list",
  transcriptionsDelete: "transcriptions:delete",
  transcriptionsReinsert: "transcriptions:reinsert",
  dictionaryList: "dictionary:list",
  dictionaryAdd: "dictionary:add",
  dictionaryUpdate: "dictionary:update",
  dictionaryDelete: "dictionary:delete",
  promptsList: "prompts:list",
  promptsAdd: "prompts:add",
  promptsUpdate: "prompts:update",
  promptsDelete: "prompts:delete",
  promptsCopy: "prompts:copy",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  settingsProviderHealth: "settings:provider-health",
  settingsWhisperModels: "settings:whisper-models",
  settingsLocalModels: "settings:local-models",
  settingsInstallLocalModel: "settings:install-local-model",
  settingsRemoveLocalModel: "settings:remove-local-model",
  settingsTestProvider: "settings:test-provider",
  settingsOpenDiagnosticsFolder: "settings:open-diagnostics-folder",
  settingsLocalModelProgress: "settings:local-model-progress",
  widgetSetMouseThrough: "widget:set-mouse-through",
} as const;
