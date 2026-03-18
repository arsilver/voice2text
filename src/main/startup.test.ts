import assert from "node:assert/strict";
import test from "node:test";

import { createStartupGate, resolveDeferredStartupServices, resolveStartupRuntimeFlags } from "./startup";

test("startup runtime flags resolve normal, minimal, and safe profiles from env", () => {
  assert.deepEqual(resolveStartupRuntimeFlags({}), {
    profile: "normal",
    safeMode: false,
    minimalStartup: false,
    disableGpu: false,
    disableTray: false,
    disableHotkeys: false,
  });

  assert.deepEqual(resolveStartupRuntimeFlags({ CRAFTVOICE_MINIMAL_STARTUP: "1" }), {
    profile: "minimal",
    safeMode: false,
    minimalStartup: true,
    disableGpu: false,
    disableTray: false,
    disableHotkeys: false,
  });

  assert.deepEqual(resolveStartupRuntimeFlags({ CRAFTVOICE_SAFE_MODE: "1" }), {
    profile: "safe",
    safeMode: true,
    minimalStartup: true,
    disableGpu: true,
    disableTray: true,
    disableHotkeys: true,
  });
});

test("startup gate keeps tray and hotkeys disabled until every heartbeat stage arrives", () => {
  const gate = createStartupGate({
    disableHotkeys: false,
    disableTray: false,
  });

  assert.deepEqual(gate.getSnapshot(), {
    healthy: false,
    hotkeysAllowed: false,
    missingStages: ["dom-ready", "app-mounted", "interactive"],
    receivedStages: [],
    timedOut: false,
      trayAllowed: false,
  });

  const domReady = gate.reportStage("dom-ready");
  const appMounted = gate.reportStage("app-mounted");
  const healthy = gate.reportStage("interactive");

  assert.equal(domReady.changed, true);
  assert.equal(appMounted.changed, true);
  assert.equal(healthy.changed, true);
  assert.equal(healthy.snapshot.healthy, true);
  assert.equal(healthy.snapshot.trayAllowed, true);
  assert.equal(healthy.snapshot.hotkeysAllowed, true);
});

test("startup gate keeps extras disabled after timeout and honors safe-mode disable flags", () => {
  const safeGate = createStartupGate({
    disableHotkeys: true,
    disableTray: true,
  });

  safeGate.reportStage("dom-ready");
  safeGate.reportStage("app-mounted");
  const safeHealthy = safeGate.reportStage("interactive");
  assert.equal(safeHealthy.snapshot.healthy, true);
  assert.equal(safeHealthy.snapshot.trayAllowed, false);
  assert.equal(safeHealthy.snapshot.hotkeysAllowed, false);

  const timedOutGate = createStartupGate({
    disableHotkeys: false,
    disableTray: false,
  });

  timedOutGate.reportStage("dom-ready");
  const timeoutUpdate = timedOutGate.markTimedOut();
  const timedOut = timedOutGate.reportStage("interactive");

  assert.equal(timeoutUpdate.changed, true);
  assert.equal(timedOut.snapshot.healthy, false);
  assert.equal(timedOut.snapshot.timedOut, true);
  assert.equal(timedOut.snapshot.trayAllowed, false);
  assert.equal(timedOut.snapshot.hotkeysAllowed, false);
});

test("startup gate ignores duplicate stage reports", () => {
  const gate = createStartupGate({
    disableHotkeys: false,
    disableTray: false,
  });

  const firstAppMounted = gate.reportStage("app-mounted");
  const duplicateAppMounted = gate.reportStage("app-mounted");
  const firstInteractive = gate.reportStage("interactive");
  const duplicateInteractive = gate.reportStage("interactive");

  assert.equal(firstAppMounted.changed, true);
  assert.equal(duplicateAppMounted.changed, false);
  assert.deepEqual(duplicateAppMounted.snapshot.receivedStages, ["app-mounted"]);
  assert.equal(firstInteractive.changed, true);
  assert.equal(duplicateInteractive.changed, false);
  assert.deepEqual(duplicateInteractive.snapshot.receivedStages, ["app-mounted", "interactive"]);
});

test("startup gate emits timeout state once and ignores duplicate post-timeout heartbeats", () => {
  const gate = createStartupGate({
    disableHotkeys: false,
    disableTray: false,
  });

  gate.reportStage("dom-ready");
  const firstTimeout = gate.markTimedOut();
  const duplicateTimeout = gate.markTimedOut();
  const firstInteractive = gate.reportStage("interactive");
  const duplicateInteractive = gate.reportStage("interactive");

  assert.equal(firstTimeout.changed, true);
  assert.equal(duplicateTimeout.changed, false);
  assert.equal(firstInteractive.changed, true);
  assert.equal(duplicateInteractive.changed, false);
  assert.equal(duplicateInteractive.snapshot.timedOut, true);
  assert.equal(duplicateInteractive.snapshot.healthy, false);
});

test("deferred startup services only restore the widget after healthy startup outside safe mode", () => {
  assert.deepEqual(
    resolveDeferredStartupServices(
      {
        disableHotkeys: false,
        disableTray: false,
        safeMode: false,
      },
      { healthy: false },
      { showFloatingWidget: true }
    ),
    {
      enableHotkeys: false,
      enableTray: false,
      showWidget: false,
    }
  );

  assert.deepEqual(
    resolveDeferredStartupServices(
      {
        disableHotkeys: false,
        disableTray: false,
        safeMode: false,
      },
      { healthy: true },
      { showFloatingWidget: true }
    ),
    {
      enableHotkeys: true,
      enableTray: true,
      showWidget: true,
    }
  );

  assert.deepEqual(
    resolveDeferredStartupServices(
      {
        disableHotkeys: true,
        disableTray: true,
        safeMode: true,
      },
      { healthy: true },
      { showFloatingWidget: true }
    ),
    {
      enableHotkeys: false,
      enableTray: false,
      showWidget: false,
    }
  );
});
