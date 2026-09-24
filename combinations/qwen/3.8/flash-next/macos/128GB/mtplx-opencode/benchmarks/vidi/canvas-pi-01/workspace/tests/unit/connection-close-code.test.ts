/**
 * Story 4 · the close code is the whole story of a failed load: 4500 means
 * "this board could not be read" (lock the canvas), 1011 means "the socket
 * broke / storage hiccup" (stay editable), and only a successful sync unlocks
 * again. The provider emits `connection-close` with the real close code, so the
 * mapping is tested here on the pure machine — see
 * `tests/component/load-failure.test.tsx` for what the locked state does to the
 * board, and `tests/e2e/broken-board.spec.ts` for the same thing in a browser.
 */
import { describe, expect, it } from 'vitest';
import {
  createConnectionMachine,
  type ConnectionState,
} from '../../src/client/sync/connectionState';
import { canEdit } from '../../src/client/App';

function machine() {
  const states: ConnectionState[] = [];
  const instance = createConnectionMachine({
    onState: (state) => states.push(state),
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => {},
    confirmationMs: 2000,
  });
  return { instance, states };
}

/** Reach a healthy, synced connection (what a returning user sees first). */
function synced(m: ReturnType<typeof machine>): void {
  m.instance.status('connected');
  m.instance.sync(true);
  m.states.length = 0;
}

describe('close-code mapping', () => {
  it('4500 (board could not be loaded) lands in load_failed, not reconnecting', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(4500);
    expect(m.instance.state).toBe('load_failed');
    expect(canEdit(m.instance.state)).toBe(false);
  });

  it('1011 (storage failure) reconnects and stays editable', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(1011);
    expect(m.instance.state).toBe('reconnecting');
    expect(canEdit(m.instance.state)).toBe(true);
  });

  it('any other code keeps the story-3 behaviour (reconnecting after a sync)', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(1006);
    expect(m.instance.state).toBe('reconnecting');

    const neverSynced = machine();
    neverSynced.instance.status('disconnected');
    neverSynced.instance.close(4500);
    // A board that was never readable is still a board we cannot read.
    expect(neverSynced.instance.state).toBe('load_failed');
  });

  it('load_failed survives the disconnect and the retry attempt', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(4500);
    m.states.length = 0;

    // The provider retries: status connected → a second failed attempt.
    m.instance.status('disconnected');
    m.instance.close(4500);
    expect(m.instance.state).toBe('load_failed');
    // Nothing was announced either: no flicker between two failed attempts.
    expect(m.states).toEqual([]);
  });

  it('the first successful sync out of load_failed goes straight back to connected', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(4500);
    m.states.length = 0;

    // Retry succeeds: provider reports the socket, then the sync.
    m.instance.status('connected');
    m.instance.sync(true);
    expect(m.instance.state).toBe('connected');
    expect(canEdit(m.instance.state)).toBe(true);
    expect(m.states).toEqual(['connected']);
  });

  it('a sync during load_failed without an open socket changes nothing', () => {
    const m = machine();
    synced(m);
    m.instance.status('disconnected');
    m.instance.close(4500);
    m.instance.sync(true);
    expect(m.instance.state).toBe('load_failed');
  });
});
