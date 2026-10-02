/*! One clock for everything on the board that has to know what time it is.
 *
 * Story 12 needs it for a reason worth stating: an image whose upload never
 * finished is "still uploading" and "didn't finish" at the same time, and which of
 * the two a person is told depends on how long ago the board last heard from the
 * person who was uploading it. A clock that only ran when the board was touched
 * would be a clock that told somebody their picture was on its way forever, because
 * a board which shows the truth without being asked has to notice time passing on
 * its own.
 *
 * So there is one timer for the whole page rather than one per object: fifty
 * pictures on a board are fifty readers of the same ticking number, and the timer
 * is stopped the moment nobody is reading it.
 */
import { useSyncExternalStore } from 'react';
import { IMAGE_CLOCK_TICK_MS } from '../../shared/config';

/** How often the clock moves. The only demand on it is that it moves more often
 * than the threshold it is used against, so the board says "didn't finish" within
 * one tick of the moment that became true — and a board which asked every second
 * would be a board that re-painted fifty pictures for no news. */
export const CLOCK_TICK_MS = IMAGE_CLOCK_TICK_MS;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function start(): void {
  if (timer !== null) return;
  now = Date.now();
  timer = setInterval(() => {
    now = Date.now();
    for (const listener of listeners) listener();
  }, CLOCK_TICK_MS);
}

function stop(): void {
  if (listeners.size !== 0 || timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** The current moment, and a re-render when it has moved enough to matter. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}

// Both callbacks are module-level and so are stable for the life of the page. That
// is not a style preference: `useSyncExternalStore` re-subscribes whenever
// `subscribe` is a new function, which on every render it is, and a re-subscribe
// which restarts the clock would be a clock that moves each time it is looked at —
// twenty pictures on a board then re-render twenty times each, forever, which is what
// React calls "maximum update depth exceeded".
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stop();
  };
}

function getNow(): number {
  return now;
}
