import fs from "node:fs";
import path from "node:path";

const DEFAULT_LOG_FILE_LIMIT = 12;

export interface FileLoggerSessionOptions {
  logsDir: string;
  now?: Date;
  pid?: number;
  maxFiles?: number;
}

export interface FileLoggerSession {
  filePath: string;
  append: (line: string) => void;
}

export function createFileLoggerSession({
  logsDir,
  now = new Date(),
  pid = process.pid,
  maxFiles = DEFAULT_LOG_FILE_LIMIT,
}: FileLoggerSessionOptions): FileLoggerSession {
  fs.mkdirSync(logsDir, { recursive: true });
  pruneOldLogFiles(logsDir, maxFiles - 1);

  const filePath = path.join(logsDir, buildLogFileName(now, pid));
  fs.writeFileSync(filePath, "", { encoding: "utf8", flag: "a" });

  return {
    filePath,
    append(line: string) {
      fs.appendFileSync(filePath, `${line}\n`, "utf8");
    },
  };
}

export function buildLogFileName(now: Date, pid: number) {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `craftvoice-${iso}-pid${pid}.log`;
}

export function pruneOldLogFiles(logsDir: string, maxFiles: number) {
  const logFiles = fs
    .readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(logsDir, entry.name),
      modifiedAt: fs.statSync(path.join(logsDir, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const staleFile of logFiles.slice(Math.max(0, maxFiles))) {
    fs.rmSync(staleFile.fullPath, { force: true });
  }
}
