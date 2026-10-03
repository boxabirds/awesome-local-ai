// A clock for the states that are a function of time (image.upload_stuck).
//
// "Unfinished" is not stored anywhere. It is what an upload that started more than five minutes ago
// looks like *now*, which means a renderer has to be asked again after a while — a board that only
// re-renders when the document changes would show "Uploading…" forever on an upload that died, and
// the difference between those two is the entire content of the state.
//
// The interval belongs to a component that has something to re-measure: it runs while at least one
// image on this board is still uploading and stops when there is not, so a board with no pictures in
// flight asks for nothing. The first tick is a minute, not thirty seconds, because the clock is not a
// spinner — the shortest gap that can be observed is the shortest gap that has to be seen.

import { useEffect, useState } from 'react';

/** How often a board with a picture in flight asks "is it still in flight?". */
export const UPLOAD_CLOCK_TICK_MS = 60_000;

/** The same, asked twice as often: fine-grained time in a test run (design §7). */
export const UPLOAD_CLOCK_TICK_TEST_MS = 1_000;

/**
 * "Now", re-measured while `active` is true — where `active` means "this board has a picture whose
 * upload has not finished". The value is a plain epoch millis, which is what `displayStatus` compares
 * `uploadStartedAt` against; nothing here knows what the answer is used for.
 */
export function useUploadClock(
  active: boolean,
  tickMs: number = UPLOAD_CLOCK_TICK_MS,
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Re-measure on the way in as well: a board that just acquired its first uploading image may
    // have been mounted for an hour, and its last `Date.now()` is that hour old.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [active, tickMs]);

  return now;
}
