/**
 * A lazily imported module that retries after a failure. Plain React.lazy caches a rejected import forever (one
 * failed chunk load would break the feature until reload); this forgets a rejected promise, so the next load()
 * imports again. load() is idempotent while a load is in flight or done; loaded() is the module once it arrived.
 */
export type LazyModule<T> = { load(): Promise<T>; loaded(): T | undefined };

export function lazyWithRetry<T>(factory: () => Promise<T>): LazyModule<T> {
  let pending: Promise<T> | null = null;
  let value: T | undefined;
  return {
    load() {
      pending ??= factory().then(
        (module) => {
          value = module;
          return module;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      return pending;
    },
    loaded: () => value,
  };
}
