import { LIVE_ANNOUNCE_THROTTLE_MS } from '@todoodle/shared/limits';

export type AnnouncerSnapshot = { readonly message: string; readonly seq: number };

export type AnnouncerClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

// Looked up at call time, so fake timers installed by tests apply.
const realClock: AnnouncerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function changesMessage(count: number): string {
  return count === 1 ? '1 change made by someone else' : `${count} changes made by someone else`;
}

/**
 * Screen-reader summary of other people's changes (prd.announce_remote). Counts applied other-origin
 * events and announces them as one message: at once if the last announcement was at least
 * LIVE_ANNOUNCE_THROTTLE_MS ago, otherwise in one flush at lastAnnouncedAt + LIVE_ANNOUNCE_THROTTLE_MS.
 */
export function createAnnouncer(clock: AnnouncerClock = realClock) {
  let pending = 0;
  let lastAnnouncedAt: number | null = null;
  let timer: unknown = null;
  let snapshot: AnnouncerSnapshot = { message: '', seq: 0 };
  const listeners = new Set<() => void>();

  function announce() {
    timer = null;
    if (pending === 0) return;
    snapshot = { message: changesMessage(pending), seq: snapshot.seq + 1 };
    pending = 0;
    lastAnnouncedAt = clock.now();
    for (const listener of listeners) listener();
  }

  return {
    /** Called by dispatchEvent for each applied event made by someone else. */
    record(): void {
      pending++;
      if (timer !== null) return;
      const now = clock.now();
      if (lastAnnouncedAt === null || now - lastAnnouncedAt >= LIVE_ANNOUNCE_THROTTLE_MS) announce();
      else timer = clock.setTimeout(announce, lastAnnouncedAt + LIVE_ANNOUNCE_THROTTLE_MS - now);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): AnnouncerSnapshot {
      return snapshot;
    },
    /** Test helper: back to idle, nothing announced. */
    reset(): void {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      pending = 0;
      lastAnnouncedAt = null;
      snapshot = { message: '', seq: 0 };
    },
  };
}

export type Announcer = ReturnType<typeof createAnnouncer>;

/** The app's announcer, rendered by <LiveAnnouncer>. */
export const announcer: Announcer = createAnnouncer();
