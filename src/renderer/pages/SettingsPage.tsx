import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SECRET_SETTING_KEY_LIST } from "@shared/settings-secrets";
import {
  getCloudPresetOptions,
  getPreferredModelPatch,
  prettifyLocalWhisperModel,
  resolveCloudPresetTier,
  resolveProviderModelLabel,
} from "@shared/provider-presets";
import { buildEffectiveProviderChain, formatProviderName } from "@shared/provider-order";
import type {
  AppSettings,
  LocalModelInfo,
  LocalModelProgress,
  ProviderHealth,
  ProviderId,
  ProviderPresetOption,
  ProviderTestResult,
  RemoteProviderId,
  SecretSettingKey,
  SettingsSaveInput,
  WhisperModelOption,
} from "@shared/types";

interface SettingsPageProps {
  settings: AppSettings;
  providerHealth: ProviderHealth[];
  whisperModels: WhisperModelOption[];
  localModels: LocalModelInfo[];
  onSave: (input: Partial<AppSettings> | SettingsSaveInput) => Promise<void>;
  onTestProvider: (provider: ProviderId, draft?: Partial<AppSettings> | SettingsSaveInput) => Promise<ProviderTestResult>;
  onOpenDiagnosticsFolder: () => Promise<void>;
  onInstallLocalModel: (modelId: string) => Promise<void>;
  onRemoveLocalModel: (modelId: string) => Promise<void>;
}

type AsyncState = "idle" | "pending" | "success" | "error";

interface AsyncFeedback {
  state: AsyncState;
  message: string;
}

const REMOTE_PROVIDERS: RemoteProviderId[] = ["openai", "groq", "deepgram"];
const CUSTOM_PRESET_VALUE = "__custom__";

export function SettingsPage({
  settings,
  providerHealth,
  whisperModels,
  localModels,
  onSave,
  onTestProvider,
  onOpenDiagnosticsFolder,
  onInstallLocalModel,
  onRemoveLocalModel,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [isDirty, setIsDirty] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<AsyncFeedback>({ state: "idle", message: "" });
  const [validationFeedback, setValidationFeedback] = useState<Partial<Record<ProviderId, AsyncFeedback>>>({});
  const [localModelFeedback, setLocalModelFeedback] = useState<Partial<Record<string, LocalModelProgress>>>({});
  const [clearedSecrets, setClearedSecrets] = useState<Partial<Record<SecretSettingKey, boolean>>>({});
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);

  // Refs so the unmount cleanup sees the latest values (not stale closures)
  const draftRef = useRef(draft);
  const isDirtyRef = useRef(isDirty);
  const clearedSecretsRef = useRef(clearedSecrets);
  draftRef.current = draft;
  isDirtyRef.current = isDirty;
  clearedSecretsRef.current = clearedSecrets;

  // Auto-save when leaving the Settings page (component unmount).
  // This ensures settings persist even if the user forgets to click Save.
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      if (isDirtyRef.current) {
        void persistDraft(draftRef.current, clearedSecretsRef.current, { showFeedback: false });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only sync from incoming settings prop when user has NO unsaved changes.
  // Without this guard, every background refreshData() call (e.g. after a
  // transcription completes) would reset the draft and lose the user's edits.
  useEffect(() => {
    if (!isDirty) {
      setDraft(settings);
      setClearedSecrets({});
      setValidationFeedback({});
    }
  }, [settings, isDirty]);

  useEffect(() => window.craftvoice.settings.onLocalModelProgress((progress) => {
    setLocalModelFeedback((current) => ({
      ...current,
      [progress.modelId]: progress,
    }));
  }), []);

  useEffect(() => {
    if (!isDirty) {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistDraft(draftRef.current, clearedSecretsRef.current, { showFeedback: false });
    }, 550);

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [draft, isDirty]);

  const providerHealthMap = useMemo(
    () => Object.fromEntries(providerHealth.map((item) => [item.provider, item])) as Partial<Record<ProviderId, ProviderHealth>>,
    [providerHealth]
  );
  const localWhisperOptions = useMemo(() => buildWhisperOptions(whisperModels, draft.whisperModel), [draft.whisperModel, whisperModels]);
  const availableProviders = useMemo(() => {
    const ready: ProviderId[] = [];

    if (providerHealthMap["whisper-local"]?.available) {
      ready.push("whisper-local");
    }
    if (hasConfiguredRemoteKey("openai", draft, providerHealthMap, clearedSecrets)) {
      ready.push("openai");
    }
    if (hasConfiguredRemoteKey("groq", draft, providerHealthMap, clearedSecrets)) {
      ready.push("groq");
    }
    if (hasConfiguredRemoteKey("deepgram", draft, providerHealthMap, clearedSecrets)) {
      ready.push("deepgram");
    }

    return ready;
  }, [clearedSecrets, draft.deepgramApiKey, draft.groqApiKey, draft.openaiApiKey, providerHealthMap]);

  const runtimeOrder = useMemo(() => buildEffectiveProviderChain(draft, availableProviders), [draft, availableProviders]);
  const selectedPrimaryReady =
    draft.defaultProvider === "whisper-local"
      ? Boolean(providerHealthMap["whisper-local"]?.available)
      : availableProviders.includes(draft.defaultProvider);
  const activeProvider = runtimeOrder[0] ?? null;
  const activeProviderLabel = activeProvider ? formatProviderName(activeProvider) : "None ready";

  function clearValidation(provider: ProviderId) {
    setValidationFeedback((current) => {
      const next = { ...current };
      delete next[provider];
      return next;
    });
  }

  function updateDraft<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setIsDirty(true);
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveFeedback({ state: "idle", message: "" });

    if (isSecretSettingKey(key)) {
      setClearedSecrets((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }

    if (key === "whisperModel") {
      clearValidation("whisper-local");
      return;
    }

    if (key === "openaiApiKey" || key === "openaiModel") {
      clearValidation("openai");
      return;
    }

    if (key === "groqApiKey" || key === "groqModel") {
      clearValidation("groq");
      return;
    }

    if (key === "deepgramApiKey" || key === "deepgramModel") {
      clearValidation("deepgram");
    }
  }

  function updateProviderSelection(provider: ProviderId, selection: string) {
    if (selection === CUSTOM_PRESET_VALUE) {
      return;
    }

    const patch = getPreferredModelPatch(provider, selection);
    const [nextKey, nextValue] = Object.entries(patch)[0] as [keyof AppSettings, AppSettings[keyof AppSettings]];
    updateDraft(nextKey, nextValue);
  }

  async function handleSave() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    await persistDraft(draft, clearedSecrets, { showFeedback: true });
    if (false) {
      await onSave(draft);
      // Don't clear isDirty — keep it true so that background refreshData()
      // calls after recordings never overwrite the user's current settings view.
      setSaveFeedback({ state: "success", message: "Saved." });
    }
  }

  async function handleValidate(provider: ProviderId) {
    setValidationFeedback((current) => ({
      ...current,
      [provider]: { state: "pending", message: "Checking..." },
    }));

    try {
      const result = await onTestProvider(provider, buildSettingsSaveInput(draft, clearedSecrets));
      setValidationFeedback((current) => ({
        ...current,
        [provider]: { state: result.ok ? "success" : "error", message: result.message },
      }));
    } catch (error) {
      setValidationFeedback((current) => ({
        ...current,
        [provider]: {
          state: "error",
          message: error instanceof Error ? error.message : `Unable to validate ${formatProviderName(provider)}.`,
        },
      }));
    }
  }

  async function persistDraft(
    nextDraft: AppSettings,
    nextClearedSecrets: Partial<Record<SecretSettingKey, boolean>>,
    options: { showFeedback: boolean }
  ) {
    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;

    if (options.showFeedback) {
      setSaveFeedback({ state: "pending", message: "Saving..." });
    }

    try {
      await onSave(buildSettingsSaveInput(nextDraft, nextClearedSecrets));

      if (saveRequestIdRef.current !== requestId) {
        return;
      }

      setDraft(clearSecretDraftValues(nextDraft));
      setClearedSecrets({});
      setIsDirty(false);

      if (options.showFeedback) {
        setSaveFeedback({ state: "success", message: "Saved." });
      } else {
        setSaveFeedback((current) => (current.state === "error" ? { state: "idle", message: "" } : current));
      }
    } catch (error) {
      if (saveRequestIdRef.current !== requestId) {
        return;
      }

      setSaveFeedback({
        state: "error",
        message: error instanceof Error ? error.message : "Unable to save settings.",
      });
    }
  }

  function resetSecretInput(key: SecretSettingKey) {
    setIsDirty(true);
    setDraft((current) => ({ ...current, [key]: "" }));
    setClearedSecrets((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSaveFeedback({ state: "idle", message: "" });
    clearValidation(getProviderBySecretKey(key));
  }

  function toggleSecretClear(key: SecretSettingKey) {
    setIsDirty(true);
    setDraft((current) => ({ ...current, [key]: "" }));
    setClearedSecrets((current) => ({
      ...current,
      [key]: !current[key],
    }));
    setSaveFeedback({ state: "idle", message: "" });
    clearValidation(getProviderBySecretKey(key));
  }

  return (
    <section className="panel settings-surface">
      <div className="section-heading-row">
        <div>
          <h1>Providers + behavior</h1>
          <p>Providers, input, clipboard, and fallback behavior.</p>
        </div>
        <div className="panel-actions">
          <button className="ghost-button compact-button" disabled={saveFeedback.state === "pending"} onClick={() => void onOpenDiagnosticsFolder()}>
            Open diagnostics
          </button>
          {saveFeedback.message ? <div className={`inline-feedback feedback-${saveFeedback.state}`}>{saveFeedback.message}</div> : null}
          <button className="primary-button compact-button" disabled={saveFeedback.state === "pending"} onClick={() => void handleSave()}>
            {saveFeedback.state === "pending" ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="summary-strip">
        <SummaryChip label="Preferred" value={formatProviderName(draft.defaultProvider)} />
        <SummaryChip label="Active now" value={activeProviderLabel} />
        <SummaryChip label="Clipboard" value="Copy after stop" />
      </div>

      <div className="settings-line-list">
        <SettingLine label="Primary provider" note="Saved choice and active runtime stay separate.">
          <div className="settings-line-controls settings-line-controls-wide">
            <label className="field compact-field">
              <span>Provider</span>
              <select value={draft.defaultProvider} onChange={(event) => updateDraft("defaultProvider", event.target.value as ProviderId)}>
                <option value="whisper-local">Local Whisper</option>
                <option value="openai">OpenAI</option>
                <option value="groq">Groq</option>
                <option value="deepgram">Deepgram</option>
              </select>
            </label>
            <div className={`inline-feedback ${selectedPrimaryReady ? "feedback-success" : "feedback-warning"}`}>
              {selectedPrimaryReady
                ? `${formatProviderName(draft.defaultProvider)} is active now.`
                : `${formatProviderName(draft.defaultProvider)} stays preferred while ${activeProviderLabel} handles runtime.`}
            </div>
          </div>
        </SettingLine>

        <SettingLine label="After stop" note="Clipboard-only during the stability reset. Paste is temporarily disabled.">
          <div className="settings-line-controls settings-line-controls-tight">
            <div className="provider-inline-note provider-inline-note-compact">
              <span>Clipboard</span>
              <strong>Always copy after stop</strong>
            </div>
            <CompactToggle
              label="Show widget"
              hint="Appears after startup is healthy. Safe mode hides it."
              checked={draft.showFloatingWidget}
              onChange={(checked) => updateDraft("showFloatingWidget", checked)}
            />
          </div>
        </SettingLine>

        <SettingLine label="Input + backup" note="Selected provider stays primary. Backups are only used when explicitly enabled.">
          <div className="settings-line-controls settings-line-controls-tight">
            <label className="field compact-field">
              <span>Microphone</span>
              <input
                value={draft.selectedMicrophoneId}
                onChange={(event) => updateDraft("selectedMicrophoneId", event.target.value)}
                placeholder="Blank = default input"
              />
            </label>
            <CompactToggle
              label="Use backup providers"
              hint={activeProvider ? runtimeOrder.map(formatProviderName).join(" -> ") : "No provider is ready yet."}
              checked={draft.fallbackEnabled}
              onChange={(checked) => updateDraft("fallbackEnabled", checked)}
            />
          </div>
        </SettingLine>
      </div>

      <div className="section-divider" />

      <div className="section-heading-row section-heading-row-tight">
        <div>
          <h2>Providers</h2>
          <p>Preset, resolved model, key, and validation in one row.</p>
        </div>
      </div>

      <div className="provider-compact-list">
        <ProviderCompactRow
          title="Local Whisper"
          provider="whisper-local"
          options={localWhisperOptions}
          selectedValue={draft.whisperModel}
          resolvedModel={resolveProviderModelLabel("whisper-local", draft.whisperModel)}
          health={providerHealthMap["whisper-local"]}
          feedback={validationFeedback["whisper-local"]}
          dirty={draft.whisperModel !== settings.whisperModel}
          disabled={saveFeedback.state === "pending"}
          onSelectionChange={(value) => updateProviderSelection("whisper-local", value)}
          onValidate={() => handleValidate("whisper-local")}
        />

        <div className="provider-inline-note provider-inline-note-compact">
          <span>Local models</span>
          <strong>Install, switch, and remove Whisper models in-app.</strong>
        </div>

        <div className="provider-compact-list">
          {localModels.map((model) => {
            const progress = localModelFeedback[model.id];
            const isBusy = progress?.stage === "downloading" || progress?.stage === "installing";

            return (
              <article key={model.id} className="provider-compact-row">
                <div className="provider-compact-head">
                  <div className="provider-compact-title">
                    <strong>{model.label}</strong>
                    <span className={`status-pill status-${model.installed ? "success" : "warning"}`}>
                      {model.installed ? (model.warm ? "warm" : model.selected ? "selected" : "installed") : "not installed"}
                    </span>
                    <span className="provider-compact-message">
                      {progress?.message ?? model.description}
                    </span>
                  </div>
                  <div className="panel-actions">
                    {model.installed ? (
                      <button
                        className="ghost-button compact-button"
                        disabled={saveFeedback.state === "pending" || isBusy || model.selected}
                        onClick={() => void onRemoveLocalModel(model.id)}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        className="ghost-button compact-button"
                        disabled={saveFeedback.state === "pending" || isBusy}
                        onClick={() => void onInstallLocalModel(model.id)}
                      >
                        {isBusy ? "Installing..." : "Install"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="provider-model-pill provider-model-pill-compact">
                  <span>Model</span>
                  <strong>{model.id}</strong>
                  <small>{formatLocalModelSize(model.sizeBytes)}</small>
                </div>
              </article>
            );
          })}
        </div>

        {REMOTE_PROVIDERS.map((provider) => {
          const model = getProviderModel(draft, provider);
          const apiKey = getProviderKey(draft, provider);
          const keyField = getProviderKeyField(provider);
          const storedKeyConfigured = Boolean(providerHealthMap[provider]?.configured);
          const clearRequested = Boolean(clearedSecrets[keyField]);
          const apiKeyPendingReplacement = apiKey.trim().length > 0;
          const apiKeyConfigured = apiKeyPendingReplacement || (storedKeyConfigured && !clearRequested);
          const currentTier = resolveCloudPresetTier(provider, model);
          const selectedValue = currentTier ?? CUSTOM_PRESET_VALUE;
          const dirty = model !== getProviderModel(settings, provider) || apiKeyPendingReplacement || clearRequested;

          return (
            <ProviderCompactRow
              key={provider}
              title={formatProviderName(provider)}
              provider={provider}
              options={getCloudPresetOptions(provider)}
              selectedValue={selectedValue}
              resolvedModel={resolveProviderModelLabel(provider, model)}
              rawModel={model}
              apiKey={apiKey}
              apiKeyConfigured={apiKeyConfigured}
              apiKeyHint={getApiKeyHint(storedKeyConfigured, apiKeyPendingReplacement, clearRequested)}
              apiKeyActionLabel={getApiKeyActionLabel(storedKeyConfigured, apiKeyPendingReplacement, clearRequested)}
              health={providerHealthMap[provider]}
              feedback={validationFeedback[provider]}
              dirty={dirty}
              disabled={saveFeedback.state === "pending"}
              onSelectionChange={(value) => updateProviderSelection(provider, value)}
              onApiKeyChange={(value) => updateDraft(getProviderKeyField(provider), value)}
              onApiKeyAction={() => {
                if (apiKeyPendingReplacement) {
                  resetSecretInput(keyField);
                  return;
                }

                if (storedKeyConfigured || clearRequested) {
                  toggleSecretClear(keyField);
                }
              }}
              onValidate={() => handleValidate(provider)}
            />
          );
        })}
      </div>
    </section>
  );
}

function ProviderCompactRow({
  title,
  provider,
  options,
  selectedValue,
  resolvedModel,
  rawModel,
  apiKey,
  apiKeyConfigured,
  apiKeyHint,
  apiKeyActionLabel,
  health,
  feedback,
  dirty,
  disabled,
  onSelectionChange,
  onApiKeyChange,
  onApiKeyAction,
  onValidate,
}: {
  title: string;
  provider: ProviderId;
  options: Array<WhisperModelOption | ProviderPresetOption>;
  selectedValue: string;
  resolvedModel: string;
  rawModel?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  apiKeyHint?: string;
  apiKeyActionLabel?: string;
  health?: ProviderHealth;
  feedback?: AsyncFeedback;
  dirty: boolean;
  disabled: boolean;
  onSelectionChange: (value: string) => void;
  onApiKeyChange?: (value: string) => void;
  onApiKeyAction?: () => void;
  onValidate: () => Promise<void>;
}) {
  const status = getProviderStatus(provider, health, feedback, dirty);

  return (
    <article className="provider-compact-row">
      <div className="provider-compact-head">
        <div className="provider-compact-title">
          <strong>{title}</strong>
          <span className={`status-pill status-${status.tone}`}>{status.label}</span>
          <span className="provider-compact-message">{status.message}</span>
        </div>
        <button className="ghost-button compact-button" disabled={disabled || feedback?.state === "pending"} onClick={() => void onValidate()}>
          {feedback?.state === "pending" ? "Checking..." : "Validate"}
        </button>
      </div>

      <div className={`provider-compact-grid${apiKey !== undefined ? "" : " provider-compact-grid-local"}`}>
        <label className="field compact-field">
          <span>{provider === "whisper-local" ? "Local preset" : "Tier"}</span>
          <select value={selectedValue} onChange={(event) => onSelectionChange(event.target.value)}>
            {selectedValue === CUSTOM_PRESET_VALUE ? <option value={CUSTOM_PRESET_VALUE}>Saved custom</option> : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="provider-model-pill provider-model-pill-compact">
          <span>Model</span>
          <strong>{resolvedModel}</strong>
          {selectedValue === CUSTOM_PRESET_VALUE && rawModel ? <small>{rawModel}</small> : null}
        </div>

        {apiKey !== undefined && onApiKeyChange ? (
          <label className="field compact-field key-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={apiKeyConfigured ? `${title} API key saved securely` : `${title} API key`}
              autoComplete="off"
            />
            {apiKeyHint ? <small className="key-field-note">{apiKeyHint}</small> : null}
            {apiKeyActionLabel && onApiKeyAction ? (
              <button type="button" className="ghost-button compact-button key-field-action" disabled={disabled} onClick={onApiKeyAction}>
                {apiKeyActionLabel}
              </button>
            ) : null}
          </label>
        ) : (
          <div className="provider-inline-note provider-inline-note-compact">
            <span>Local</span>
            <strong>Bundled safety net</strong>
          </div>
        )}
      </div>
    </article>
  );
}

function SettingLine({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="settings-line">
      <div className="settings-line-copy">
        <strong>{label}</strong>
        <p>{note}</p>
      </div>
      {children}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="compact-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </label>
  );
}

function getProviderStatus(
  provider: ProviderId,
  health: ProviderHealth | undefined,
  feedback: AsyncFeedback | undefined,
  dirty: boolean
): { label: string; tone: "success" | "error" | "warning"; message: string } {
  if (feedback?.state === "success") {
    return { label: "ready", tone: "success", message: feedback.message };
  }

  if (feedback?.state === "error") {
    return { label: "blocked", tone: "error", message: feedback.message };
  }

  if (feedback?.state === "pending") {
    return { label: "checking", tone: "warning", message: feedback.message };
  }

  if (dirty) {
    return { label: "changed", tone: "warning", message: "Unsaved changes." };
  }

  if (health?.available) {
    return { label: "saved", tone: "success", message: health.message };
  }

  return {
    label: provider === "whisper-local" ? "missing" : "needs key",
    tone: "error",
    message: health?.message ?? "Provider is not configured.",
  };
}

function buildWhisperOptions(whisperModels: WhisperModelOption[], currentModel: string) {
  const options = whisperModels.length > 0 ? whisperModels : [{ value: currentModel, label: prettifyLocalWhisperModel(currentModel) }];

  if (options.some((option) => option.value === currentModel)) {
    return options;
  }

  return [{ value: currentModel, label: `${prettifyLocalWhisperModel(currentModel)} (saved)` }, ...options];
}

function getProviderModel(settings: AppSettings, provider: ProviderId) {
  switch (provider) {
    case "openai":
      return settings.openaiModel;
    case "groq":
      return settings.groqModel;
    case "deepgram":
      return settings.deepgramModel;
    case "whisper-local":
      return settings.whisperModel;
  }
}

function getProviderKey(settings: AppSettings, provider: Exclude<ProviderId, "whisper-local">) {
  switch (provider) {
    case "openai":
      return settings.openaiApiKey;
    case "groq":
      return settings.groqApiKey;
    case "deepgram":
      return settings.deepgramApiKey;
  }
}

function getProviderKeyField(provider: Exclude<ProviderId, "whisper-local">): "openaiApiKey" | "groqApiKey" | "deepgramApiKey" {
  switch (provider) {
    case "openai":
      return "openaiApiKey";
    case "groq":
      return "groqApiKey";
    case "deepgram":
      return "deepgramApiKey";
  }
}

function buildSettingsSaveInput(
  draft: AppSettings,
  clearedSecrets: Partial<Record<SecretSettingKey, boolean>>
): SettingsSaveInput {
  return {
    patch: draft,
    clearSecrets: SECRET_SETTING_KEY_LIST.filter((key) => clearedSecrets[key]),
  };
}

function clearSecretDraftValues(settings: AppSettings): AppSettings {
  return {
    ...settings,
    openaiApiKey: "",
    groqApiKey: "",
    deepgramApiKey: "",
  };
}

function hasConfiguredRemoteKey(
  provider: RemoteProviderId,
  draft: AppSettings,
  providerHealthMap: Partial<Record<ProviderId, ProviderHealth>>,
  clearedSecrets: Partial<Record<SecretSettingKey, boolean>>
) {
  const keyField = getProviderKeyField(provider);
  return draft[keyField].trim().length > 0 || (Boolean(providerHealthMap[provider]?.configured) && !clearedSecrets[keyField]);
}

function isSecretSettingKey(key: keyof AppSettings): key is SecretSettingKey {
  return key === "openaiApiKey" || key === "groqApiKey" || key === "deepgramApiKey";
}

function getProviderBySecretKey(key: SecretSettingKey): RemoteProviderId {
  switch (key) {
    case "openaiApiKey":
      return "openai";
    case "groqApiKey":
      return "groq";
    case "deepgramApiKey":
      return "deepgram";
  }
}

function getApiKeyHint(storedKeyConfigured: boolean, pendingReplacement: boolean, clearRequested: boolean) {
  if (pendingReplacement) {
    return "New key will replace the saved one on save.";
  }

  if (clearRequested) {
    return "Saved key will be removed on save.";
  }

  if (storedKeyConfigured) {
    return "Saved securely on this device. Leave the field blank to keep it.";
  }

  return "Saved only on this device after you enter one.";
}

function getApiKeyActionLabel(storedKeyConfigured: boolean, pendingReplacement: boolean, clearRequested: boolean) {
  if (pendingReplacement) {
    return "Reset";
  }

  if (clearRequested) {
    return "Keep saved key";
  }

  if (storedKeyConfigured) {
    return "Clear saved key";
  }

  return "";
}

function formatLocalModelSize(sizeBytes: number | null) {
  if (!sizeBytes) {
    return "size unknown";
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(0)} MB`;
}
