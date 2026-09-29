import { describe, expect, it } from 'vitest';
import {
  createConnectionMachine,
  type ConnectionState,
} from '../../src/client/sync/connectionState';

/**
 * The machine is driven with an injected clock (no real timers), so these
 * cover the badge timing without waiting — TC-19, TC-20, TC-21 in the design.
 */
function machine(overrides: { initial?: ConnectionState; confirmationMs?: number } = {}) {
  const states: ConnectionState[] = [];
  const timers = new Map<() => void, number>();
  let now = 0;
  const instance = createConnectionMachine({
    onState: (state) => states.push(state),
    setTimeout: (fn, ms) => {
      const id = (now += ms);
      timers.set(fn, id);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as () => void);
    },
    confirmationMs: overrides.confirmationMs ?? 2000,
    initial: overrides.initial,
  });
  // Fire the armed confirmation timer, if any is still pending.
  const advance = (ms: number) => {
    for (const [fn, id] of [...timers]) {
      if (id <= now && id > now - ms) {
        timers.delete(fn);
        fn();
      }
    }
  };
  return { instance, states, advance };
}

describe('createConnectionMachine', () => {
  it('starts in `connecting` and does not flicker to connected before sync', () => {
    const { instance, states } = machine();
    // An open socket that has not synced yet is still "Connecting…".
    instance.status('connected');
    expect(instance.state).toBe('connecting');
    expect(states).toEqual([]);
    // The first sync with an open socket is what turns the badge off.
    instance.sync(true);
    expect(instance.state).toBe('connected');
    expect(states).toEqual(['connected']);
  });

  it('a drop after we had synced is a reconnection (reconnecting, not connecting)', () => {
    const { instance } = machine();
    instance.status('connected');
    instance.sync(true);
    expect(instance.state).toBe('connected');
    instance.status('disconnected');
    expect(instance.state).toBe('reconnecting');
  });

  it('a drop before we ever synced is still the initial connection', () => {
    const { instance } = machine();
    instance.status('connected'); // open but never synced
    instance.status('disconnected');
    expect(instance.state).toBe('connecting');
  });

  it('coming back online shows the confirmation window, then goes idle (TC-20)', () => {
    const { instance, advance } = machine();
    instance.status('connected');
    instance.sync(true);
    instance.status('disconnected');
    expect(instance.state).toBe('reconnecting');

    // Reconnect + resync: a brief "Connected" confirmation, not straight idle.
    instance.status('connected');
    instance.sync(true);
    expect(instance.state).toBe('confirmed');

    advance(2000);
    expect(instance.state).toBe('connected');
  });

  it('a drop during the confirmation window goes straight back to reconnecting (TC-21)', () => {
    const { instance } = machine();
    instance.status('connected');
    instance.sync(true);
    instance.status('disconnected'); // -> reconnecting
    instance.status('connected');
    instance.sync(true); // -> confirmed (window open)
    expect(instance.state).toBe('confirmed');
    // Flaky link drops again before the window elapses.
    instance.status('disconnected');
    expect(instance.state).toBe('reconnecting');
  });

  it('a mid-session resync without a prior drop does not enter the window', () => {
    const { instance, states } = machine();
    instance.status('connected');
    instance.sync(false);
    instance.sync(true);
    expect(instance.state).toBe('connected');
    // A spurious later sync event must not re-show the badge.
    const before = states.length;
    instance.sync(true);
    expect(states.length).toBe(before);
  });
});
