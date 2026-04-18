// Server-side rate limiter for inbound API requests.
// Tracks requests per IP using a sliding window and enforces limits
// on expensive endpoints (/v1/chat/completions, /v1/messages).

export interface RateLimitConfig {
  /** Max requests allowed within the window. 0 = disabled. */
  maxRequests: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
}

interface IpWindow {
  timestamps: number[];
}

export class InboundRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, IpWindow>();

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(ip: string): boolean {
    if (this.maxRequests <= 0) return true;

    const window = this.getOrCreate(ip);
    this.evict(window);

    if (window.timestamps.length >= this.maxRequests) {
      return false;
    }

    window.timestamps.push(Date.now());
    return true;
  }

  /** How long (ms) the caller should wait before retrying. 0 if allowed now. */
  retryAfterMs(ip: string): number {
    const window = this.windows.get(ip);
    if (!window || window.timestamps.length === 0) return 0;

    this.evict(window);
    if (window.timestamps.length < this.maxRequests) return 0;

    return Math.max(0, window.timestamps[0] + this.windowMs - Date.now());
  }

  reset(): void {
    this.windows.clear();
  }

  private getOrCreate(ip: string): IpWindow {
    let window = this.windows.get(ip);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(ip, window);
    }
    return window;
  }

  private evict(window: IpWindow): void {
    const cutoff = Date.now() - this.windowMs;
    let i = 0;
    while (i < window.timestamps.length && window.timestamps[i] < cutoff) i++;
    if (i > 0) window.timestamps.splice(0, i);
  }
}

export function parseRateLimitConfig(
  maxRequestsEnv: string | undefined,
  windowMsEnv: string | undefined,
): RateLimitConfig {
  const maxRequests = parseInt(maxRequestsEnv ?? "0", 10);
  const windowMs = parseInt(windowMsEnv ?? "60000", 10);

  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    return { maxRequests: 0, windowMs: 60000 };
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return { maxRequests, windowMs: 60000 };
  }
  return { maxRequests, windowMs };
}
