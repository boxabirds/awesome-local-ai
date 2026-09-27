/**
 * tests/component/ConnectionStatus.test.tsx
 *
 * The badge and the small state machine in front of it (TC-19 to TC-21).
 *
 * A fake `WebsocketProvider` stands in for the socket: the interesting part is
 * what the board says to the person when the network does certain things, and
 * the only honest way to test that is to emit the events a network would emit —
 * including the moment a reconnection is confirmed, which is a timer and nothing
 * else. Timers are fake, so the confirmation boundary is tested exactly at
 * CONNECTED_CONFIRMATION_MS - 1 and at CONNECTED_CONFIRMATION_MS.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

/**
 * The provider y-websocket gives us, replaced with something a test can drive.
 * It records the options it was constructed with, because what the board passes
 * there (no BroadcastChannel, a capped backoff) is part of the behaviour the
 * tests claim.
 */
const { FakeProvider } = vi.hoisted(() => {
  class FakeProvider {
    static instances: FakeProvider[] = [];

    readonly emitted: string[] = [];

    destroyed = false;

    readonly handlers = new Map<string, ((event: never) => void)[]>();

    readonly url: string;

    readonly room: string;

    readonly options: Record<string, unknown>;

    constructor(url: string, room: string, _doc: unknown, options: Record<string, unknown>) {
      this.url = url;
      this.room = room;
      this.options = options;
      FakeProvider.instances.push(this);
    }

    on(name: string, handler: (event: never) => void): void {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }

    off(name: string, handler: (event: never) => void): void {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter((seen) => seen !== handler));
    }

    destroy(): void {
      this.destroyed = true;
    }

    /** Send an event the way the library would, and remember it was sent. */
    emit(name: 'status' | 'sync', event: unknown): void {
      this.emitted.push(name);
      for (const handler of this.handlers.get(name) ?? []) {
        (handler as (event: unknown) => void)(event);
      }
    }
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }));

/** What a test needs from the fake: `vi.hoisted` hides the class itself. */
interface ProviderHandle {
  readonly url: string;
  readonly room: string;
  readonly options: Record<string, unknown>;
  destroyed: boolean;
  emit(name: 'status' | 'sync', event: unknown): void;
}

const { connectBoard } = await import('../../src/client/sync/connectBoard');
const { ConnectionStatus } = await import('../../src/client/sync/ConnectionStatus');

/** The app's own wiring, kept to the part under test: connect, hold the state, show it. */
function BoardBadge() {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const connection = connectBoard(new Y.Doc(), 'board-under-test', setState);
    return () => connection.destroy();
  }, []);
  return <ConnectionStatus state={state} />;
}

/** Render the badge and hand back its provider, so a test can play network at it. */
function renderBadge() {
  render(<BoardBadge />);
  const provider = FakeProvider.instances[FakeProvider.instances.length - 1] as ProviderHandle;
  return {
    provider,
    /** The badge's text, or `null` when there is no badge on screen. */
    badge: (): string | null => screen.queryByTestId('connection-status')?.textContent ?? null,
    state: (): string | null =>
      screen.queryByTestId('connection-status')?.getAttribute('data-state') ?? null,
    online: (): void => {
      act(() => {
        provider.emit('status', { status: 'connected' });
        provider.emit('sync', true);
      });
    },
    drop: (): void => {
      act(() => {
        provider.emit('status', { status: 'disconnected' });
      });
    },
  };
}

beforeEach(() => {
  FakeProvider.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the connection badge', () => {
  it('TC-19: says Connecting… until the board has been synced, then says nothing', () => {
    const badge = renderBadge();

    // Before anything comes back from the room.
    expect(badge.badge()).toBe('Connecting…');

    // The socket is up but the board has not been exchanged yet: still waiting.
    act(() => {
      badge.provider.emit('status', { status: 'connected' });
    });
    expect(badge.badge()).toBe('Connecting…');

    // State exchanged: nothing to report, so nothing on screen.
    badge.online();
    expect(badge.badge()).toBeNull();

    // And it is the state machine that decides, not the badge's own idea: the
    // badge only ever renders what it is told.
    // The room lives on the origin the page was served from, under the ws scheme.
    expect(badge.provider.url).toBe(
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/rooms`,
    );
    expect(badge.provider.room).toBe('board-under-test');
    // Two tabs of one browser have to reach each other through the room, not
    // around it, or the tests would pass with a broken server.
    expect(badge.provider.options.disableBc).toBe(true);
    expect(badge.provider.options.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('TC-20: shows Reconnecting… during an outage, Connected when it is back, and hides after the confirmation', () => {
    const badge = renderBadge();
    badge.online();
    expect(badge.badge()).toBeNull();

    badge.drop();
    expect(badge.badge()).toBe('Reconnecting…');
    expect(badge.state()).toBe('reconnecting');

    // Back, and the board is synced again.
    badge.online();
    expect(badge.badge()).toBe('Connected');
    expect(badge.state()).toBe('confirmed');

    // The confirmation is held for a moment, and that moment is exact.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge.badge()).toBe('Connected');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge.badge()).toBeNull();
  });

  it('TC-21: an outage during the confirmation shows Reconnecting… at once and stays showing it', () => {
    const badge = renderBadge();
    badge.online();
    badge.drop();
    badge.online();
    expect(badge.badge()).toBe('Connected');

    // The network goes again while the green badge is still up.
    badge.drop();
    expect(badge.badge()).toBe('Reconnecting…');

    // The confirmation timer that is still pending must not clear the badge: it
    // belongs to a connection that no longer exists.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 10);
    });
    expect(badge.badge()).toBe('Reconnecting…');

    // A genuine recovery does clear it.
    badge.online();
    expect(badge.badge()).toBe('Connected');
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });
    expect(badge.badge()).toBeNull();
  });
});
