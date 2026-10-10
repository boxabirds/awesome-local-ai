import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import {
  connectBoard,
  type BoardConnection,
  type BoardProvider,
  type ConnectionState,
  type ProviderStatus,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { COMPONENT_BOARD_ID, flushFrame, renderBoard } from './harness';

/**
 * TC-19 to TC-21 (anchor `sync.client`, requirement `live.status`).
 *
 * The room is replaced by a fake provider that replays only the events
 * `y-websocket` really emits (`status` and `sync`), and timers are fake, so the
 * status mapping and the badge are tested exactly - including the
 * CONNECTED_CONFIRMATION_MS boundary.
 */

/** Replays provider events on demand. */
class FakeProvider implements BoardProvider {
  private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  destroyed = false;

  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  on(
    name: 'status' | 'sync',
    handler: ((event: { status: ProviderStatus }) => void) | ((synced: boolean) => void),
  ): void {
    if (name === 'status') {
      this.statusHandlers.push(handler as (event: { status: ProviderStatus }) => void);
    } else {
      this.syncHandlers.push(handler as (synced: boolean) => void);
    }
  }

  status(status: ProviderStatus): void {
    for (const handler of this.statusHandlers) {
      handler({ status });
    }
  }

  sync(synced: boolean): void {
    for (const handler of this.syncHandlers) {
      handler(synced);
    }
  }

  /** The sequence a real provider produces when it reaches the room and syncs. */
  open(): void {
    this.status('connecting');
    this.status('connected');
    this.sync(true);
  }

  /** The sequence a real provider produces when the link drops. */
  drop(): void {
    this.sync(false);
    this.status('disconnected');
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** The most recent render, so a test can unmount it. */
let lastRender: { unmount(): void } = { unmount: () => undefined };

const statusElement = (): HTMLElement => screen.getByTestId('connection-status');
const statusText = (): string => statusElement().textContent ?? '';
const mappedState = (): string => statusElement().dataset.connectionState ?? '';

/**
 * The badge driven by a real `connectBoard` against a fake provider. The
 * recorded `states` array is the mapping itself, in order.
 */
function renderStatus(provider: FakeProvider) {
  const doc = new Y.Doc();
  const states: ConnectionState[] = [];
  const connections: BoardConnection[] = [];

  function BadgeDriver() {
    const [state, setState] = useState<ConnectionState>('connecting');
    useEffect(() => {
      const connection = connectBoard(doc, COMPONENT_BOARD_ID, {
        provider: () => provider,
        onState: (next) => {
          states.push(next);
          setState(next);
        },
      });
      connections.push(connection);
      return () => {
        connection.destroy();
      };
    }, [doc]);
    return <ConnectionStatus state={state} />;
  }

  const view = render(<BadgeDriver />);
  lastRender = view;
  return { states, connections, view };
}

/** Drive the fake provider with the UI reacting to every event. */
const drive = (events: (() => void)[]): void => {
  act(() => {
    for (const event of events) {
      event();
    }
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connection status badge (live.status)', () => {
  it('TC-19: "Connecting…" while first loading, hidden once the room has answered', () => {
    const provider = new FakeProvider();
    const { states } = renderStatus(provider);

    // Nothing has happened yet: the board is loading.
    expect(statusText()).toBe('Connecting…');
    expect(mappedState()).toBe('connecting');
    expect(statusElement().getAttribute('role')).toBe('status');
    expect(statusElement().getAttribute('aria-live')).toBe('polite');

    drive([() => provider.status('connecting'), () => provider.status('connected')]);
    // A socket that is open is not yet a board that is live: the room has not
    // answered, so the line still says "Connecting…".
    expect(statusText()).toBe('Connecting…');
    expect(states).toEqual([]);

    drive([() => provider.sync(true)]);
    expect(mappedState()).toBe('connected');
    expect(statusText()).toBe('');
    expect(states).toEqual(['connected']);
  });

  it('TC-20: "Reconnecting…" while the link is down, "Connected" for exactly CONNECTED_CONFIRMATION_MS after it returns', () => {
    const provider = new FakeProvider();
    const { states } = renderStatus(provider);
    drive([() => provider.open()]);
    expect(mappedState()).toBe('connected');

    drive([() => provider.drop()]);
    expect(mappedState()).toBe('reconnecting');
    expect(statusText()).toBe('Reconnecting…');

    drive([() => provider.status('connecting'), () => provider.status('connected')]);
    // Still reconnecting until the room has answered again.
    expect(statusText()).toBe('Reconnecting…');

    drive([() => provider.sync(true)]);
    expect(mappedState()).toBe('confirmed');
    expect(statusText()).toBe('Connected');

    // Boundary: visible one millisecond before the confirmation ends ...
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(statusText()).toBe('Connected');

    // ... and hidden at exactly CONNECTED_CONFIRMATION_MS.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(statusText()).toBe('');
    expect(mappedState()).toBe('connected');

    expect(states).toEqual(['connected', 'reconnecting', 'confirmed', 'connected']);
  });

  it('TC-21: a second loss during the confirmation shows "Reconnecting…" immediately', () => {
    const provider = new FakeProvider();
    const { states } = renderStatus(provider);
    drive([() => provider.open(), () => provider.drop(), () => provider.open()]);
    expect(statusText()).toBe('Connected');

    drive([() => provider.drop()]);
    expect(statusText()).toBe('Reconnecting…');

    // The abandoned confirmation must not fire later and hide the badge.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1_000);
    });
    expect(statusText()).toBe('Reconnecting…');
    expect(mappedState()).toBe('reconnecting');
    expect(states.at(-1)).toBe('reconnecting');
  });

  it('leaving the board destroys the connection, so no retry is left running', () => {
    const provider = new FakeProvider();
    const { connections } = renderStatus(provider);
    drive([() => provider.open()]);
    expect(connections).toHaveLength(1);

    const view = lastRender;
    act(() => {
      view.unmount();
    });
    expect(provider.destroyed).toBe(true);
  });

  it('the board stays fully editable while reconnecting (negative: no lockout)', async () => {
    // Real timers here: this test drives the whole board, whose camera render
    // is scheduled with requestAnimationFrame.
    vi.useRealTimers();
    const provider = new FakeProvider();
    const doc = new Y.Doc();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();

    drive([() => provider.open(), () => provider.drop()]);
    expect(statusText()).toBe('Reconnecting…');

    // Editing is not blocked, dimmed, or covered while the link is down.
    const create = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await flushFrame();

    // The edit went into the local document and would be sent on reconnect.
    expect(snapshot(doc)).toHaveLength(1);

    drive([() => provider.open()]);
    expect(statusText()).toBe('Connected');
  });
});
