import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { BoardApp } from '../../src/client/App';
import { initDoc } from '../../src/shared/board-model';

type Status = 'connecting' | 'connected' | 'disconnected';

class FakeProvider implements ProviderLike {
  private status: ((e: { status: Status }) => void)[] = [];
  private sync: ((s: boolean) => void)[] = [];
  private close: ((e: { code: number } | null) => void)[] = [];
  destroyed = false;
  on(event: 'status' | 'sync' | 'connection-close', cb: never): void {
    (event === 'status' ? this.status : event === 'sync' ? this.sync : this.close).push(cb);
  }
  emitStatus(status: Status) { this.status.forEach((cb) => cb({ status })); }
  emitSync(s: boolean) { this.sync.forEach((cb) => cb(s)); }
  emitClose(code: number) { this.close.forEach((cb) => cb({ code })); }
  destroy() { this.destroyed = true; }
}

function Harness({ provider }: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [conn] = useState(() => connectBoard(new Y.Doc(), 'b', setState, () => provider));
  void conn;
  return <ConnectionStatus state={state} />;
}

describe('ConnectionStatus', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    return provider;
  };
  const connect = (p: FakeProvider) => act(() => { p.emitStatus('connected'); p.emitSync(true); });
  const drop = (p: FakeProvider) => act(() => { p.emitSync(false); p.emitStatus('disconnected'); });

  it('TC-19: shows "Connecting…" first, then hides when connected', () => {
    const p = setup();
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    connect(p);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-19b: failing to connect the first time stays on "Connecting…"', () => {
    const p = setup();
    act(() => p.emitStatus('disconnected'));
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('TC-20: outage shows Reconnecting…, then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    const p = setup();
    connect(p);
    drop(p);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    connect(p);
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1); });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21: disconnecting during the confirmation shows Reconnecting… immediately', () => {
    const p = setup();
    connect(p);
    drop(p);
    connect(p);
    act(() => { vi.advanceTimersByTime(500); });
    drop(p);
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
  });

  it('destroy() destroys the provider and stops reporting', () => {
    const provider = new FakeProvider();
    const seen: ConnectionState[] = [];
    const c = connectBoard(new Y.Doc(), 'b', (s) => seen.push(s), () => provider);
    c.destroy();
    provider.emitStatus('connected');
    provider.emitSync(true);
    expect(provider.destroyed).toBe(true);
    expect(seen).toEqual(['connecting']);
  });

  it('the badge has role=status and the board stays editable while reconnecting', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp board={{ doc, notes: [], connection: 'reconnecting' }} />);
    expect(screen.getByTestId('connection-status').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting…');
    const add = screen.getAllByRole('button').find((b) => /sticky|note/i.test(b.getAttribute('aria-label') ?? ''));
    expect(add).toBeTruthy();
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });
});
