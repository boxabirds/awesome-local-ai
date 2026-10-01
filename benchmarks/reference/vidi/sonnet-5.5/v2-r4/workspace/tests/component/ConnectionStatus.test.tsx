import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

type Status = 'connecting' | 'connected' | 'disconnected';

class FakeProvider implements ProviderLike {
  statusCbs: ((e: { status: Status }) => void)[] = [];
  syncCbs: ((s: boolean) => void)[] = [];
  destroyed = false;
  on(event: 'status' | 'sync', cb: never) {
    if (event === 'status') this.statusCbs.push(cb);
    else this.syncCbs.push(cb);
  }
  status(status: Status) {
    this.statusCbs.forEach((cb) => cb({ status }));
  }
  sync(s = true) {
    this.syncCbs.forEach((cb) => cb(s));
  }
  destroy() {
    this.destroyed = true;
  }
}

function Harness({ provider }: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const c = connectBoard(new Y.Doc(), 'board', setState, () => provider);
    return () => c.destroy();
  }, [provider]);
  return <ConnectionStatus state={state} />;
}

let p: FakeProvider;
beforeEach(() => {
  vi.useFakeTimers();
  p = new FakeProvider();
  render(<Harness provider={p} />);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const run = (fn: () => void) => act(fn);
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const connect = () => run(() => (p.status('connected'), p.sync(true)));
const drop = () => run(() => p.status('disconnected'));

describe('connection status badge', () => {
  it('TC-19: Connecting… then hidden', () => {
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    run(() => p.status('connecting'));
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    connect();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('first-load failures keep showing Connecting…, not Reconnecting…', () => {
    drop();
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('TC-20: Reconnecting… → Connected for exactly CONNECTED_CONFIRMATION_MS → hidden', () => {
    connect();
    drop();
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    connect();
    expect(screen.getByRole('status').textContent).toBe('Connected');
    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(screen.getByRole('status').textContent).toBe('Connected');
    advance(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: dropping again during confirmation shows Reconnecting… immediately', () => {
    connect();
    drop();
    connect();
    advance(500);
    drop();
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('destroy() destroys the provider', () => {
    cleanup();
    expect(p.destroyed).toBe(true);
  });

  it('never locks out editing: the badge ignores pointer input in every state', () => {
    for (const state of ['connecting', 'reconnecting', 'confirmed'] as const) {
      const { unmount } = render(<ConnectionStatus state={state} />);
      for (const el of screen.getAllByRole('status')) expect(el.style.pointerEvents).toBe('none');
      unmount();
    }
  });
});

