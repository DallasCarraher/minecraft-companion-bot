export class TimeoutError extends Error {
  constructor(message = 'operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AbortedError extends Error {
  constructor(message = 'operation aborted') {
    super(message);
    this.name = 'AbortedError';
  }
}

/**
 * Runs `fn` with a signal that combines an outer signal and a timeout: aborting for either reason
 * actually fires the abort event `fn` observes, rather than merely racing and abandoning it.
 *
 * This matters because skills clean up (`bot.pathfinder.stop()`, `bot.pvp.stop()`, etc.)
 * exclusively by listening for their `ctx.signal`'s `abort` event — a bare `Promise.race` that
 * only rejects the *wrapper* promise on timeout would leave that cleanup path untriggered and
 * orphan whatever the skill was doing (e.g. a `followPlayer` goal left active forever).
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal: AbortSignal,
): Promise<T> {
  if (outerSignal.aborted) throw new AbortedError();

  const controller = new AbortController();
  let timedOut = false;

  const onOuterAbort = () => controller.abort();
  outerSignal.addEventListener('abort', onOuterAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw timedOut ? new TimeoutError() : new AbortedError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener('abort', onOuterAbort);
  }
}
