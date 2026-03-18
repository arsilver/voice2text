import type { StartupStage } from "@shared/types";

interface StartupHeartbeatWindow extends Window {
  __craftvoiceStartupStages?: Set<StartupStage>;
}

export function reportStartupStageOnce(stage: StartupStage) {
  const reportedStages = getReportedStartupStages();

  if (reportedStages.has(stage)) {
    return;
  }

  reportedStages.add(stage);
  void window.craftvoice.app.reportStartupHeartbeat(stage).catch(() => undefined);
}

function getReportedStartupStages() {
  const typedWindow = window as StartupHeartbeatWindow;
  typedWindow.__craftvoiceStartupStages ??= new Set<StartupStage>();
  return typedWindow.__craftvoiceStartupStages;
}
