import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
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
 * TC-19 to TC-21, TC-22, TC-28 (anchor `sync.client`, requirements `live.status`
 * and `persist.client_status`).
 *
 * The room is replaced by a fake provider that replays only the events
 * `y-websocket` really emits (`status`, `sync` and `connection-close`), and
 * timers are fake, so the status mapping and the badge are tested exactly -
 * including the CONNECTED_CONFIRMATION_MS boundary and the close codes.
 */

/** Replays provider events on demand. */
class FakeProvider implements BoardProvider {
  private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  private closeHandlers: ((event: { code: number } | null) => void)[] = [];
  destroyed = false;

  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  on(name: 'connection-close', handler: (event: { code: number } | null) => void): void;
  on(
    name: 'status' | 'sync' | 'connection-close',
    handler:
      | ((event: { status: ProviderStatus }) => void)
      | ((synced: boolean) => void)
      | ((event: { code: number } | null) => void),
  ): void {
    if (name === 'status') {
      this.statusHandlers.push(handler as (event: { status: ProviderStatus }) => void);
    } else if (name === 'sync') {
      this.syncHandlers.push(handler as (synced: boolean) => void);
    } else {
      this.closeHandlers.push(handler as (event: { code: number } | null) => void);
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

  /**
   * A close the room sent, with the code it used. `y-websocket` reports the
   * `CloseEvent` for a server close and `null` for one we asked for.
   */
  closeWith(code: number): void {
    for (const handler of this.closeHandlers) {
      handler({ code });
    }
  }

  /** A close caused by our own disconnect or by the watchdog. */
  closeByUs(): void {
    for (const handler of this.closeHandlers) {
      handler(null);
    }
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

  it('TC-22: a board the room could not load is named in red, with role status', () => {
    // Rendered straight from the state, the way the connection drives it.
    const view = render(<ConnectionStatus state="load_failed" />);
    const element = screen.getByTestId('connection-status');
    expect(element.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(element.getAttribute('role')).toBe('status');
    expect(element.getAttribute('aria-live')).toBe('polite');
    expect(element.dataset.connectionState).toBe('load_failed');
    // "danger" is the tone styles.css paints in red.
    expect(element.dataset.tone).toBe('danger');
    expect(element.className).toContain('connection-status--load_failed');
    view.unmount();

    // And reached through the real mapping: a 4500 close from the room.
    const provider = new FakeProvider();
    const { states } = renderStatus(provider);
    drive([() => provider.open()]);
    expect(mappedState()).toBe('connected');

    drive([() => provider.closeWith(CLOSE_BOARD_LOAD_FAILED)]);
    expect(mappedState()).toBe('load_failed');
    expect(statusText()).toBe("This board couldn't be loaded. Retrying…");
    expect(states).toEqual(['connected', 'load_failed']);
  });

  it('TC-28: a storage failure or a rejected frame is "Reconnecting…", never a load failure', async () => {
    vi.useRealTimers();
    const provider = new FakeProvider();
    const doc = new Y.Doc();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();

    drive([() => provider.open()]);
    expect(mappedState()).toBe('connected');

    // 1011: the room could not save, so it dropped everyone.
    drive([() => provider.closeWith(CLOSE_STORAGE_FAILURE)]);
    expect(mappedState()).toBe('reconnecting');
    expect(statusText()).toBe('Reconnecting…');
    expect(screen.getByTestId('connection-status').dataset.tone).toBe('warning');

    // Editing stays open: the board is still the board.
    const create = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await flushFrame();
    expect(snapshot(doc)).toHaveLength(1);

    // 1003: a frame this client sent was rejected. Still only a link problem.
    drive([() => provider.closeWith(CLOSE_UNSUPPORTED_DATA)]);
    expect(mappedState()).toBe('reconnecting');
    expect(statusText()).toBe('Reconnecting…');

    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrame();
    expect(snapshot(doc)).toHaveLength(2);

    expect(mainElement().dataset.boardEditable).toBe('true');
  });
});

/** The board's editability, which only `load_failed` takes away. */
function mainElement(): HTMLElement {
  return screen.getByTestId('app');
}
