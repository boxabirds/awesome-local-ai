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
