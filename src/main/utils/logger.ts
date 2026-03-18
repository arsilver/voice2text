import util from "node:util";

import { createFileLoggerSession } from "@main/utils/file-logger";
import { getLogsDir } from "@main/utils/paths";

const fileSession = createFileLoggerSession({ logsDir: getLogsDir() });

export function getLogger(scope: string) {
  function write(level: "INFO" | "WARN" | "ERROR", args: unknown[]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${scope}]`;
    const serializedArgs = args.map(serializeLogArg).join(" ");

    console.log(prefix, ...args);
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

