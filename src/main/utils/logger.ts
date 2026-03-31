import util from "node:util";

import { createFileLoggerSession } from "@main/utils/file-logger";
import { isVerboseLoggingEnabled } from "@main/utils/runtime-flags";
import { getLogsDir } from "@main/utils/paths";

const fileSession = createFileLoggerSession({ logsDir: getLogsDir() });
const verboseLoggingEnabled = isVerboseLoggingEnabled();

export function getLogger(scope: string) {
  function write(level: "INFO" | "WARN" | "ERROR", args: unknown[]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${scope}]`;
    const serializedArgs = args.map(serializeLogArg).join(" ");

    if (shouldWriteToConsole(level)) {
      const consoleMethod = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
      consoleMethod(prefix, ...args);
    }
    fileSession.append(serializedArgs ? `${prefix} ${serializedArgs}` : prefix);
  }

  return {
    info: (...args: unknown[]) => write("INFO", args),
    warn: (...args: unknown[]) => write("WARN", args),
    error: (...args: unknown[]) => write("ERROR", args),
  };
}

export function getCurrentLogFilePath() {
  return fileSession.filePath;
}

function shouldWriteToConsole(level: "INFO" | "WARN" | "ERROR") {
  if (verboseLoggingEnabled) {
    return true;
  }

  return level === "ERROR";
}

function serializeLogArg(value: unknown) {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  return util.inspect(value, {
    breakLength: Infinity,
    colors: false,
    compact: true,
    depth: 6,
  });
}

