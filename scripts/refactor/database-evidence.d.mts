export interface LoopbackReadinessOptions {
  timeoutMs?: number;
}

export interface PostgresReadinessOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export function waitForLoopbackPort(
  host: string,
  port: number,
  options?: LoopbackReadinessOptions,
): Promise<void>;

export function waitForPostgresConnection<T>(
  check: () => T | Promise<T>,
  options?: PostgresReadinessOptions,
): Promise<T>;
