export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  flush(): void;
  cancel(): void;
}

/** Trailing-edge debounce: calls `fn` with the most recent args `waitMs` after the last call. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const invoke = () => {
    if (pendingArgs) {
      fn(...pendingArgs);
      pendingArgs = null;
    }
    timer = null;
  };

  const debounced = (...args: Args) => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  };

  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    invoke();
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  return debounced;
}
