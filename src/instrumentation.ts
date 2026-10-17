export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getEnv }, { logEvent }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/logger"),
  ]);
  const environment = getEnv();
  logEvent("info", "application_startup", { environment: environment.NODE_ENV });
  if (environment.NODE_ENV === "production") {
    const [
      { startHealthSyncRefreshWorker },
      { startTrainingRefreshWorker },
    ] = await Promise.all([
      import("@/modules/health/health-sync-refresh-worker"),
      import("@/modules/training/training-refresh-worker"),
    ]);
    startHealthSyncRefreshWorker();
    startTrainingRefreshWorker();
  }
}
