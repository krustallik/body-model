/** Shared only by read-only model views; never retries a mutation/POST. */
export class ModelRefreshPendingError extends Error {
  constructor() { super("model_refresh_pending"); this.name = "ModelRefreshPendingError"; }
}

export function modelReadIsPending(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = body as { error?: string; refreshPending?: boolean;
    status?: { productionCurrent?: boolean; productionDirtyFromDate?: string | null } };
  return value.error === "training_refresh_pending" || value.error === "model_refresh_pending"
    || value.refreshPending === true
    || (value.status?.productionCurrent === false && value.status.productionDirtyFromDate != null);
}

function waitForReadRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchCurrentModelRead(url: string, options: {
  signal?: AbortSignal;
  onPending?: () => void;
  isPending?: (body: unknown) => boolean;
  maxAttempts?: number;
  retryDelayMs?: number;
} = {}): Promise<Response> {
  const signal = options.signal ?? new AbortController().signal;
  const maxAttempts = options.maxAttempts ?? 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(url, { cache: "no-store", signal: controller.signal });
      body = await response.clone().json().catch(() => null);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
    }
    signal.throwIfAborted();
    if (!(options.isPending ?? modelReadIsPending)(body)) return response;
    options.onPending?.();
    if (attempt + 1 === maxAttempts) throw new ModelRefreshPendingError();
    await waitForReadRetry(signal, options.retryDelayMs ?? 3_000);
  }
  throw new ModelRefreshPendingError();
}
