import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';

// A fake provider: connectBoard is the unit under test and the badge renders
// from the state it reports, so the transport is replaced by a hand-driven
// event emitter (spec: fake timers + fake provider event emitter).
interface FakeProvider {
  url: string;
  room: string;
  options: { maxBackoffTime?: number; disableBc?: boolean };
  synced: boolean;
  wsconnected: boolean;
  destroyed: boolean;
  emit(event: string, arg?: unknown): void;
}

const providers: FakeProvider[] = [];

vi.mock('y-websocket', () => {
  class Fake {
    url: string;
    room: string;
    options: { maxBackoffTime?: number; disableBc?: boolean };
    synced = false;
    wsconnected = false;
    destroyed = false;
    private handlers = new Map<string, Set<(arg?: unknown) => void>>();

    constructor(url: string, room: string, _doc: unknown, options: { maxBackoffTime?: number; disableBc?: boolean }) {
      this.url = url;
      this.room = room;
      this.options = options;
      providers.push(this as unknown as FakeProvider);
    }

    on(event: string, handler: (arg?: unknown) => void): void {
      let handlers = this.handlers.get(event);
      if (handlers === undefined) {
        handlers = new Set();
        this.handlers.set(event, handlers);
      }
      handlers.add(handler);
    }

    off(event: string, handler: (arg?: unknown) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, arg?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(arg);
    }

    destroy(): void {
      this.destroyed = true;
    }
  }
  return { WebsocketProvider: Fake };
});

import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

function Badge({ boardId }: { boardId: string }): JSX.Element {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [doc] = useState(() => new Y.Doc());
  useEffect(() => {
    const handle = connectBoard(doc, boardId, setState);
    return () => handle.destroy();
  }, [doc, boardId]);
  return <ConnectionStatus state={state} />;
}

function latest(): FakeProvider {
  const provider = providers[providers.length - 1];
  if (provider === undefined) throw new Error('no provider created');
  return provider;
}

beforeEach(() => {
  vi.useFakeTimers();
  providers.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('TC-19 connecting then first sync shows "Connecting…" and then hides the badge', () => {
  render(<Badge boardId="board-aaa" />);
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('Connecting…');
  const provider = latest();
  expect(provider.url).toBe('ws://localhost:3000/api/rooms');
  expect(provider.room).toBe('board-aaa');
  expect(provider.options.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);
  expect(provider.options.disableBc).toBe(true);
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.queryByRole('status')).toBeNull();
});

test('TC-20 an outage shows Reconnecting, the recovery shows Connected until the confirmation window ends', () => {
  render(<Badge boardId="board-bbb" />);
  const provider = latest();
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.queryByRole('status')).toBeNull();
  act(() => {
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('status', { status: 'disconnected' });
  });
  const badge = screen.getByRole('status');
  expect(badge.textContent).toContain('Reconnecting…');
  // The board is never locked out: nothing the badge renders can eat input.
  expect(badge.style.pointerEvents).toBe('none');
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.getByRole('status').textContent).toContain('Connected');
  act(() => {
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
  });
  expect(screen.getByRole('status').textContent).toContain('Connected');
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole('status')).toBeNull();
});

test('TC-21 dropping again during the confirmation window shows Reconnecting immediately', () => {
  render(<Badge boardId="board-ccc" />);
  const provider = latest();
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('status', { status: 'disconnected' });
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.getByRole('status').textContent).toContain('Connected');
  act(() => {
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('status', { status: 'disconnected' });
  });
  expect(screen.getByRole('status').textContent).toContain('Reconnecting…');
  act(() => {
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1);
  });
  // The abandoned confirmation timer must not hide the live Reconnecting badge.
  expect(screen.getByRole('status').textContent).toContain('Reconnecting…');
});

test('unmounting the board destroys the provider', () => {
  const view = render(<Badge boardId="board-ddd" />);
  const provider = latest();
  expect(provider.destroyed).toBe(false);
  view.unmount();
  expect(provider.destroyed).toBe(true);
});

test('an edit control under the badge stays clickable while reconnecting', () => {
  render(
    <>
      <Badge boardId="board-eee" />
      <button onClick={() => undefined}>Create sticky</button>
    </>
  );
  const provider = latest();
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('status', { status: 'disconnected' });
  });
  expect(screen.getByRole('status').textContent).toContain('Reconnecting…');
  const button = screen.getByRole('button', { name: 'Create sticky' });
  let clicked = false;
  button.addEventListener('click', () => {
    clicked = true;
  });
  fireEvent.click(button);
  expect(clicked).toBe(true);
});

test('TC-22 close 4500 shows the red load-failed badge and a later sync returns to normal', () => {
  render(<Badge boardId="board-fff" />);
  const provider = latest();
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.queryByRole('status')).toBeNull();
  act(() => {
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    provider.emit('status', { status: 'disconnected' });
  });
  const badge = screen.getByRole('status');
  expect(badge.textContent).toContain("This board couldn't be loaded. Retrying…");
  expect(badge.getAttribute('data-state')).toBe('load_failed');
  expect(badge.style.color).toBe('rgb(220, 38, 38)');
  // The provider keeps retrying; the first successful sync re-enables the
  // board without a reload.
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  expect(screen.queryByRole('status')).toBeNull();
});

test('TC-28 close 1011 then 1003 show Reconnecting, never load-failed, and editing stays enabled', () => {
  render(
    <>
      <Badge boardId="board-ggg" />
      <button onClick={() => undefined}>Create sticky</button>
    </>
  );
  const provider = latest();
  act(() => {
    provider.wsconnected = true;
    provider.synced = true;
    provider.emit('status', { status: 'connected' });
    provider.emit('sync', true);
  });
  act(() => {
    provider.wsconnected = false;
    provider.synced = false;
    provider.emit('connection-close', { code: CLOSE_STORAGE_FAILURE });
    provider.emit('status', { status: 'disconnected' });
  });
  expect(screen.getByRole('status').getAttribute('data-state')).toBe('reconnecting');
  act(() => {
    provider.emit('connection-close', { code: 1003 });
    provider.emit('status', { status: 'disconnected' });
  });
  const badge = screen.getByRole('status');
  expect(badge.getAttribute('data-state')).toBe('reconnecting');
  expect(badge.textContent).toContain('Reconnecting…');
  expect((screen.getByRole('button', { name: 'Create sticky' }) as HTMLButtonElement).disabled).toBe(false);
});
