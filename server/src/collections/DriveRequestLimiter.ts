/** Reasons Drive gives for a 403 that is worth trying again. A 403 for permission is not
 *  one of them: retrying it only burns quota. */
const RETRYABLE_403 = new Set(["ratelimitexceeded", "userratelimitexceeded", "quotaexceeded", "sharingratelimitexceeded"]);
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface LimiterOptions {
  concurrency?: number;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Keeps Lumeo from ever becoming the reason Drive says no: at most a few requests are in
 *  flight at once, and a throttled one waits and tries again instead of failing the screen.
 *
 *  Browsing is already one request per folder, so the queue exists for the bursts - a
 *  breadcrumb walk on a deep link, or several readers on one warm server. */
export class DriveRequestLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly concurrency: number;
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  public retries = 0;

  public constructor(options: LimiterOptions = {}) {
    this.concurrency = options.concurrency ?? 4;
    this.attempts = options.attempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 400;
    this.sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  public async run(task: () => Promise<Response>): Promise<Response> {
    await this.acquire();
    try { return await this.attempt(task); }
    finally { this.release(); }
  }

  private async attempt(task: () => Promise<Response>): Promise<Response> {
    let last: Response | null = null;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt) {
        // Exponential, with jitter so simultaneous readers do not retry in lockstep.
        const delay = this.baseDelayMs * 2 ** (attempt - 1);
        await this.sleep(Math.round(delay * (0.5 + this.random())));
        this.retries++;
      }
      const response = await task();
      if (response.ok || !await this.shouldRetry(response)) return response;
      last = response;
    }
    return last!;
  }

  private async shouldRetry(response: Response): Promise<boolean> {
    if (RETRYABLE_STATUS.has(response.status)) return true;
    if (response.status !== 403) return false;
    try {
      const body = await response.clone().json() as { error?: { errors?: { reason?: string }[] } };
      const reasons = body.error?.errors ?? [];
      return reasons.some(entry => RETRYABLE_403.has((entry.reason ?? "").toLowerCase()));
    } catch { return false; }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    return new Promise<void>(resolve => this.queue.push(() => { this.active++; resolve(); }));
  }
  private release(): void { this.active--; this.queue.shift()?.(); }
}
