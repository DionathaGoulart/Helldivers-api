// JSON lines on stdout (arch §10); the human summary goes to `.reports/summary.md`.

export type LogLevel = "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
}

export function jsonLogger(
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
  const emit =
    (level: LogLevel) =>
    (msg: string, context: LogContext = {}) => {
      write(JSON.stringify({ level, msg, ...context }));
    };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
