/**
 * The board that cannot be loaded, and what the screen does about it
 * (`persist.client_readonly`, `persist.badge`).
 *
 * The room is replaced by the same stand-in the story 3 badge tests use, so the
 * app can be told "this board could not be read" without a server that has lost a
 * snapshot. What is asserted is the difference story 4 is about: a connection that
 * is down leaves the board editable, a board that cannot be read does not.
 *
 * Specs: spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/
 * design.md, sections persist.badge and persist.client_readonly (TC-22, TC-23,
 * TC-28).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type * as Y from 'yjs';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import {
  createConnectionStateTracker,
  useConnectionState,
  type ConnectionState,
  type ConnectionStateTracker,
} from '../../src/client/sync/connectBoard';
import {
  ConnectionStatus,
  LOAD_FAILED_COLOR,
  RECONNECTING_COLOR,
} from '../../src/client/sync/ConnectionStatus';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { newBoardId } from '../../src/shared/board-id';
import { App } from '../../src/client/App';
import { ResizeObserverStub } from './setup';
import { dispatchPointer, VIEWPORT } from './helpers/events';
import { FakeWebsocketProvider } from './helpers/fake-provider';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const LOAD_FAILED_TEXT = 'Board could not be loaded \u2014 waiting to retry';
const RECONNECTING_TEXT = 'Reconnecting\u2026';

/** jsdom normalises a CSS colour to `rgb(…)`, so compare in that form. */
const rgb = (hex: string): string => {
  const digits = hex.replace('#', '');
  const part = (index: number): number => parseInt(digits.slice(index, index + 2), 16);
  return `rgb(${part(0)}, ${part(2)}, ${part(4)})`;
};

const settle = (): void => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.size = { ...VIEWPORT };
  FakeWebsocketProvider.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const badge = (): HTMLElement | null => screen.queryByTestId('connection-status');
const badgeText = (): string | null => badge()?.textContent ?? null;

/** Provider events, delivered the way a socket callback delivers them. */
const feed = (what: () => void): void => {
  act(() => {
    what();
  });
  settle();
};

// --- the state machine, without a screen in the way ---------------------------

/** Run the tracker by hand and keep every state it reports, repeats folded. */
const statesSeen = (script: (sink: ConnectionStateTracker) => void): ConnectionState[] => {
  const seen: ConnectionState[] = [];
  const tracker = createConnectionStateTracker((state) => {
    if (seen[seen.length - 1] !== state) seen.push(state);
  });
  script(tracker);
  tracker.destroy();
  return seen;
};

describe('the close code decides what the screen believes (TC-28)', () => {
  // TC-28, first half: a board that could not be read, and what it takes to stop
  // saying so.
  it('holds load_failed through connection events and leaves it only for the board itself (TC-28)', () => {
    const seen = statesSeen((sink) => {
      sink.status('connecting');
      sink.synced(false);
      sink.status('connected');
      sink.synced(true);
      // The room could not read the board.
      sink.loadFailed();
      // The provider does what it always does afterwards: retries. None of this
      // may turn the red message into anything friendlier, because none of it is
      // about the board.
      sink.status('connecting');
      sink.status('connected');
      sink.synced(false);
      sink.status('disconnected');
      // Until the board is actually in front of the person again.
      sink.synced(true);
    });

    expect(seen).toEqual([
      'connecting',
      'connected',
      'load_failed',
      'connected',
    ]);
    // No green confirmation in there: a board that was unavailable and then
    // arrived is not a recovery to celebrate.
    expect(seen).not.toContain('confirmed');
  });

  // TC-28, second half: every other code is still only about the connection.
  it('leaves a close with any other code saying Reconnecting, nothing more (TC-28)', () => {
    let sink: ConnectionStateTracker | null = null;
    function Watching(): ReactNode {
      const register = useCallback((incoming: ConnectionStateTracker): (() => void) => {
        sink = incoming;
        return () => {
          sink = null;
        };
      }, []);
      const state = useConnectionState(register);
      return <ConnectionStatus state={state} />;
    }
    render(<Watching />);
    feed(() => sink?.status('connecting'));
    feed(() => sink?.synced(true));
    expect(badge()).toBeNull();

    // The room closed the connection because *it* could not save: that is a
    // connection failure, the board is still there and still editable.
    feed(() => {
      sink?.status('disconnected');
      sink?.synced(false);
    });
    expect(badgeText()).toBe(RECONNECTING_TEXT);
    expect(badge()?.style.color).toBe(rgb(RECONNECTING_COLOR));
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
  });
});

// --- the badge itself --------------------------------------------------------

describe('the badge says the board could not be loaded (TC-23)', () => {
  // TC-23
  it('renders the failure in red and keeps it there while the connection retries (TC-23)', () => {
    let sink: ConnectionStateTracker | null = null;
    function Watching(): ReactNode {
      const register = useCallback((incoming: ConnectionStateTracker): (() => void) => {
        sink = incoming;
        return () => {
          sink = null;
        };
      }, []);
      const state = useConnectionState(register);
      return <ConnectionStatus state={state} />;
    }
    render(<Watching />);
    feed(() => {
      sink?.status('connecting');
      sink?.synced(true);
    });

    feed(() => sink?.loadFailed());
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    expect(badge()?.style.color).toBe(rgb(LOAD_FAILED_COLOR));
    expect(badge()?.getAttribute('role')).toBe('status');
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');

    // The socket opens again and even reports itself connected. The message stays:
    // it was never about the socket.
    feed(() => sink?.status('connecting'));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    feed(() => sink?.status('connected'));
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);

    // The board arrives. That is the only thing that was ever going to change it.
    feed(() => sink?.synced(true));
    expect(badge()).toBeNull();
  });

  // The states the badge can show, counted from one run: the new one is in the
  // set and the old ones are all still there.
  it('has the same states as before plus one, and no others', () => {
    const seen: Array<ConnectionState | null> = [];
    let sink: ConnectionStateTracker | null = null;
    function Watching(): ReactNode {
      const register = useCallback((incoming: ConnectionStateTracker): (() => void) => {
        sink = incoming;
        return () => {
          sink = null;
        };
      }, []);
      const state = useConnectionState(register);
      seen.push(state);
      return <ConnectionStatus state={state} />;
    }
    render(<Watching />);
    feed(() => {
      sink?.status('connecting');
      sink?.synced(true);
    });
    feed(() => {
      sink?.status('disconnected');
      sink?.synced(false);
    });
    feed(() => sink?.synced(true));
    feed(() => sink?.loadFailed());
    feed(() => sink?.synced(true));

    expect(new Set(seen)).toEqual(
      new Set(['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed']),
    );
  });
});

// --- the board while it cannot be loaded -------------------------------------

const markSynced = (): void => {
  feed(() => FakeWebsocketProvider.last().markSynced());
};

const markBoardUnreadable = (): void => {
  feed(() => FakeWebsocketProvider.last().markRoomClosed(CLOSE_BOARD_LOAD_FAILED));
};

const noteElements = (): HTMLElement[] => screen.queryAllByTestId('sticky-note');

const createButton = (): HTMLButtonElement =>
  screen.getByTestId('create-sticky') as HTMLButtonElement;

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

/** A drag: press in the middle of `el`, move, let go. */
function drag(el: HTMLElement, dx: number, dy: number): void {
  const box = el.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  dispatchPointer(el, 'pointerdown', x, y);
  dispatchPointer(el, 'pointermove', x + dx * 0.5, y + dy * 0.5);
  dispatchPointer(el, 'pointermove', x + dx, y + dy);
  dispatchPointer(el, 'pointerup', x + dx, y + dy);
  flush();
}

describe('the board while it cannot be loaded', () => {
  let boardId = '';

  beforeEach(() => {
    boardId = newBoardId();
    window.history.replaceState(null, '', `/b/${boardId}`);
  });

  // TC-22
  it('shows the notes and lets nothing be changed (TC-22)', () => {
    render(<App />);
    markSynced();
    createNote(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2);
    expect(noteElements()).toHaveLength(1);
    // Out of the editor the note was created into, so this starts from a board
    // that is merely there.
    fireEvent.keyDown(screen.getByTestId('sticky-note-text'), { key: 'Escape' });
    flush();
    const note = noteElements()[0] as HTMLElement;
    const where = { left: note.style.left, top: note.style.top };
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');

    markBoardUnreadable();
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);

    // The board is still there: what was read is still on the screen.
    expect(noteElements()).toHaveLength(1);

    // The tool that makes notes is off, and double-clicking the board with it
    // makes nothing.
    expect(createButton().disabled).toBe(true);
    createNote(VIEWPORT.width / 2 - 200, VIEWPORT.height / 2 - 100);
    expect(noteElements()).toHaveLength(1);

    // The note cannot be moved.
    drag(note, 90, 60);
    expect(noteElements()[0]!.style.left).toBe(where.left);
    expect(noteElements()[0]!.style.top).toBe(where.top);

    // The note cannot be typed in: no editor opens on it.
    fireEvent.doubleClick(note, { clientX: 0, clientY: 0 });
    flush();
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');

    // And the keyboard paths into an edit are closed too.
    fireEvent.keyDown(window.document.body, { key: 'Enter' });
    fireEvent.keyDown(window.document.body, { key: 'Delete' });
    flush();
    expect(noteElements()).toHaveLength(1);
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');
  });

  it('gives the board back the moment it can be read again', () => {
    render(<App />);
    markSynced();
    createNote(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2);
    markBoardUnreadable();
    expect(createButton().disabled).toBe(true);

    // The board comes back on its own — the room retried the load and this time
    // could read it. Nothing was reloaded in the browser.
    markSynced();
    expect(badge()).toBeNull();
    expect(createButton().disabled).toBe(false);

    createNote(VIEWPORT.width / 2 - 200, VIEWPORT.height / 2);
    expect(noteElements()).toHaveLength(2);
  });

  it('closes an editor that was open when the board went out of reach', () => {
    render(<App />);
    markSynced();
    createNote(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2);
    // This screen is mid-edit on the note: a textarea is open inside it.
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('TEXTAREA');

    markBoardUnreadable();
    flush();

    // The typing has nowhere to go, so the editor is closed rather than left
    // taking typing into a document nothing saves.
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');
  });

  it('draws the notes it could not load a board for with their text', () => {
    render(<App />);
    markSynced();
    createNote(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2);
    // What the other person sees is a note with this text on it, written the way
    // anything else in the document is written.
    const doc = FakeWebsocketProvider.last().doc as Y.Doc;
    const id = snapshot(doc)[0]!.id;
    getStickyText(doc, id)?.insert(0, 'written before the board went away');
    flush();
    fireEvent.keyDown(screen.getByTestId('sticky-note-text'), { key: 'Escape' });
    flush();

    markBoardUnreadable();
    expect(noteElements()).toHaveLength(1);
    expect(screen.getByTestId('sticky-note-text').tagName).toBe('DIV');
    expect(screen.getByTestId('sticky-note-text').textContent).toBe(
      'written before the board went away',
    );
  });

  // The other room failure is a connection failure, and the board does not go
  // read-only for it: PRD persist.storage_fail says the board stays usable.
  it('stays editable when the room could not save, only saying Reconnecting', () => {
    render(<App />);
    markSynced();
    feed(() =>
      FakeWebsocketProvider.last().markRoomClosed(CLOSE_STORAGE_FAILURE),
    );
    expect(badgeText()).toBe(RECONNECTING_TEXT);
    expect(createButton().disabled).toBe(false);

    createNote(VIEWPORT.width / 2 + 200, VIEWPORT.height / 2);
    expect(noteElements()).toHaveLength(1);
  });
});
