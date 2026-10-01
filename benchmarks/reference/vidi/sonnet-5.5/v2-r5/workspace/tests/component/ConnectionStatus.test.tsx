import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky } from '../../src/shared/board-model';
import { Harness, newDoc } from './helpers';

class FakeProvider implements ProviderLike {
  private status: Array<(e: { status: 'connecting' | 'connected' | 'disconnected' }) => void> = [];
  private sync: Array<(s: boolean) => void> = [];
  destroyed = false;
  on(event: string, cb: never): void {
    if (event === 'status') this.status.push(cb);
    else this.sync.push(cb);
  }
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
