import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { initDoc, snapshot } from '../../src/shared/board-model';

/**
 * TC-19, TC-20, TC-21 — connection status badge (sync.client +
 * live.connection_status), driven through the real `connectBoard` state machine
 * with a fake `WebsocketProvider` so socket and sync events are deterministic.
 */

interface FakeProviderInstance {
  readonly destroyed: boolean;
  readonly roomname: string;
  readonly serverUrl: string;
  readonly options: { maxBackoffTime: number; disableBc: boolean };
  emit(event: string, arg: unknown): void;
}

const fake = vi.hoisted(() => {
  const instances: unknown[] = [];
  class FakeWebsocketProvider {
    static instances = instances;
    handlers = new Map<string, Set<(arg: never) => void>>();
    destroyed = false;
    disconnected = false;
    constructor(
      readonly serverUrl: string,
      readonly roomname: string,
      readonly doc: unknown,
      readonly options: { maxBackoffTime: number; disableBc: boolean },
    ) {
      instances.push(this);
    }
    on(event: string, handler: (arg: never) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: (arg: never) => void): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, arg: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        (handler as (a: unknown) => void)(arg);
      }
    }
    disconnect(): void {
      this.disconnected = true;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { instances, provider: FakeWebsocketProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: fake.provider }));

const VALID_ID = 'V1a2b3c4D5e6F7g8h9i0j-';

const provider = (): FakeProviderInstance =>
  fake.instances[fake.instances.length - 1] as FakeProviderInstance;

/** Socket opens, then the doc comes into sync. */
const goOnline = (): void => {
  act(() => provider().emit('status', { status: 'connected' }));
  act(() => provider().emit('sync', true));
};

const dropConnection = (): void => {
  act(() => provider().emit('status', { status: 'disconnected' }));
};

const badge = (): HTMLElement | null => screen.queryByTestId('connection-status');
const badgeText = (): string => badge()?.textContent ?? '';

/** Production wiring on its own: `connectBoard` drives `ConnectionStatus`. */
function Harness(): JSX.Element {
  const doc = useMemo(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  }, []);
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const handle = connectBoard(doc, VALID_ID, setState);
    return () => handle.destroy();
  }, [doc]);
  return <ConnectionStatus state={state} />;
}

beforeEach(() => {
  fake.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('connection state machine (TC-19, TC-20, TC-21)', () => {
  it('TC-19: shows "Connecting…" first and hides once connected', () => {
    render(<Harness />);

    expect(badge()).not.toBeNull();
    expect(badgeText()).toBe('Connecting…');
    expect(badge()?.dataset.state).toBe('connecting');

    goOnline();
    expect(badge()).toBeNull();
  });

  it('TC-20: "Reconnecting…" while down, "Connected" for exactly the confirmation window', () => {
    render(<Harness />);
    goOnline();
    expect(badge()).toBeNull();

    dropConnection();
    expect(badgeText()).toBe('Reconnecting…');
    expect(badge()?.dataset.state).toBe('reconnecting');

    goOnline();
    expect(badgeText()).toBe('Connected');
    expect(badge()?.dataset.state).toBe('confirmed');

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toBe('Connected');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('TC-21: dropping again during the confirmation goes back to "Reconnecting…" immediately', () => {
    render(<Harness />);
    goOnline();
    dropConnection();
    goOnline();
    expect(badgeText()).toBe('Connected');

    dropConnection();
    expect(badgeText()).toBe('Reconnecting…');

    // The expired confirmation must not fire later and hide the badge.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1000);
    });
    expect(badgeText()).toBe('Reconnecting…');
  });

  it('keeps "Connecting…" when the socket drops before the first sync', () => {
    render(<Harness />);
    act(() => provider().emit('status', { status: 'connected' }));
    // Connection lost before ever syncing: still the first-load state.
    dropConnection();
    expect(badgeText()).toBe('Connecting…');
  });

  it('exposes the badge to assistive technology with role="status"', () => {
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('configures the provider for one room per board with the shared backoff', () => {
    render(<Harness />);
    const instance = provider();
    expect(instance.roomname).toBe(VALID_ID);
    expect(instance.serverUrl).toMatch(/\/api\/rooms$/);
    expect(instance.options).toMatchObject({
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    });
  });

  it('detaches the provider when the board unmounts', () => {
    const view = render(<Harness />);
    const instance = provider();
    view.unmount();
    expect(instance.destroyed).toBe(true);
  });
});

describe('the board stays editable while reconnecting (negative: no lockout)', () => {
  it('creates notes with the badge showing "Reconnecting…"', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<BoardApp doc={doc} boardId={VALID_ID} />);

    goOnline();
    dropConnection();
    expect(badgeText()).toBe('Reconnecting…');

    const createButton = screen.getByTestId('create-sticky');
    expect(createButton.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      fireEvent.click(createButton);
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(badgeText()).toBe('Reconnecting…');
  });
});
