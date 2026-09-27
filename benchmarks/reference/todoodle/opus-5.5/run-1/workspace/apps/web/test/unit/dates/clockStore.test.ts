import { MIDNIGHT_SLACK_MS } from '@todoodle/shared/limits';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockStoreStats, getLocalDateSnapshot, resetClockStoreForTests, subscribe } from '@/features/dates/clockStore';

// Story 8, TC-81..TC-84: the local-date clock store (fake timers; local wall-clock times, whatever the zone).

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});
afterEach(() => {
  resetClockStoreForTests();
  vi.useRealTimers();
  setHidden(false);
});

describe('ui.midnight_rollover: clock store', () => {
  it('TC-81 23:59:59 then +1,000 ms (+ slack): subscribers are told once and the date rolls over', () => {
    vi.setSystemTime(new Date(2026, 8, 25, 23, 59, 59, 0));
    resetClockStoreForTests();
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    expect(getLocalDateSnapshot()).toBe('2026-09-25');
    vi.advanceTimersByTime(1_000 + MIDNIGHT_SLACK_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLocalDateSnapshot()).toBe('2026-09-26');
    // Nothing more until the next midnight.
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('TC-82 a hidden tab sleeps past midnight: coming back (visibilitychange) re-reads the date and notifies', () => {
    vi.setSystemTime(new Date(2026, 8, 25, 22, 0, 0));
    resetClockStoreForTests();
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    // The timer never fires (a throttled background tab); the wall clock moves on.
    setHidden(true);
    vi.setSystemTime(new Date(2026, 8, 26, 8, 0, 0));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).not.toHaveBeenCalled();
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getLocalDateSnapshot()).toBe('2026-09-26');
    // window focus with the same date: no second notification.
    window.dispatchEvent(new Event('focus'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('TC-83 two subscribers share one timeout and one visibilitychange/focus pair', () => {
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    resetClockStoreForTests();
    const docAdd = vi.spyOn(document, 'addEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const a = subscribe(() => {});
    const b = subscribe(() => {});
    expect(docAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(winAdd.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(clockStoreStats()).toEqual({ subscribers: 2, watching: true, timerPending: true });
    a();
    b();
  });

  it('TC-84 the last unsubscribe clears the timeout and removes the listeners', () => {
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    resetClockStoreForTests();
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const a = subscribe(() => {});
    const b = subscribe(() => {});
    a();
    expect(clockStoreStats().watching).toBe(true);
    b();
    expect(clockStoreStats()).toEqual({ subscribers: 0, watching: false, timerPending: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(docRemove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(winRemove.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1);
  });

  it('without subscribers the snapshot is read fresh (queryFns outside React)', () => {
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    resetClockStoreForTests();
    expect(getLocalDateSnapshot()).toBe('2026-09-25');
    vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
    expect(getLocalDateSnapshot()).toBe('2026-09-27');
  });
});
