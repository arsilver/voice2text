import electron from "electron";
import electronMain from "electron/main";

import { applyDictionary, addDictionaryEntry, deleteDictionaryEntry, listDictionaryEntries, updateDictionaryEntry } from "@main/db/dictionary";
import { addPromptCard, deletePromptCard, getPromptCard, listPromptCards, updatePromptCard } from "@main/db/prompts";
import { getDashboardStats, deleteTranscription, listTranscriptions, reinsertTranscription, saveTranscription } from "@main/db/transcriptions";
import { getProviderHealth, getSettings, listWhisperModels, saveSettings } from "@main/db/settings";
import { getHotkeyStatus, toggleRecording, refreshHotkeys } from "@main/hotkeys";
import { installLocalModel, listLocalModels, removeLocalModel } from "@main/local-models";
import { pasteText } from "@main/paste";
import { setRecordingLevel, setRecordingState } from "@main/recording";
import { beginTranscriptionSession, finishTranscriptionSession, submitTranscriptionChunk } from "@main/transcribe/session-manager";
import { testProvider } from "@main/transcribe/router";
import { getLogger } from "@main/utils/logger";
import { hideMainWindow, setWidgetVisibility, showMainWindow, broadcast } from "@main/windows";
import { getDeliveryMode } from "@shared/delivery-mode";
import { IPC_CHANNELS, type AppSettings, type ProviderId, type RecordingFinishSubmission, type SaveDictionaryInput, type SavePromptCardInput } from "@shared/types";

const log = getLogger("ipc");
const { clipboard, shell } = electron;
const { app, ipcMain } = electronMain;

export function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.appShowMainWindow, () => {
    showMainWindow();
  });
  ipcMain.handle(IPC_CHANNELS.appMinimizeToTray, () => {
    hideMainWindow();
  });
  ipcMain.handle(IPC_CHANNELS.appQuit, () => {
    app.quit();
  });
  ipcMain.handle(IPC_CHANNELS.appOpenExternal, (_, url: string) => {
    return shell.openExternal(url);
  });
  ipcMain.handle(IPC_CHANNELS.appGetHotkeyStatus, () => getHotkeyStatus());

  ipcMain.handle(IPC_CHANNELS.recordingToggle, () => toggleRecording("renderer"));
  ipcMain.handle(IPC_CHANNELS.recordingBeginSession, () => beginTranscriptionSession());
  ipcMain.handle(IPC_CHANNELS.recordingSubmitChunk, (_, submission) => {
    submitTranscriptionChunk(submission);
  });
  ipcMain.handle(IPC_CHANNELS.recordingFinishSession, async (_, submission: RecordingFinishSubmission) => {
    await processFinishedSession(submission);
  });
  ipcMain.handle(IPC_CHANNELS.recordingReportError, (_, message: string) => {
    broadcast(IPC_CHANNELS.recordingError, message);
    setRecordingState("error");
    setTimeout(() => setRecordingState("idle"), 1600);
  });
  ipcMain.on(IPC_CHANNELS.recordingPublishLevel, (_, level: number) => {
    setRecordingLevel(level);
  });

  ipcMain.handle(IPC_CHANNELS.statsGet, () => getDashboardStats());
  ipcMain.handle(IPC_CHANNELS.transcriptionsList, (_, limit?: number, offset?: number) => listTranscriptions(limit, offset));
  ipcMain.handle(IPC_CHANNELS.transcriptionsDelete, (_, id: string) => {
    deleteTranscription(id);
  });
  ipcMain.handle(IPC_CHANNELS.transcriptionsReinsert, async (_, id: string) => {
    const inserted = reinsertTranscription(id);
    if (inserted) {
      await pasteText(listTranscriptions().find((item) => item.id === id)?.finalText ?? "");
    }
    return inserted;
  });

  ipcMain.handle(IPC_CHANNELS.dictionaryList, (_, search?: string) => listDictionaryEntries(search));
  ipcMain.handle(IPC_CHANNELS.dictionaryAdd, (_, entry: SaveDictionaryInput) => addDictionaryEntry(entry));
  ipcMain.handle(IPC_CHANNELS.dictionaryUpdate, (_, id: string, entry: SaveDictionaryInput) => updateDictionaryEntry(id, entry));
  ipcMain.handle(IPC_CHANNELS.dictionaryDelete, (_, id: string) => {
    deleteDictionaryEntry(id);
  });
  ipcMain.handle(IPC_CHANNELS.promptsList, () => listPromptCards());
  ipcMain.handle(IPC_CHANNELS.promptsAdd, (_, entry: SavePromptCardInput) => addPromptCard(entry));
  ipcMain.handle(IPC_CHANNELS.promptsUpdate, (_, id: string, entry: SavePromptCardInput) => updatePromptCard(id, entry));
  ipcMain.handle(IPC_CHANNELS.promptsDelete, (_, id: string) => {
    deletePromptCard(id);
  });
  ipcMain.handle(IPC_CHANNELS.promptsCopy, (_, id: string) => {
    clipboard.writeText(getPromptCard(id).body);
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => getSettings());
  ipcMain.handle(IPC_CHANNELS.settingsSave, (_, patch: Partial<AppSettings>) => {
    const previous = getSettings();
    const settings = saveSettings(patch);
    const nextHotkeyStatus = refreshHotkeys();

    if (patch.hotkey !== undefined && !nextHotkeyStatus.registered) {
      saveSettings({ hotkey: previous.hotkey });
      refreshHotkeys();
      throw new Error(nextHotkeyStatus.message);
    }

    setWidgetVisibility(settings.showFloatingWidget);
    return getSettings();
  });
  ipcMain.handle(IPC_CHANNELS.settingsProviderHealth, () => getProviderHealth());
  ipcMain.handle(IPC_CHANNELS.settingsWhisperModels, () => listWhisperModels());
  ipcMain.handle(IPC_CHANNELS.settingsLocalModels, () => listLocalModels());
  ipcMain.handle(IPC_CHANNELS.settingsInstallLocalModel, async (_, modelId: string) => {
    await installLocalModel(modelId);
  });
  ipcMain.handle(IPC_CHANNELS.settingsRemoveLocalModel, async (_, modelId: string) => {
    await removeLocalModel(modelId);
  });
  ipcMain.handle(IPC_CHANNELS.settingsTestProvider, (_, provider: ProviderId, draft?: Partial<AppSettings>) => testProvider(provider, draft));

  log.info("IPC handlers registered");
}

async function processFinishedSession(submission: RecordingFinishSubmission) {
  const startedAt = Date.now();

  try {
    const result = await finishTranscriptionSession(submission);
    const finalText = applyDictionary(result.text);
    const settings = getSettings();
    const deliveryMode = getDeliveryMode(settings);
    let wasPasted = false;

    if (settings.autoCopyClipboard) {
      clipboard.writeText(finalText);
    }

    if (deliveryMode === "paste-and-copy") {
      wasPasted = await pasteText(finalText);
    }

    const saved = saveTranscription({
      rawText: result.rawText,
      finalText,
      durationMs: result.durationMs,
      transcriptionMs: Date.now() - startedAt,
      provider: result.provider,
      model: result.model,
      targetApp: "",
      wasPasted,
    });

    broadcast(IPC_CHANNELS.recordingResult, {
      ...result,
      text: finalText,
      rawText: result.rawText,
      transcriptionMs: saved.transcriptionMs,
      wasPasted,
    });
    setRecordingState("idle");
  } catch (error) {
    log.error("Processing audio failed", error);
    broadcast(IPC_CHANNELS.recordingError, error instanceof Error ? error.message : "Unknown recording error");
    setRecordingState("error");
    setTimeout(() => setRecordingState("idle"), 1600);
  }
}
