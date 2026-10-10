// yjs reads its clock through lib0/time, which captures `Date.now` by value at
// module load, so vi.useFakeTimers()/vi.setSystemTime() cannot influence the
// UndoManager capture timeout. This seam installs a wrapper exactly once per
// worker (before any test module imports yjs) that consults a mutable clock
// only while a test explicitly activates it; everybody else keeps real time.
export interface FakeClock {
  active: boolean;
  now: number;
}

declare global {
  var __vidi6UndoClock: FakeClock | undefined;
  var __vidi6UndoClockPatched: boolean | undefined;
}

const clock: FakeClock = (globalThis.__vidi6UndoClock ??= { active: false, now: 0 });

if (globalThis.__vidi6UndoClockPatched !== true) {
  const realNow = Date.now.bind(Date);
  Date.now = () => (clock.active ? clock.now : realNow());
  globalThis.__vidi6UndoClockPatched = true;
}
