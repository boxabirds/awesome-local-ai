/**
 * A clock a test can move, for the tests that are about time itself.
 *
 * Import this *first* — before anything that imports yjs — and say why in the import line. Yjs asks
 * `lib0/time` for the time of day, and `lib0` takes `Date.now` into a named function the first time its
 * module is evaluated, which is the number its undo manager compares against the pause that ends a
 * typing burst. A clock installed after that moment is a clock somebody else is already not looking at:
 * the test would move it and the undo manager would carry on telling the real time. Importing this file
 * first means the clock Yjs reads is the clock the test is holding.
 *
 * Only `Date` is faked, deliberately: nothing here is about timers, and a test that also swallowed the
 * event loop's timers would be a test that quietly changes what the code under test does.
 */
import { vi } from 'vitest';

vi.useFakeTimers({ toFake: ['Date'] });

/** Move time on by this much. Nothing waits for any of it. */
export function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/** What time the board thinks it is. */
export function now(): number {
  return Date.now();
}

/** Give the time this file started at back to the test runner when the file is done. */
export function release(): void {
  vi.useRealTimers();
}
