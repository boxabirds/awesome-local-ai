import { LIVE_ANNOUNCE_THROTTLE_MS } from '@todoodle/shared/limits';

export type Announcement = { message: string; seq: number };

export type AnnouncerClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const realClock: AnnouncerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function announcementText(count: number): string {
  return count === 1 ? '1 change made by someone else' : `${count} changes made by someone else`;
}

export type Announcer = {
  /** Counts one applied change made by someone else. */
  record(event?: unknown): void;
  subscribe(listener: () => void): () => void;
  /** The latest announcement (`seq` changes even when the text repeats). */
  getSnapshot(): Announcement;
  dispose(): void;
};

/**
 * Groups others' changes into polite announcements: the first one after a quiet period is
 * announced at once (leading edge), later ones at most once per LIVE_ANNOUNCE_THROTTLE_MS.
 */
export function createAnnouncer(clock: AnnouncerClock = realClock, throttleMs = LIVE_ANNOUNCE_THROTTLE_MS): Announcer {
  let pending = 0;
  let lastAnnouncedAt = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let snapshot: Announcement = { message: '', seq: 0 };
  const listeners = new Set<() => void>();

  function announce() {
    timer = null;
    if (pending === 0) return;
    snapshot = { message: announcementText(pending), seq: snapshot.seq + 1 };
    pending = 0;
    lastAnnouncedAt = clock.now();
    for (const listener of listeners) listener();
  }

  return {
    record() {
      pending++;
      const now = clock.now();
      if (now - lastAnnouncedAt >= throttleMs) {
        if (timer !== null) clock.clearTimeout(timer);
        announce();
      } else if (timer === null) {
        timer = clock.setTimeout(announce, lastAnnouncedAt + throttleMs - now);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    dispose() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}
