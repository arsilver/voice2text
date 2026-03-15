export function getLogger(scope: string) {
  function write(level: "INFO" | "WARN" | "ERROR", args: unknown[]) {
    const prefix = `[${new Date().toISOString()}] [${level}] [${scope}]`;
    console.log(prefix, ...args);
  }

  return {
    info: (...args: unknown[]) => write("INFO", args),
    warn: (...args: unknown[]) => write("WARN", args),
    error: (...args: unknown[]) => write("ERROR", args),
  };
}

