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
  closeCbs: ((e: { code: number } | null) => void)[] = [];
  destroyed = false;
  on(event: 'status' | 'sync' | 'connection-close', cb: never) {
    if (event === 'status') this.statusCbs.push(cb);
    else if (event === 'sync') this.syncCbs.push(cb);
    else this.closeCbs.push(cb);
  }
  close(code: number) {
    this.closeCbs.forEach((cb) => cb({ code }));
    this.status('disconnected'); // y-websocket reports the disconnect after the close event
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

  it('TC-22: load_failed shows the red message with role=status', () => {
    cleanup();
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByRole('status');
    expect(el.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(el.style.background).toBe('rgb(211, 47, 47)');
  });

  it('TC-28: close 4500 → load_failed and stays through retries; sync recovers to connected', () => {
    run(() => p.close(4500));
    expect(screen.getByRole('status').textContent).toBe("This board couldn't be loaded. Retrying…");
    run(() => p.close(4500));
    expect(screen.getByRole('status').textContent).toBe("This board couldn't be loaded. Retrying…");
    connect();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-28: close 1011 and 1003 → Reconnecting…, never the load failure message', () => {
    connect();
    run(() => p.close(1011));
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    connect();
    run(() => p.close(1003));
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

