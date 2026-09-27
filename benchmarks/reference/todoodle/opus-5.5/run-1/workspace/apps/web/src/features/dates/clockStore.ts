import { MIDNIGHT_SLACK_MS } from '@todoodle/shared/limits';
import { type LocalDate, localDateOf, msUntilNextLocalMidnight } from '@todoodle/shared/dates';

// The viewer's local date as one external store (ui.midnight_rollover). While anyone listens there is exactly
// one timeout (at the next local midnight + MIDNIGHT_SLACK_MS) and one visibilitychange + focus listener pair;
// each trigger re-reads the date, notifies only when it changed, and reschedules. All of it goes away with the
// last subscriber. The snapshot is a primitive string, so consumers compare it cheaply.

const listeners = new Set<() => void>();
let current: LocalDate = localDateOf(new Date());
let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(check, msUntilNextLocalMidnight(new Date()) + MIDNIGHT_SLACK_MS);
}

/** Re-reads the local date: notifies only when it changed, then reschedules the midnight timer. */
function check(): void {
  const next = localDateOf(new Date());
  const changed = next !== current;
  current = next;
  if (listeners.size > 0) schedule();
  if (changed) for (const listener of [...listeners]) listener();
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') check();
}

function start(): void {
  if (watching) return;
  watching = true;
  // A hidden tab may sleep through its timer: coming back re-reads the date.
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', check);
  // Re-read now (the date may have changed while nobody listened); this also schedules the timer.
  check();
}

function stop(): void {
  if (!watching) return;
  watching = false;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('focus', check);
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** useSyncExternalStore's subscribe. The first subscriber starts the timer and listeners; the last stops them. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/**
 * The viewer's current local date. Also for queryFns outside React (the counts query sends it as ?date=).
 * Without subscribers nothing keeps the snapshot fresh, so it is re-read on every call then.
 */
export function getLocalDateSnapshot(): LocalDate {
  if (!watching) current = localDateOf(new Date());
  return current;
}

/** Test helpers: whether the store is watching, and a full reset. */
export function clockStoreStats(): { subscribers: number; watching: boolean; timerPending: boolean } {
  return { subscribers: listeners.size, watching, timerPending: timer !== null };
}

export function resetClockStoreForTests(): void {
  stop();
  listeners.clear();
  current = localDateOf(new Date());
}
