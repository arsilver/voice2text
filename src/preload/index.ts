import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type CraftVoiceApi,
  type ProviderId,
  type RecordingChunkSubmission,
  type RecordingFinishSubmission,
  type SaveDictionaryInput,
  type SavePromptCardInput,
} from "@shared/types";

const api: CraftVoiceApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion),
    showMainWindow: () => ipcRenderer.invoke(IPC_CHANNELS.appShowMainWindow),
    minimizeToTray: () => ipcRenderer.invoke(IPC_CHANNELS.appMinimizeToTray),
    quit: () => ipcRenderer.invoke(IPC_CHANNELS.appQuit),
    openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.appOpenExternal, url),
    getHotkeyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.appGetHotkeyStatus),
  },
  recording: {
    toggle: () => ipcRenderer.invoke(IPC_CHANNELS.recordingToggle),
    beginSession: () => ipcRenderer.invoke(IPC_CHANNELS.recordingBeginSession),
    submitChunk: (submission: RecordingChunkSubmission) => ipcRenderer.invoke(IPC_CHANNELS.recordingSubmitChunk, submission),
    finishSession: (submission: RecordingFinishSubmission) => ipcRenderer.invoke(IPC_CHANNELS.recordingFinishSession, submission),
    reportError: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.recordingReportError, message),
    publishLevel: (level: number) => ipcRenderer.send(IPC_CHANNELS.recordingPublishLevel, level),
    onStateChange: (listener) => subscribe(IPC_CHANNELS.recordingStateChanged, listener),
    onLevelChange: (listener) => subscribe(IPC_CHANNELS.recordingLevelChanged, listener),
    onCommand: (listener) => subscribe(IPC_CHANNELS.recordingCommand, listener),
    onResult: (listener) => subscribe(IPC_CHANNELS.recordingResult, listener),
    onError: (listener) => subscribe(IPC_CHANNELS.recordingError, listener),
    onPartialTranscript: (listener) => subscribe(IPC_CHANNELS.recordingPartialTranscript, listener),
  },
  stats: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.statsGet),
  },
  transcriptions: {
    list: (limit?: number, offset?: number) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionsList, limit, offset),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionsDelete, id),
    reinsert: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.transcriptionsReinsert, id),
  },
  dictionary: {
    list: (search?: string) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryList, search),
    add: (entry: SaveDictionaryInput) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryAdd, entry),
    update: (id: string, entry: SaveDictionaryInput) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryUpdate, id, entry),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryDelete, id),
  },
  prompts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.promptsList),
    add: (entry: SavePromptCardInput) => ipcRenderer.invoke(IPC_CHANNELS.promptsAdd, entry),
    update: (id: string, entry: SavePromptCardInput) => ipcRenderer.invoke(IPC_CHANNELS.promptsUpdate, id, entry),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.promptsDelete, id),
    copy: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.promptsCopy, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    save: (patch) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, patch),
    providerHealth: () => ipcRenderer.invoke(IPC_CHANNELS.settingsProviderHealth),
    whisperModels: () => ipcRenderer.invoke(IPC_CHANNELS.settingsWhisperModels),
    localModels: () => ipcRenderer.invoke(IPC_CHANNELS.settingsLocalModels),
    installLocalModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.settingsInstallLocalModel, modelId),
    removeLocalModel: (modelId: string) => ipcRenderer.invoke(IPC_CHANNELS.settingsRemoveLocalModel, modelId),
    testProvider: (provider: ProviderId, draft) => ipcRenderer.invoke(IPC_CHANNELS.settingsTestProvider, provider, draft),
    onLocalModelProgress: (listener) => subscribe(IPC_CHANNELS.settingsLocalModelProgress, listener),
  },
};

contextBridge.exposeInMainWorld("craftvoice", api);

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}
