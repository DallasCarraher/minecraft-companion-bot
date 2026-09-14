/** Yields exponentially increasing delays (ms), doubling from `initialMs` up to `maxMs`, forever. */
export function* exponentialBackoff(
  initialMs: number,
  maxMs: number,
): Generator<number, never, void> {
  let delay = initialMs;
  while (true) {
    yield delay;
    delay = Math.min(delay * 2, maxMs);
  }
}
