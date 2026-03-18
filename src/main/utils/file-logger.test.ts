import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLogFileName, createFileLoggerSession } from "./file-logger";

test("creates a log file and writes staged log lines", () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "craftvoice-logs-"));

  try {
    const session = createFileLoggerSession({
      logsDir,
      now: new Date("2026-03-18T12:00:00.000Z"),
      pid: 42,
      maxFiles: 3,
    });

    session.append("[2026-03-18T12:00:01.000Z] [INFO] [ipc] recording-stage { stage: 'transcription-start' }");
    session.append("[2026-03-18T12:00:02.000Z] [INFO] [ipc] recording-stage { stage: 'clipboard-updated' }");

    const filePath = path.join(logsDir, buildLogFileName(new Date("2026-03-18T12:00:00.000Z"), 42));
    const contents = fs.readFileSync(filePath, "utf8");

    assert.equal(session.filePath, filePath);
    assert.match(contents, /transcription-start/);
    assert.match(contents, /clipboard-updated/);
  } finally {
    fs.rmSync(logsDir, { force: true, recursive: true });
  }
});
