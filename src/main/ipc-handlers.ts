import electron from "electron";
import electronMain from "electron/main";

import { addDictionaryEntry, deleteDictionaryEntry, listDictionaryEntries, updateDictionaryEntry } from "@main/db/dictionary";
import { addPromptCard, deletePromptCard, getPromptCard, listPromptCards, updatePromptCard } from "@main/db/prompts";
import { getDashboardStats, deleteTranscription, listTranscriptions, reinsertTranscription, saveTranscription } from "@main/db/transcriptions";
import { getProviderHealth, getRendererSettings, getSettings, listWhisperModels, saveSettings } from "@main/db/settings";
import { getHotkeyStatus, isHotkeyRegistrationEnabled, refreshHotkeys, toggleRecording } from "@main/hotkeys";
import { installLocalModel, listLocalModels, removeLocalModel } from "@main/local-models";
import { processRecordingSubmission } from "@main/recording-workflow";
import { setRecordingLevel, setRecordingState } from "@main/recording";
import { hasTray, rebuildTrayMenu } from "@main/tray";
import { transcribeAudio, testProvider } from "@main/transcribe/router";
import { getLogger } from "@main/utils/logger";
import { getDiagnosticsDir } from "@main/utils/paths";
import { broadcast, getMainWindow, hideMainWindow, showMainWindow, setWidgetExpanded, setWidgetVisibility } from "@main/windows";
import { applyDictionary } from "./db/dictionary";
import { listImprovedPrompts, deleteImprovedPrompt } from "@main/db/improved-prompts";
import { handleImprovePrompt, cancelActiveImprovement } from "@main/prompt-improver/index";
import { detectCliTools } from "@main/prompt-improver/detect-tools";
import {
  IPC_CHANNELS,
  type AppSettings,
  type AudioSubmission,
  type ProviderId,
  type SaveDictionaryInput,
  type SavePromptCardInput,
  type SettingsSaveInput,
  type StartupProfile,
  type StartupStage,
} from "@shared/types";

const log = getLogger("ipc");
const { clipboard, shell } = electron;
const { app, ipcMain } = electronMain;

interface IpcHandlerOptions {
  getStartupProfile: () => StartupProfile;
  reportStartupHeartbeat: (stage: StartupStage) => void;
}

export function registerIpcHandlers(options: IpcHandlerOptions) {
  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.appGetStartupProfile, () => options.getStartupProfile());
  ipcMain.handle(IPC_CHANNELS.appStartupHeartbeat, (_, stage: StartupStage) => {
    options.reportStartupHeartbeat(stage);
  });
  ipcMain.handle(IPC_CHANNELS.appShowMainWindow, () => {
    showMainWindow();
  });
  ipcMain.handle(IPC_CHANNELS.appMinimizeToTray, () => {
    if (!hasTray()) {
      getMainWindow()?.minimize();
      return;
    }

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
  ipcMain.handle(IPC_CHANNELS.recordingSubmitAudio, async (_, submission: AudioSubmission) => {
    await handleRecordingSubmission(submission);
  });
  ipcMain.handle(IPC_CHANNELS.recordingReportError, (_, message: string) => {
    log.error("Recording error reported from renderer", { message });
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
  ipcMain.handle(IPC_CHANNELS.transcriptionsReinsert, (_, id: string) => {
    return reinsertTranscription(id);
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

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => getRendererSettings());
  ipcMain.handle(IPC_CHANNELS.settingsSave, (_, input: Partial<AppSettings> | SettingsSaveInput) => {
    const previous = getSettings();
    const normalizedInput = "patch" in input ? input : { patch: input };
    const settings = saveSettings(normalizedInput);
    const nextHotkeyStatus = refreshHotkeys();

    if (normalizedInput.patch.hotkey !== undefined && isHotkeyRegistrationEnabled() && !nextHotkeyStatus.registered) {
      saveSettings({ hotkey: previous.hotkey });
      refreshHotkeys();
      throw new Error(nextHotkeyStatus.message);
    }

    setWidgetVisibility(settings.showFloatingWidget);
    if (hasTray()) {
      rebuildTrayMenu();
    }
    return getRendererSettings();
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
  ipcMain.handle(IPC_CHANNELS.settingsTestProvider, (_, provider: ProviderId, draft?: Partial<AppSettings> | SettingsSaveInput) => testProvider(provider, draft));
  ipcMain.handle(IPC_CHANNELS.settingsOpenDiagnosticsFolder, async () => {
    const errorMessage = await shell.openPath(getDiagnosticsDir());

    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle(IPC_CHANNELS.widgetSetExpanded, (_, expanded: boolean) => {
    setWidgetExpanded(expanded);
  });

  ipcMain.handle(IPC_CHANNELS.improverImprove, async (_, rawText: string, transcriptionId?: string, categoryOverride?: string) => {
    await handleImprovePrompt(rawText, transcriptionId, (categoryOverride || undefined) as import("@shared/types").PromptCategory | undefined);
  });
  ipcMain.handle(IPC_CHANNELS.improverCancel, () => cancelActiveImprovement());
  ipcMain.handle(IPC_CHANNELS.improverList, (_, limit?: number, offset?: number) => listImprovedPrompts(limit, offset));
  ipcMain.handle(IPC_CHANNELS.improverDelete, (_, id: string) => {
    deleteImprovedPrompt(id);
  });
  ipcMain.handle(IPC_CHANNELS.improverDetectTools, () => detectCliTools());

  log.info("IPC handlers registered");
}

async function handleRecordingSubmission(submission: AudioSubmission) {
  try {
    const result = await processRecordingSubmission(submission, {
      applyDictionary,
      logger: log,
      saveToClipboard: (text) => clipboard.writeText(text),
      saveTranscription,
      transcribeAudio,
    });

    broadcast(IPC_CHANNELS.recordingResult, result);
    setRecordingState("idle");
  } catch (error) {
    log.error("Processing audio failed", {
      error,
      recordingId: submission.recordingId,
    });
    broadcast(IPC_CHANNELS.recordingError, error instanceof Error ? error.message : "Unknown recording error");
    setRecordingState("error");
    setTimeout(() => setRecordingState("idle"), 1600);
  }
}
