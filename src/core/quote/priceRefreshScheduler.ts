export type PollFn = () => Promise<void>;
export type CancelFn = () => void;

/**
 * Calls fn immediately, then reschedules after intervalMs only when the
 * previous call succeeds (chain-of-setTimeout). On rejection, polling stops
 * and onError is called once. Returns a cancel function.
 *
 * This pattern prevents two failure modes inherent to setInterval:
 *   1. Persistent errors causing infinite retry loops
 *   2. Concurrent in-flight requests when a response is slower than the interval
 */
export function schedulePricePolling(fn: PollFn, intervalMs: number, onError?: (err: unknown) => void): CancelFn {
  let nextId: ReturnType<typeof setTimeout> | null = null;
  let active = true;

  const tick = (): void => {
    fn()
      .then(() => {
        if (active) nextId = setTimeout(tick, intervalMs);
      })
      .catch((err: unknown) => {
        if (active) onError?.(err);
        // deliberately no next setTimeout — polling stops on error
      });
  };

  tick();

  return () => {
    active = false;
    if (nextId !== null) {
      clearTimeout(nextId);
      nextId = null;
    }
  };
}
