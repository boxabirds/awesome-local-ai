/**
 * A `Date.now` the undo tests can move.
 *
 * `yjs` takes `Date.now` once, at import (`export const getUnixTime = Date.now` in `lib0`),
 * so `vi.useFakeTimers()` installed afterwards cannot reach the undo capture window. This
 * module replaces `Date.now` when it is imported, so importing it *before* `yjs` puts the
 * clock in the test's hands. `reset()` puts the wall clock back.
 */
const wallNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => wallNow() + offset;

export const fakeClock = {
  /** Move the clock the undo manager sees forward by `ms`. */
  advance(ms: number): void {
    offset += ms;
  },
  /** Hand the wall clock back. */
  reset(): void {
    offset = 0;
  },
  /** What the undo manager thinks the time is. */
  now(): number {
    return Date.now();
  },
};
