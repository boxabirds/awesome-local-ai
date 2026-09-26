import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changesMessage, createAnnouncer } from '@/features/live/announcer';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function announcerWithLog() {
  const announcer = createAnnouncer();
  const heard: string[] = [];
  announcer.subscribe(() => heard.push(announcer.getSnapshot().message));
  return { announcer, heard };
}

describe('live.client_sync: announcer (D8 timing)', () => {
  it('messages', () => {
    expect(changesMessage(1)).toBe('1 change made by someone else');
    expect(changesMessage(2)).toBe('2 changes made by someone else');
  });

  it('TC-C14 idle for 10,000 ms or more: one event is announced immediately', () => {
    const { announcer, heard } = announcerWithLog();
    announcer.record();
    expect(heard).toEqual(['1 change made by someone else']);

    vi.advanceTimersByTime(10_000);
    announcer.record();
    expect(heard).toEqual(['1 change made by someone else', '1 change made by someone else']);
    expect(announcer.getSnapshot().seq).toBe(2);
  });

  it('TC-C15 last announcement at t=0, events at 1 s, 2 s, 3 s: nothing at 9,999 ms, "3 changes" at 10,000 ms, count reset', () => {
    const { announcer, heard } = announcerWithLog();
    announcer.record(); // t=0
    heard.length = 0;
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1_000); // events at 1 s, 2 s and 3 s
      announcer.record();
    }
    vi.advanceTimersByTime(9_999 - 3_000);
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(heard).toEqual(['3 changes made by someone else']);

    // Count reset: the next event (inside the new window) is announced alone, 10 s later.
    vi.advanceTimersByTime(1_000);
    announcer.record();
    vi.advanceTimersByTime(9_000);
    expect(heard).toEqual(['3 changes made by someone else', '1 change made by someone else']);
  });

  it('boundary: an event 9,999 ms after the last announcement is deferred; at 10,000 ms it is immediate', () => {
    const { announcer, heard } = announcerWithLog();
    announcer.record();
    heard.length = 0;
    vi.advanceTimersByTime(9_999);
    announcer.record();
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(heard).toEqual(['1 change made by someone else']);

    const second = announcerWithLog();
    second.announcer.record();
    second.heard.length = 0;
    vi.advanceTimersByTime(10_000);
    second.announcer.record();
    expect(second.heard).toEqual(['1 change made by someone else']);
  });
});
