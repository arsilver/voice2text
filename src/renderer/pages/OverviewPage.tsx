import { useEffect, useMemo, useState } from "react";

import { formatProviderName } from "@shared/provider-order";
import type { DashboardStats, HotkeyStatus, ProviderHealth, RecordingState } from "@shared/types";

interface OverviewPageProps {
  stats: DashboardStats;
  recordingState: RecordingState;
  providerHealth: ProviderHealth[];
  hotkeyStatus: HotkeyStatus;
}

type MicrophonePermissionState = "checking" | "granted" | "prompt" | "denied" | "unsupported";

export function OverviewPage({ stats, recordingState, providerHealth, hotkeyStatus }: OverviewPageProps) {
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermissionState>("checking");
  const localWhisper = providerHealth.find((provider) => provider.provider === "whisper-local");
  const readyClouds = useMemo(
    () => providerHealth.filter((provider) => provider.provider !== "whisper-local" && provider.available),
    [providerHealth]
  );

  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null;

    async function checkMicrophonePermission() {
      if (!navigator.permissions?.query) {
        setMicrophonePermission("unsupported");
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setMicrophonePermission(mapMicrophoneState(permissionStatus.state));
        permissionStatus.onchange = () => {
          if (permissionStatus) {
            setMicrophonePermission(mapMicrophoneState(permissionStatus.state));
          }
        };
      } catch {
        setMicrophonePermission("unsupported");
      }
    }

    void checkMicrophonePermission();

    return () => {
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  return (
    <section className="panel utility-panel page-stack">
      <div className="section-heading-row">
        <div>
          <h1>Runtime</h1>
          <p>Provider status and recent dictation volume.</p>
        </div>
        <div className={`state-pill state-${recordingState}`}>{recordingState}</div>
      </div>

      <div className="launch-health-grid">
        <HealthChip
          label="Mic"
          value={formatMicrophoneValue(microphonePermission)}
          tone={getMicrophoneTone(microphonePermission)}
          detail={getMicrophoneDetail(microphonePermission)}
        />
        <HealthChip
          label="Hotkey"
          value={hotkeyStatus.accelerator || "Not set"}
          tone={hotkeyStatus.registered ? "success" : "warning"}
          detail={hotkeyStatus.message}
        />
        <HealthChip
          label="Local"
          value={localWhisper?.available ? "Ready" : "Missing"}
          tone={localWhisper?.available ? "success" : "warning"}
          detail={localWhisper?.message ?? "Local Whisper status unavailable."}
        />
        <HealthChip
          label="Cloud"
          value={`${readyClouds.length}/3 ready`}
          tone={readyClouds.length > 0 ? "success" : "warning"}
          detail={readyClouds.length > 0 ? readyClouds.map((provider) => formatProviderName(provider.provider)).join(", ") : "No cloud key validated yet."}
        />
      </div>

      <div className="overview-stats-grid">
        <StatCard
          label="Words transcribed"
          value={stats.totalWords}
          max={10000}
          color="var(--accent)"
          detail={`${stats.totalWords.toLocaleString()} total`}
        />
        <StatCard
          label="Speaking time"
          value={Math.round(stats.speakingTimeMs / 1000)}
          max={7200}
          color="var(--accent-blue)"
          detail={formatDuration(stats.speakingTimeMs)}
        />
        <StatCard
          label="Sessions"
          value={stats.sessions}
          max={200}
          color="var(--success)"
          detail={`${stats.sessions} recorded`}
        />
        <StatCard
          label="Avg pace"
          value={stats.averagePace}
          max={200}
          color="var(--warning)"
          detail={`${stats.averagePace} words/min`}
        />
      </div>

      <div className="section-divider" />

      <div className="section-heading-row section-heading-row-tight">
        <div>
          <h2>Providers</h2>
          <p>Availability at a glance.</p>
        </div>
      </div>

      <div className="provider-health-list">
        {providerHealth.map((provider) => (
          <article key={provider.provider} className="provider-health-row">
            <div className="provider-health-main">
              <strong>{formatProviderName(provider.provider)}</strong>
              <span className={provider.available ? "status-ok" : "status-bad"}>{provider.available ? "ready" : "blocked"}</span>
            </div>
            <div className="provider-health-message">{provider.message}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HealthChip({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "success" | "warning";
  detail: string;
}) {
  return (
    <article className="launch-health-chip">
      <div className="launch-health-head">
        <span className="stat-label">{label}</span>
        <span className={`status-pill status-${tone}`}>{tone === "success" ? "ok" : "check"}</span>
      </div>
      <strong>{value}</strong>
      <span className="launch-health-detail">{detail}</span>
    </article>
  );
}

function StatCard({
  label,
  value,
  max,
  color,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  detail: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-card-value">{value.toLocaleString()}</strong>
      <div className="stat-bar-track">
        <div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="stat-card-detail">{detail}</span>
    </article>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function mapMicrophoneState(state: PermissionState): MicrophonePermissionState {
  if (state === "granted" || state === "prompt" || state === "denied") {
    return state;
  }

  return "unsupported";
}

function formatMicrophoneValue(state: MicrophonePermissionState) {
  switch (state) {
    case "granted":
      return "Allowed";
    case "prompt":
      return "Ask on use";
    case "denied":
      return "Blocked";
    case "unsupported":
      return "Unknown";
    default:
      return "Checking";
  }
}

function getMicrophoneTone(state: MicrophonePermissionState) {
  return state === "granted" || state === "prompt" ? "success" : "warning";
}

function getMicrophoneDetail(state: MicrophonePermissionState) {
  switch (state) {
    case "granted":
      return "Microphone access is ready.";
    case "prompt":
      return "Windows may still ask on first capture.";
    case "denied":
      return "Enable microphone access for desktop apps.";
    case "unsupported":
      return "Permission state is unavailable here.";
    default:
      return "Checking microphone access.";
  }
}
