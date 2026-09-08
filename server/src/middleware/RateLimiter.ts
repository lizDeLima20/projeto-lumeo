import { ApiError } from "../errors/ApiError.js";

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

interface Bucket { count: number; resetAt: number; }

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  public constructor(private readonly rules: Record<string, RateLimitRule>, private readonly now = () => Date.now()) {}

  public assertAllowed(key: string, route: string): void {
    const rule = this.rules[route];
    if (!rule) return;
    const bucketKey = `${route}:${key}`;
    const current = this.buckets.get(bucketKey);
    const time = this.now();
    if (!current || current.resetAt <= time) {
      this.buckets.set(bucketKey, { count: 1, resetAt: time + rule.windowMs });
      return;
    }
    current.count += 1;
    if (current.count > rule.max) throw new ApiError(429, "RATE_LIMITED", "Muitas tentativas. Aguarde um pouco e tente novamente.");
  }
}
