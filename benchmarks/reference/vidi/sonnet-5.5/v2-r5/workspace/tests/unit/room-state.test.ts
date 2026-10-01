import { describe, expect, it } from 'vitest';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { nextRoomState, type RoomEvent, type RoomLifecycle } from '../../src/worker/room-state';

const STATES: RoomLifecycle[] = ['loading', 'ready', 'compacting', 'load-failed', 'storage-failed', 'hibernated'];
const EVENTS: RoomEvent[] = [
  { type: 'loaded' }, { type: 'loaded', quarantined: 2 }, { type: 'load-failed' },
  { type: 'compact-start' }, { type: 'compact-done' }, { type: 'compact-error' },
  { type: 'append-failed' }, { type: 'hibernate' }, { type: 'wake' },
  { type: 'connection' }, { type: 'connection', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS },
];

// Every valid edge of the room lifecycle diagram.
const EDGES: Array<[RoomLifecycle, RoomEvent, RoomLifecycle]> = [
  ['loading', { type: 'loaded' }, 'ready'],
  ['loading', { type: 'loaded', quarantined: 2 }, 'ready'],
  ['loading', { type: 'load-failed' }, 'load-failed'],
  ['ready', { type: 'compact-start' }, 'compacting'],
  ['compacting', { type: 'compact-done' }, 'ready'],
  ['compacting', { type: 'compact-error' }, 'ready'],
  ['ready', { type: 'append-failed' }, 'storage-failed'],
  ['storage-failed', { type: 'connection' }, 'loading'],
  ['ready', { type: 'hibernate' }, 'hibernated'],
  ['hibernated', { type: 'wake' }, 'loading'],
  ['hibernated', { type: 'connection' }, 'loading'],
  ['load-failed', { type: 'connection', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS }, 'loading'],
  ['load-failed', { type: 'connection', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS + 1 }, 'loading'],
  ['load-failed', { type: 'connection', sinceLoadFailedMs: LOAD_RETRY_MIN_INTERVAL_MS - 1 }, 'load-failed'],
];

describe('nextRoomState (TC-27)', () => {
  for (const [from, event, to] of EDGES) {
    it(`${from} + ${JSON.stringify(event)} → ${to}`, () => {
      expect(nextRoomState(from, event)).toBe(to);
    });
  }

  it('every other (state, event) pair is invalid and leaves the state unchanged', () => {
    // Payloads only matter for load-failed (elapsed time); elsewhere an edge is identified by its event type.
    const valid = (s: RoomLifecycle, e: RoomEvent) => EDGES.some(([f, ev]) => f === s && (
      s === 'load-failed' ? JSON.stringify(ev) === JSON.stringify(e) : ev.type === e.type));
    let checked = 0;
    for (const s of STATES) {
      for (const e of EVENTS) {
        if (valid(s, e)) continue;
        expect(nextRoomState(s, e), `${s} + ${JSON.stringify(e)}`).toBe(s);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('load-failed does not retry without an elapsed time', () => {
    expect(nextRoomState('load-failed', { type: 'connection' })).toBe('load-failed');
  });
});
