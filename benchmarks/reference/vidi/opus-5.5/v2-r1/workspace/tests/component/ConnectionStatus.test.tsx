import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  type ConnectionState,
  type ProviderEvents,
  trackConnectionState,
} from '../../src/client/sync/connectBoard';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { MESSAGE_SYNC } from '../../src/shared/protocol';
import { FakeWebSocket } from './fakeWebSocket';

/** Stands in for WebsocketProvider's `status` / `sync` events. */
class FakeProvider implements ProviderEvents {
  private listeners = new Map<string, Set<(arg: never) => void>>();
  on(event: string, listener: (arg: never) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: (arg: never) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  private emit(event: string, arg: unknown) {
    act(() => {
      for (const l of this.listeners.get(event) ?? []) (l as (a: unknown) => void)(arg);
    });
  }
  /** Socket open and initial sync done (what WebsocketProvider emits). */
  connectAndSync() {
    this.emit('status', { status: 'connecting' });
    this.emit('status', { status: 'connected' });
    this.emit('sync', true);
  }
  drop() {
    this.emit('sync', false);
    this.emit('status', { status: 'disconnected' });
    this.emit('status', { status: 'connecting' });
  }
  failAttempt() {
    this.emit('status', { status: 'connecting' });
  }
}

function Harness(props: { provider: FakeProvider; states?: ConnectionState[] }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      trackConnectionState(props.provider, (s) => {
        props.states?.push(s);
        setState(s);
      }),
    [props.provider, props.states],
  );
  return <ConnectionStatus state={state} />;
}

// The zoom label (<output>) also has the status role, so find the badge by its class.
afterEach(cleanup);

const badge = () => {
  const el = document.querySelector<HTMLElement>('.connection-status');
  if (el) expect(el.getAttribute('role')).toBe('status');
  return el;
};

describe('sync.client connection status badge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('TC-19 shows "Connecting…" on first load, then hides once connected', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    expect(badge()).toHaveProperty('textContent', 'Connecting…');
    provider.failAttempt();
    expect(badge()).toHaveProperty('textContent', 'Connecting…');
    provider.connectAndSync();
    expect(badge()).toBeNull();
  });

  it('TC-20 shows "Reconnecting…", then "Connected" for exactly CONNECTED_CONFIRMATION_MS', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} states={states} />);
    provider.connectAndSync();
    provider.drop();
    expect(badge()).toHaveProperty('textContent', 'Reconnecting…');
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
    provider.failAttempt();
    expect(badge()).toHaveProperty('textContent', 'Reconnecting…');

    provider.connectAndSync();
    expect(badge()).toHaveProperty('textContent', 'Connected');
    expect(badge()?.getAttribute('data-state')).toBe('confirmed');
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(badge()).toHaveProperty('textContent', 'Connected');
    act(() => vi.advanceTimersByTime(1));
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'confirmed', 'connected']);
  });

  it('TC-21 a new disconnect during the confirmation shows "Reconnecting…" immediately', () => {
    const provider = new FakeProvider();
    render(<Harness provider={provider} />);
    provider.connectAndSync();
    provider.drop();
    provider.connectAndSync();
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS / 2));
    provider.drop();
    expect(badge()).toHaveProperty('textContent', 'Reconnecting…');
    // The stale confirmation timer must not hide the badge.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS));
    expect(badge()).toHaveProperty('textContent', 'Reconnecting…');
  });

  it('renders nothing while connected and a status role otherwise', () => {
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
    for (const [state, text] of [
      ['connecting', 'Connecting…'],
      ['reconnecting', 'Reconnecting…'],
      ['confirmed', 'Connected'],
    ] as const) {
      rerender(<ConnectionStatus state={state} />);
      expect(badge()?.textContent).toBe(text);
    }
  });
});

describe('sync.client keeps the board editable in every connection state', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates notes while connecting, connected and reconnecting; connects to /api/rooms/:boardId', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    const { unmount } = render(<App boardId={boardId} doc={doc} />);
    const create = () => fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    expect(badge()).toHaveProperty('textContent', 'Connecting…');
    const ws = FakeWebSocket.latest();
    expect(ws.url).toBe(`ws://${window.location.host}/api/rooms/${boardId}`);
    create();
    expect(snapshot(doc)).toHaveLength(1);

    ws.openAndSync();
    expect(badge()).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    create();
    expect(snapshot(doc)).toHaveLength(2);
    // Local edits are sent to the room.
    expect(ws.sent.some((f) => f[0] === MESSAGE_SYNC && f[1] === syncProtocol.messageYjsUpdate)).toBe(true);

    ws.serverClose();
    expect(badge()).toHaveProperty('textContent', 'Reconnecting…');
    create();
    expect(snapshot(doc)).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy();

    unmount();
  });
});
