/**
 * The connection badge and the state mapping behind it (`sync.client`).
 *
 * The badge is tested through the seam `connectBoard` uses: the provider's
 * `status`/`sync` events are fed by hand, with fake timers, so the confirmation
 * window is exact (design: "Timers in badge component test — fake timers").
 * The board half of these tests swaps `y-websocket` for a fake so the app can
 * be put into any connection state without a network: what is asserted is that
 * the board keeps working in all of them.
 *
 * Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
 * design.md, section "Client connection and status" (TC-19 to TC-21).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type * as Y from 'yjs';
import {
  useConnectionState,
  type ConnectionState,
  type ConnectionStateTracker,
} from '../../src/client/sync/connectBoard';
import {
  ConnectionStatus,
  CONNECTED_COLOR,
  RECONNECTING_COLOR,
} from '../../src/client/sync/ConnectionStatus';
import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { App } from '../../src/client/App';
import { ResizeObserverStub } from './setup';
import { dispatchPointer, VIEWPORT } from './helpers/events';

const CONNECTING_TEXT = 'Connecting\u2026';
const RECONNECTING_TEXT = 'Reconnecting\u2026';
const CONNECTED_TEXT = 'Connected';

/** jsdom normalises a CSS colour to `rgb(…)`, so compare in that form. */
const rgb = (hex: string): string => {
  const digits = hex.replace('#', '');
  const part = (index: number): number => parseInt(digits.slice(index, index + 2), 16);
  return `rgb(${part(0)}, ${part(2)}, ${part(4)})`;
};

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

/**
 * Let React apply what it was told, without spending any of the confirmation
 * window: the badge tests need the fake clock to stay where they put it.
 */
const settle = (): void => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.size = { ...VIEWPORT };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A badge driven by hand: the same `useConnectionState` the app uses, with the
 * provider's events fed into the state machine it was handed.
 */
let sink: ConnectionStateTracker | null = null;

function BadgeUnderTest(): ReactNode {
  const register = useCallback((incoming: ConnectionStateTracker): (() => void) => {
    sink = incoming;
    return () => {
      sink = null;
    };
  }, []);
  const state = useConnectionState(register);
  return <ConnectionStatus state={state} />;
}

const badge = (): HTMLElement | null => screen.queryByTestId('connection-status');
const badgeText = (): string | null => badge()?.textContent ?? null;

/** Feed the provider events of a connection that opens and syncs. */
const openAndSync = (): void => {
  act(() => {
    sink?.status('connecting');
    sink?.synced(false);
    sink?.status('connected');
    sink?.synced(true);
  });
  settle();
};

/** The provider events of a connection that drops, then one that comes back. */
const drop = (): void => {
  act(() => {
    sink?.status('disconnected');
    sink?.synced(false);
  });
  settle();
};

const comeBack = (): void => {
  act(() => {
    sink?.status('connecting');
    sink?.status('connected');
    sink?.synced(true);
  });
  settle();
};

describe('the connection badge (sync.client)', () => {
  // TC-19
  it('says it is connecting and then says nothing at all (TC-19)', () => {
    render(<BadgeUnderTest />);

    expect(badgeText()).toBe(CONNECTING_TEXT);
    expect(badge()?.getAttribute('role')).toBe('status');

    openAndSync();
    expect(badge()).toBeNull();
  });

  // TC-20: the confirmation window is exactly CONNECTED_CONFIRMATION_MS.
  it('shows the green confirmation after a drop and hides it after the confirmation time (TC-20)', () => {
    render(<BadgeUnderTest />);
    openAndSync();

    drop();
    expect(badgeText()).toBe(RECONNECTING_TEXT);
    expect(badge()?.style.color).toBe(rgb(RECONNECTING_COLOR));

    comeBack();
    expect(badgeText()).toBe(CONNECTED_TEXT);
    expect(badge()?.style.color).toBe(rgb(CONNECTED_COLOR));

    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText(), 'one millisecond before the end').toBe(CONNECTED_TEXT);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge(), 'exactly at the end').toBeNull();
  });

  // TC-21
  it('goes straight back to reconnecting when the connection drops again during the confirmation (TC-21)', () => {
    render(<BadgeUnderTest />);
    openAndSync();
    drop();
    comeBack();
    expect(badgeText()).toBe(CONNECTED_TEXT);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    drop();
    expect(badgeText()).toBe(RECONNECTING_TEXT);

    // The green only comes back after a sync that holds for the whole window.
    comeBack();
    expect(badgeText()).toBe(CONNECTED_TEXT);
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badgeText()).toBe(CONNECTED_TEXT);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('never shows a state the mapping does not have, and never hides the board', () => {
    const seen: Array<ConnectionState | null> = [];
    function Watching(): ReactNode {
      const register = useCallback((incoming: ConnectionStateTracker): (() => void) => {
        sink = incoming;
        return () => {
          sink = null;
        };
      }, []);
      const state = useConnectionState(register);
      seen.push(state);
      return (
        <>
          <ConnectionStatus state={state} />
          <output data-testid="board-is-here">board</output>
        </>
      );
    }

    render(<Watching />);
    openAndSync();
    drop();
    comeBack();
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    });

    expect(new Set(seen)).toEqual(new Set(['connecting', 'connected', 'reconnecting', 'confirmed']));
    expect(screen.getByTestId('board-is-here').textContent).toBe('board');
  });
});

// --- the board while the connection is not fine -------------------------------

/**
 * A provider that does not touch the network, so the app can be put into any
 * connection state on purpose. Only the events `connectBoard` listens to are
 * implemented, plus what it passes in the options and reads back.
 */
const fake = vi.hoisted(() => {
  class FakeWebsocketProvider {
    static instances: FakeWebsocketProvider[] = [];
    static last(): FakeWebsocketProvider {
      const last = FakeWebsocketProvider.instances[FakeWebsocketProvider.instances.length - 1];
      if (!last) throw new Error('the app connected to no room');
      return last;
    }
    static reset(): void {
      FakeWebsocketProvider.instances = [];
    }

    readonly handlers = new Map<string, Set<(...args: never[]) => void>>();
    readonly serverUrl: string;
    readonly roomName: string;
    readonly doc: unknown;
    readonly options: Record<string, unknown>;
    destroyed = false;
    connected = false;

    constructor(
      serverUrl: string,
      roomName: string,
      doc: unknown,
      options: Record<string, unknown>,
    ) {
      this.serverUrl = serverUrl;
      this.roomName = roomName;
      this.doc = doc;
      this.options = options;
      FakeWebsocketProvider.instances.push(this);
    }

    on(event: string, handler: (...args: never[]) => void): void {
      const existing = this.handlers.get(event) ?? new Set();
      this.handlers.set(event, existing);
      existing.add(handler);
    }

    off(event: string, handler: (...args: never[]) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, ...args: never[]): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
    }

    /** The socket opened and the board is in sync. */
    markSynced(): void {
      this.connected = true;
      this.emit('status', { status: 'connected' } as never);
      this.emit('sync', true as never);
    }

    /** The socket dropped; edits stay in the document. */
    markDropped(): void {
      this.connected = false;
      this.emit('status', { status: 'disconnected' } as never);
      this.emit('sync', false as never);
    }

    destroy(): void {
      this.destroyed = true;
    }
  }
  return { FakeWebsocketProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: fake.FakeWebsocketProvider }));

/**
 * Provider events reach React from a socket callback, so they are delivered
 * inside `act`: the state they cause has to be applied before the assertion
 * that follows, not on a later task.
 */
const markSynced = (): void => {
  act(() => {
    fake.FakeWebsocketProvider.last().markSynced();
  });
};

const markDropped = (): void => {
  act(() => {
    fake.FakeWebsocketProvider.last().markDropped();
  });
};

const noteElements = (): HTMLElement[] => screen.queryAllByTestId('sticky-note');

/** A real double-click on empty board space, which creates a note there. */
function createNote(x: number, y: number): void {
  const viewport = screen.getByTestId('board-viewport');
  dispatchPointer(viewport, 'pointerdown', x, y);
  dispatchPointer(viewport, 'pointerup', x, y);
  dispatchPointer(viewport, 'pointerdown', x, y);
  dispatchPointer(viewport, 'pointerup', x, y);
  fireEvent.dblClick(viewport, { clientX: x, clientY: y });
  flush();
}

describe('the board while the connection is not fine', () => {
  let boardId = '';

  beforeEach(() => {
    fake.FakeWebsocketProvider.reset();
    boardId = newBoardId();
    window.history.replaceState(null, '', `/b/${boardId}`);
  });

  afterEach(() => {
    cleanup();
  });

  it('connects to this board through the room route, with the settings it was given', () => {
    render(<App />);
    const provider = fake.FakeWebsocketProvider.last();

    expect(provider.serverUrl).toBe('ws://localhost:3000/api/rooms');
    expect(provider.roomName).toBe(boardId);
    expect(provider.options.disableBc).toBe(true);
    expect(provider.options.maxBackoffTime).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('is fully editable while it says Reconnecting (TC-21, negative: no lockout)', () => {
    render(<App />);
    markSynced();
    expect(badge(), 'a board that is in sync shows no badge').toBeNull();

    markDropped();
    expect(badgeText()).toBe(RECONNECTING_TEXT);

    // Nothing about the board is disabled while the connection is down: a note
    // is created and recoloured as usual, and the edits stay in the document.
    createNote(VIEWPORT.width / 2, VIEWPORT.height / 2);
    expect(noteElements()).toHaveLength(1);
    const note = noteElements()[0] as HTMLElement;
    fireEvent.keyDown(screen.getByTestId('sticky-note-text'), { key: 'Escape' });
    flush();

    // The toolbar's own controls are reachable and enabled too.
    const swatch = screen.getByTestId('swatch-blue') as HTMLButtonElement;
    const bin = screen.getByTestId('delete-note') as HTMLButtonElement;
    expect(swatch.disabled).toBe(false);
    expect(bin.disabled).toBe(false);
    fireEvent.click(swatch);
    flush();
    expect(note.dataset.color).toBe('blue');

    // Still reconnecting, and the badge never got in the way of a click.
    expect(badgeText()).toBe(RECONNECTING_TEXT);
    expect(screen.getByTestId('board-viewport').style.pointerEvents).not.toBe('none');
  });

  it('stops talking to the room when the board goes away', () => {
    const { unmount } = render(<App />);
    const provider = fake.FakeWebsocketProvider.last();
    act(() => {
      provider.markSynced();
    });

    unmount();
    expect(provider.destroyed).toBe(true);
  });

  it('stands in for the members of the real provider that the client uses', async () => {
    // The fake above is only a stand-in while it implements what `connectBoard`
    // actually calls on a provider. Checked against the real module, which is
    // read here but never constructed, so nothing connects.
    const actual = await vi.importActual<{ WebsocketProvider: new (...args: never[]) => unknown }>(
      'y-websocket',
    );
    const real = actual.WebsocketProvider.prototype as Record<string, unknown>;
    const standIn = fake.FakeWebsocketProvider.prototype as unknown as Record<string, unknown>;

    for (const member of ['on', 'off', 'destroy', 'connect', 'disconnect']) {
      expect(typeof real[member], `the real provider has ${member}()`).toBe('function');
    }
    for (const member of ['on', 'off', 'destroy']) {
      expect(typeof standIn[member], `the stand-in has ${member}()`).toBe('function');
    }
  });

  it('keeps selection and editing off the shared document', () => {
    render(<App />);
    const provider = fake.FakeWebsocketProvider.last();
    act(() => {
      provider.markSynced();
    });

    createNote(300, 300);
    const note = noteElements()[0] as HTMLElement;
    expect(note.dataset.selected).toBe('true');
    // This screen is mid-edit on it: a textarea is open inside the note.
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('TEXTAREA');

    // What the other person would receive is the note and its content, and
    // nothing about this screen's selection (`live.local_selection`).
    const fields = [
      ...(provider.doc as unknown as Y.Doc).getMap<Y.Map<unknown>>('objects').values(),
    ].flatMap((object) => [...object.keys()]);
    expect(fields).toContain('text');
    expect(fields).not.toContain('selected');
    expect(fields).not.toContain('selection');
    expect(fields).not.toContain('editing');
  });
});
