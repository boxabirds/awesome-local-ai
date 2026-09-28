// Component tests for the connection badge + connectBoard's provider→state
// mapping. A fake provider event emitter drives the state machine; fake timers
// drive the confirmation window. No real WebSocket is opened.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useEffect, useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
  type ProviderFactory,
} from '../../src/client/collab/connectBoard.ts';
import { ConnectionStatus } from '../../src/client/collab/ConnectionStatus.tsx';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config.ts';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.ts';

// The badge's own red. jsdom serialises the hex literal to rgb() in the CSSOM.
const RED = 'rgb(198, 40, 40)';

// A minimal fake matching the BoardProvider surface that connectBoard uses.
class FakeProvider implements BoardProvider {
  destroyed = false;
  private handlers = new Map<string, Set<(p: never) => void>>();
  on(event: string, cb: (p: never) => void): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(cb);
  }
  off(event: string, cb: (p: never) => void): void {
    this.handlers.get(event)?.delete(cb);
  }
  destroy(): void {
    this.destroyed = true;
  }
  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((cb) => cb(payload as never));
  }
}

// Drives ConnectionStatus from a real connectBoard() against the fake provider.
function Harness({ provider }: { provider: FakeProvider }): React.JSX.Element {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const factory: ProviderFactory = () => provider;
    const conn = connectBoard(new Y.Doc(), 'test-board', setState, factory);
    return () => conn.destroy();
  }, [provider]);
  return <ConnectionStatus state={state} />;
}

describe('ConnectionStatus badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // TC-19: initial connecting → hidden once synced (first sync).
  it('TC-19 connecting then hidden after first sync', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connecting');
    expect(badge).toHaveAttribute('data-state', 'connecting');

    act(() => provider.emit('sync', true));
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-20: connected → disconnected → connected, "Connected" stays visible for
  // CONNECTED_CONFIRMATION_MS - 1 and disappears at exactly that boundary.
  it('TC-20 reconnect confirms for exactly CONNECTED_CONFIRMATION_MS', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);

    act(() => provider.emit('sync', true)); // connected (hidden)
    expect(screen.queryByRole('status')).toBeNull();

    act(() => provider.emit('status', { status: 'disconnected' }));
    const reconnecting = screen.getByRole('status');
    expect(reconnecting).toHaveTextContent('Reconnecting');
    expect(reconnecting).toHaveAttribute('data-state', 'reconnecting');

    act(() => provider.emit('sync', true));
    const confirmed = screen.getByRole('status');
    expect(confirmed).toHaveTextContent('Connected');
    expect(confirmed).toHaveAttribute('data-state', 'confirmed');

    // One millisecond short of the boundary: still visible.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    // The exact boundary: hidden.
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  // TC-21: a drop during confirmation shows "Reconnecting…" immediately.
  it('TC-21 dropping during confirmation returns to reconnecting at once', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);

    act(() => provider.emit('sync', true));
    act(() => provider.emit('status', { status: 'disconnected' }));
    act(() => provider.emit('sync', true)); // now 'confirmed', timer pending
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'confirmed');

    act(() => provider.emit('status', { status: 'disconnected' }));
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Reconnecting');
    expect(badge).toHaveAttribute('data-state', 'reconnecting');

    // The cancelled confirmation timer must not later hide the badge.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1000));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  });
});

/** Records every state connectBoard emits, in order. */
function RecordingHarness({
  provider,
  states,
}: {
  provider: FakeProvider;
  states: ConnectionState[];
}): null {
  useEffect(() => {
    const factory: ProviderFactory = () => provider;
    const conn = connectBoard(new Y.Doc(), 'test-board', (s) => states.push(s), factory);
    return () => conn.destroy();
  }, [provider, states]);
  return null;
}

// TC-22: the load-failure message - its exact text, role=status, and red.
describe('TC-22 load_failed badge', () => {
  it('shows the load-failure message in red with role=status', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);

    act(() => provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED }));

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge).toHaveAttribute('data-state', 'load_failed');
    // Red, and not the amber used for connectivity states.
    expect(badge.style.color).toBe(RED);
    expect(badge).not.toHaveStyle({ color: 'rgb(178, 106, 0)' });
  });

  it('is shown for a close code of exactly 4500 and nothing else', () => {
    for (const code of [1006, 1011, 1013, 4400, 4499, 4501]) {
      const provider = new FakeProvider();
      const { unmount } = render(<Harness provider={provider} />);
      act(() => provider.emit('connection-close', { code }));
      const badge = screen.getByRole('status');
      expect(badge, `code ${code}`).not.toHaveAttribute('data-state', 'load_failed');
      unmount();
    }
  });

  it('a locally closed socket (no CloseEvent) is never a load failure', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    act(() => provider.emit('connection-close', null));
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('data-state', 'connecting');
  });
});

// TC-28: load_failed recovers on the first successful sync.
describe('TC-28 load_failed recovery', () => {
  it('goes straight back to connected - never to confirmed - on the first sync', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<RecordingHarness provider={provider} states={states} />);

    act(() => provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED }));
    expect(states).toEqual(['load_failed']);

    // The background reconnect chatter must not overwrite the message.
    act(() => provider.emit('status', { status: 'disconnected' }));
    act(() => provider.emit('status', { status: 'connecting' }));
    act(() => provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED }));
    expect(states).toEqual(['load_failed']);

    act(() => provider.emit('sync', true));
    expect(states).toEqual(['load_failed', 'connected']);
    expect(states).not.toContain('confirmed');
    expect(states).not.toContain('reconnecting');
  });

  it('a board that had synced before falling back to load_failed still returns to connected', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<RecordingHarness provider={provider} states={states} />);

    act(() => provider.emit('sync', true));
    expect(states).toEqual(['connected']);

    act(() => provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED }));
    expect(states).toEqual(['connected', 'load_failed']);

    act(() => provider.emit('sync', true));
    expect(states).toEqual(['connected', 'load_failed', 'connected']);
  });

  it('an ordinary drop after a load_failed recovery still confirms before hiding', () => {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<RecordingHarness provider={provider} states={states} />);

    act(() => provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED }));
    act(() => provider.emit('sync', true)); // back to connected
    act(() => provider.emit('status', { status: 'disconnected' }));
    act(() => provider.emit('sync', true));
    expect(states).toEqual(['load_failed', 'connected', 'reconnecting', 'confirmed']);

    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(states[states.length - 1]).toBe('connected');
  });
});
