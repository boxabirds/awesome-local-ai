import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard } from '../../src/client/sync/connectBoard';
import type { ConnectionState, ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { App } from '../../src/client/App';
import { addNote, newProbe, Harness, notes } from './helpers';

type Status = 'connecting' | 'connected' | 'disconnected';

class FakeProvider implements ProviderLike {
  private statusCbs: ((e: { status: Status }) => void)[] = [];
  private syncCbs: ((s: boolean) => void)[] = [];
  destroyed = false;
  on(event: 'status' | 'sync', cb: never) {
    (event === 'status' ? this.statusCbs : this.syncCbs).push(cb);
  }
  destroy() {
    this.destroyed = true;
  }
  status(status: Status) {
    act(() => this.statusCbs.forEach((cb) => cb({ status })));
  }
  sync(synced: boolean) {
    act(() => this.syncCbs.forEach((cb) => cb(synced)));
  }
  connect() {
    this.status('connected');
    this.sync(true);
  }
  drop() {
    this.sync(false);
    this.status('disconnected');
  }
}

let provider: FakeProvider;

function Probe() {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const conn = connectBoard(new Y.Doc(), 'board', setState, () => (provider = new FakeProvider()));
    return () => conn.destroy();
  }, []);
  return <ConnectionStatus state={state} />;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('connection status badge', () => {
  it('TC-19: shows Connecting… then hides once connected', () => {
    render(<Probe />);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    provider.status('connecting');
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    provider.connect();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20: Reconnecting… then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    render(<Probe />);
    provider.connect();
    provider.drop();
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    provider.status('connecting');
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    provider.connect();
    expect(screen.getByRole('status').textContent).toBe('Connected');
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByRole('status').textContent).toBe('Connected');
    advance(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnecting during the confirmation shows Reconnecting… immediately', () => {
    render(<Probe />);
    provider.connect();
    provider.drop();
    provider.connect();
    expect(screen.getByRole('status').textContent).toBe('Connected');
    provider.drop();
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('stays Connecting… when the first connection attempt fails', () => {
    render(<Probe />);
    provider.status('disconnected');
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('destroys the provider on unmount', () => {
    const { unmount } = render(<Probe />);
    unmount();
    expect(provider.destroyed).toBe(true);
  });

  it('renders the amber/green badge classes', () => {
    const { rerender } = render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByRole('status').className).toContain('reconnecting');
    rerender(<ConnectionStatus state="confirmed" />);
    expect(screen.getByRole('status').className).toContain('confirmed');
  });
});

describe('editing is never locked out', () => {
  it('the board stays editable while the badge shows Connecting…', () => {
    const probe = newProbe();
    render(
      <>
        <ConnectionStatus state="reconnecting" />
        <Harness probe={probe} />
      </>,
    );
    addNote(probe);
    expect(notes()).toHaveLength(1);
  });

  it('App without a board id stays local and fully functional', () => {
    render(<App />);
    expect(screen.queryByText(/Connecting…|Reconnecting…|Connected/)).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Board tools' })).toBeTruthy();
  });
});
