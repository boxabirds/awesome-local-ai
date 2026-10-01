import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky } from '../../src/shared/board-model';
import { canEdit } from '../../src/client/App';
import { Harness, newDoc } from './helpers';

class FakeProvider implements ProviderLike {
  private status: Array<(e: { status: 'connecting' | 'connected' | 'disconnected' }) => void> = [];
  private sync: Array<(s: boolean) => void> = [];
  private close: Array<(e: { code: number } | null) => void> = [];
  destroyed = false;
  on(event: string, cb: never): void {
    if (event === 'status') this.status.push(cb);
    else if (event === 'connection-close') this.close.push(cb);
    else this.sync.push(cb);
  }
  /** What y-websocket does when a socket closes: connection-close, then status disconnected. */
  emitClose(code: number) { this.close.forEach((f) => f({ code })); this.emitStatus('disconnected'); }
  emitStatus(status: 'connecting' | 'connected' | 'disconnected') { this.status.forEach((f) => f({ status })); }
  emitSync(synced: boolean) { this.sync.forEach((f) => f(synced)); }
  connect() { this.emitStatus('connected'); this.emitSync(true); }
  destroy() { this.destroyed = true; }
}

function Probe({ provider }: { provider: FakeProvider }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  // connectBoard is wired once; the fake provider is driven by the test.
  useState(() => connectBoard(new Y.Doc(), 'b', setState, () => provider));
  return <ConnectionStatus state={state} />;
}

describe('ConnectionStatus (sync.client)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('TC-19 Connecting… then hidden once connected', () => {
    const p = new FakeProvider();
    render(<Probe provider={p} />);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    act(() => p.connect());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-20 Reconnecting… then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    const p = new FakeProvider();
    render(<Probe provider={p} />);
    act(() => p.connect());
    act(() => p.emitStatus('disconnected'));
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => p.connect());
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1); });
    expect(screen.getByRole('status').textContent).toBe('Connected');
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21 disconnecting during confirmation shows Reconnecting… immediately', () => {
    const p = new FakeProvider();
    render(<Probe provider={p} />);
    act(() => p.connect());
    act(() => p.emitStatus('disconnected'));
    act(() => p.connect());
    act(() => { vi.advanceTimersByTime(500); });
    act(() => p.emitStatus('disconnected'));
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS * 2); });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…'); // stale timer must not hide it
  });

  it('a failed first connection stays Connecting…', () => {
    const p = new FakeProvider();
    render(<Probe provider={p} />);
    act(() => p.emitStatus('disconnected'));
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('TC-28 close 1011 and 1003 show Reconnecting… (not load_failed) and keep editing enabled', () => {
    for (const code of [1011, 1003]) {
      const p = new FakeProvider();
      const states: ConnectionState[] = [];
      connectBoard(new Y.Doc(), 'b', (st) => states.push(st), () => p);
      p.connect();
      p.emitClose(code);
      expect(states.at(-1)).toBe('reconnecting');
      expect(states).not.toContain('load_failed');
      expect(canEdit(states.at(-1)!)).toBe(true);
    }
  });

  it('TC-28 close 4500 → load_failed; a later sync → connected with editing enabled again', () => {
    const p = new FakeProvider();
    const states: ConnectionState[] = [];
    connectBoard(new Y.Doc(), 'b', (st) => states.push(st), () => p);
    p.emitStatus('connected');
    p.emitClose(4500);
    expect(states.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);
    p.emitClose(4500); // another failed retry keeps the message
    expect(states.at(-1)).toBe('load_failed');
    p.connect();
    expect(states.at(-1)).toBe('connected');
    expect(canEdit(states.at(-1)!)).toBe(true);
  });

  it('TC-22 load_failed renders the red message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('connection-load_failed');
  });

  it('destroy tears the provider down', () => {
    const p = new FakeProvider();
    const conn = connectBoard(new Y.Doc(), 'b', () => {}, () => p);
    conn.destroy();
    expect(p.destroyed).toBe(true);
  });

  it('badge has role=status and the board stays editable while reconnecting', () => {
    const doc = newDoc();
    render(
      <>
        <ConnectionStatus state="reconnecting" />
        <Harness doc={doc} />
      </>,
    );
    expect(screen.getByRole('status').textContent).toBe('Reconnecting…');
    act(() => { createSticky(doc, { x: 0, y: 0 }); });
    expect(screen.getAllByRole('group', { name: 'Sticky note' })).toHaveLength(1);
  });
});
