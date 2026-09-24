export function logInfo(scope: string, message: string, data?: unknown): void {
  console.log(
    `[${new Date().toISOString()}] [${scope}] ${message}`,
    data === undefined ? "" : JSON.stringify(data, null, 2)
  );
}

export function logError(scope: string, message: string, err?: unknown): void {
  console.error(
    `[${new Date().toISOString()}] [${scope}] ERROR: ${message}`,
    err instanceof Error ? err.stack ?? err.message : err
  );
}

export function logWarn(scope: string, message: string, data?: unknown): void {
  console.warn(
    `[${new Date().toISOString()}] [${scope}] WARN: ${message}`,
    data === undefined ? "" : JSON.stringify(data, null, 2)
  );
}