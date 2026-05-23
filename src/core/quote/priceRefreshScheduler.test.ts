import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedulePricePolling } from "./priceRefreshScheduler.js";

describe("schedulePricePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls fn immediately on start", () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    schedulePricePolling(fn, 1000);
    // tick() is synchronous — fn is invoked before the first await
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("schedules next call after intervalMs following success", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    schedulePricePolling(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    // flush the resolved-promise microtask so .then() runs and schedules setTimeout
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // finding 1: error must stop polling (not retry on every interval)
  it("stops polling after fn rejects — no further calls", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(undefined);
    schedulePricePolling(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0); // flush rejection microtask
    await vi.advanceTimersByTimeAsync(5000); // no setTimeout was scheduled
    expect(fn).toHaveBeenCalledTimes(1); // first call only — no retry
  });

  it("calls onError when fn rejects", async () => {
    const error = new Error("api down");
    const fn = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    schedulePricePolling(fn, 1000, onError);
    await vi.advanceTimersByTimeAsync(0); // flush rejection microtask
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("cancel stops future calls", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const cancel = schedulePricePolling(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // finding 2: no concurrent requests — next only starts after previous resolves
  it("does not fire next call until previous fn resolves", async () => {
    let resolveFirst!: () => void;
    const slowFn = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }))
      .mockResolvedValue(undefined);

    schedulePricePolling(slowFn, 100);

    // Even after 500ms, fn is still pending — no second call
    await vi.advanceTimersByTimeAsync(500);
    expect(slowFn).toHaveBeenCalledTimes(1);

    // Resolve the first call; .then() schedules setTimeout(tick, 100)
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0); // flush the .then() microtask
    expect(slowFn).toHaveBeenCalledTimes(1); // timer not fired yet

    await vi.advanceTimersByTimeAsync(100);
    expect(slowFn).toHaveBeenCalledTimes(2);
  });
});
