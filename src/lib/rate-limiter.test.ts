import { describe, it, expect } from "vitest";
import { InboundRateLimiter, parseRateLimitConfig } from "./rate-limiter.js";

describe("InboundRateLimiter", () => {
  it("allows all requests when maxRequests is 0 (disabled)", () => {
    const rl = new InboundRateLimiter({ maxRequests: 0, windowMs: 1000 });
    for (let i = 0; i < 100; i++) {
      expect(rl.check("127.0.0.1")).toBe(true);
    }
  });

  it("allows up to maxRequests then blocks", () => {
    const rl = new InboundRateLimiter({ maxRequests: 3, windowMs: 10000 });
    expect(rl.check("10.0.0.1")).toBe(true);
    expect(rl.check("10.0.0.1")).toBe(true);
    expect(rl.check("10.0.0.1")).toBe(true);
    expect(rl.check("10.0.0.1")).toBe(false);
  });

  it("tracks IPs independently", () => {
    const rl = new InboundRateLimiter({ maxRequests: 1, windowMs: 10000 });
    expect(rl.check("10.0.0.1")).toBe(true);
    expect(rl.check("10.0.0.1")).toBe(false);
    expect(rl.check("10.0.0.2")).toBe(true);
  });

  it("allows again after window expires", async () => {
    const rl = new InboundRateLimiter({ maxRequests: 1, windowMs: 50 });
    expect(rl.check("10.0.0.1")).toBe(true);
    expect(rl.check("10.0.0.1")).toBe(false);
    // Wait for window to expire
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rl.check("10.0.0.1")).toBe(true);
        resolve();
      }, 60);
    });
  });

  it("retryAfterMs returns positive value when limited", () => {
    const rl = new InboundRateLimiter({ maxRequests: 1, windowMs: 5000 });
    rl.check("10.0.0.1");
    const retry = rl.retryAfterMs("10.0.0.1");
    expect(retry).toBeGreaterThan(4000);
    expect(retry).toBeLessThanOrEqual(5000);
  });

  it("retryAfterMs returns 0 when not limited", () => {
    const rl = new InboundRateLimiter({ maxRequests: 5, windowMs: 1000 });
    expect(rl.retryAfterMs("10.0.0.1")).toBe(0);
  });

  it("reset clears all state", () => {
    const rl = new InboundRateLimiter({ maxRequests: 1, windowMs: 60000 });
    rl.check("10.0.0.1");
    expect(rl.check("10.0.0.1")).toBe(false);
    rl.reset();
    expect(rl.check("10.0.0.1")).toBe(true);
  });
});

describe("parseRateLimitConfig", () => {
  it("returns disabled config when maxRequests is 0 or missing", () => {
    const cfg = parseRateLimitConfig("0", undefined);
    expect(cfg.maxRequests).toBe(0);
    const cfg2 = parseRateLimitConfig(undefined, undefined);
    expect(cfg2.maxRequests).toBe(0);
  });

  it("parses valid numbers", () => {
    const cfg = parseRateLimitConfig("10", "30000");
    expect(cfg.maxRequests).toBe(10);
    expect(cfg.windowMs).toBe(30000);
  });

  it("defaults windowMs to 60000 when invalid", () => {
    const cfg = parseRateLimitConfig("5", "abc");
    expect(cfg.maxRequests).toBe(5);
    expect(cfg.windowMs).toBe(60000);
  });

  it("defaults windowMs to 60000 when maxRequests is invalid", () => {
    const cfg = parseRateLimitConfig("abc", "30000");
    expect(cfg.maxRequests).toBe(0);
    expect(cfg.windowMs).toBe(60000);
  });
});
