/**
 * Story 4's client half, in jsdom: what a board does when the room cannot load it
 * (TC-22, TC-23, TC-28).
 *
 * The app is rendered for real - the real `WebsocketProvider`, the real y-protocols handshake,
 * a real `Y.Doc`, the real board model - with only the wire scripted, so a close code from the
 * room travels the same path it takes in a browser. `FakeSocket` stands in for the network,
 * fake timers stand in for the reconnect backoff, and every "nothing happened" is measured at
 * the document rather than at the screen: the claim is that no change is made to the board, and
 * the document is where that is either true or not.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { canEdit, type ConnectionState } from '../../src/client/sync/connectBoard';
import {
  LOCAL_ORIGIN,
  createSticky,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { FakeSocket, fakeWebSocket } from './fakeSocket';
import { dispatchKey, dispatchWheel, getCamera, renderBoard, runFrames } from './helpers';

/** The exact sentence the person sees, worded in `ConnectionStatus`. */
const LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";

/** A room with one note in it, so a synced tab really holds a board. */
function roomDoc(): Y.Doc {
  const room = new Y.Doc();
  initDoc(room);
  createSticky(room, { x: 0, y: 0 }, 'yellow');
  return room;
}

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

/**
 * Counts the changes this screen makes, straight at the document.
 *
 * `LOCAL_ORIGIN` is what the board model passes to `doc.transact`, so this counts exactly the
 * writes the interface can cause - and nothing that arrives from the room.
 */
function watchLocalWrites(target: Y.Doc): { readonly count: number } {
  const seen = { count: 0 };
  target.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) seen.count += 1;
  });
  return seen;
}

const badge = () => screen.getByRole('status');
/**
 * The badge inside a rendered app: `role="status"` is also how the navigation hint is announced,
 * so this looks for the badge itself - the same hook the end-to-end tests use.
 */
const badgeInBoard = () => document.querySelector<HTMLElement>('.connection-status');
const badgeText = () => badgeInBoard()?.textContent ?? null;
const noteElement = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`note ${id} is not rendered`);
  return element;
};
const viewport = () => screen.getByTestId('board-viewport');

const pointer = (clientX: number, clientY: number) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
});

/**
 * Runs the whole board with a scripted wire.
 *
 * `renderBoard` builds the real app; `globalThis.WebSocket` is swapped for the scripted socket
 * first so the app's own provider dials the script rather than a server that is not there.
 */
function renderBoardWithScriptedWire(): void {
  vi.stubGlobal('WebSocket', fakeWebSocket);
  renderBoard();
}

/** The wire goes up and the room answers the handshake. */
function openAndSync(room: Y.Doc): void {
  if (FakeSocket.latest.readyState === FakeSocket.CLOSED) nextAttempt();
  act(() => {
    FakeSocket.latest.open();
    FakeSocket.latest.syncWith(room);
  });
}

/** Waits out the provider's backoff until it starts the next connection attempt. */
function nextAttempt(): FakeSocket {
  const before = FakeSocket.attempts;
  act(() => {
    vi.advanceTimersByTime(RECONNECT_MAX_BACKOFF_MS);
  });
  expect(FakeSocket.attempts).toBeGreaterThan(before);
  return FakeSocket.latest;
}

/**
 * Every way this interface can change a board, tried in turn, with the board checked after each
 * one. Saying which attempt broke the lock matters: "something was written" is a bad message to
 * be left with when five things were tried.
 */
async function tryToChangeTheBoard(noteId: string): Promise<void> {
  const board = doc();
  const writes = watchLocalWrites(board);
  const before = plain(snapshot(board));

  const step = async (name: string, action: () => void): Promise<void> => {
    const written = writes.count;
    action();
    await runFrames();
    expect(writes.count, `${name} wrote to the board`).toBe(written);
    expect(plain(snapshot(board)), `${name} changed the notes`).toEqual(before);
  };

  await step('double-click on empty board', () => {
    fireEvent.doubleClick(viewport(), { clientX: 600, clientY: 500 });
  });

  const createButton = screen.getByTestId('create-sticky-button');
  await step('the Sticky note button', () => {
    fireEvent.click(createButton);
  });

  await step('selecting the note and pressing Delete', () => {
    fireEvent.pointerDown(noteElement(noteId), pointer(300, 300));
    fireEvent.pointerUp(noteElement(noteId), pointer(300, 300));
    dispatchKey(window, { key: 'Delete' });
  });

  await step('dragging the note', () => {
    fireEvent.pointerDown(noteElement(noteId), pointer(300, 300));
    fireEvent.pointerMove(noteElement(noteId), pointer(420, 380));
    fireEvent.pointerUp(noteElement(noteId), pointer(420, 380));
  });

  await step('double-clicking the note and typing', () => {
    fireEvent.doubleClick(noteElement(noteId), { clientX: 300, clientY: 300 });
    // with no editor open these keystrokes land on the page, which is the whole point of the check
    dispatchKey(document.body, { key: 'x' });
  });
}

/** `describe` the notes the way a diff between two boards needs. */
function plain(notes: readonly StickySnapshot[]): unknown {
  return notes.map((note) => [note.id, note.x, note.y, note.color, note.text, note.z]);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});

afterEach(() => {
  // any reconnect timer still queued belongs to this test and dies with it
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the board says it could not be loaded (TC-22)', () => {
  test('TC-22 the badge names the problem and the retry, as a status, in red', () => {
    render(<ConnectionStatus state="load_failed" />);

    const element = badge();
    expect(element).toHaveTextContent(LOAD_FAILED_MESSAGE);
    expect(element).toHaveAttribute('data-state', 'load_failed');
    expect(element).toHaveAttribute('role', 'status');
    // never a dialog: the board behind it stays visible and readable
    expect(element).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('TC-22b red is the stylesheet’s answer for this state, and only this state', () => {
    // jsdom does not apply the stylesheet, so "in red" is checked where it is decided: the rule
    // that styles this state. A deleted or greyed-out rule would silently turn an error message
    // into just another badge. (Read from disk, relative to the repository root that `vitest` runs
    // in; an import of a stylesheet would be stubbed out in a test run.)
    const css = readFileSync('src/client/styles.css', 'utf8');
    const ruleFor = (state: ConnectionState): string => {
      const rule = new RegExp(`\\.connection-status--${state}\\s*\\{([^}]*)\\}`).exec(css);
      if (!rule) throw new Error(`styles.css has no rule for .connection-status--${state}`);
      return rule[1] ?? '';
    };

    const hex = /color:\s*#([0-9a-f]{6})\b/i.exec(ruleFor('load_failed'))?.[1];
    if (!hex) throw new Error('the load-failure rule sets no hex colour');
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    expect(red).toBeGreaterThan(120);
    expect(red).toBeGreaterThan(green + 40);
    expect(red).toBeGreaterThan(blue + 40);

    // and it is not the amber of a dropped link: two different problems, two different colours
    expect(ruleFor('load_failed')).not.toBe(ruleFor('reconnecting'));
  });

  test('TC-22c only a load failure locks the board', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed'];
    expect(canEdit('load_failed')).toBe(false);
    for (const state of states) expect(canEdit(state)).toBe(true);
  });
});

describe('a board that could not be loaded is read-only (TC-23)', () => {
  test('TC-23 every way to change the board is closed, and every way to look at it is open', async () => {
    const room = roomDoc();
    renderBoardWithScriptedWire();
    openAndSync(room);
    expect(badgeInBoard()).toBeNull();

    const board = doc();
    const writes = watchLocalWrites(board);
    const before = plain(snapshot(board));
    const noteId = snapshot(board).at(0)?.id;
    if (!noteId) throw new Error('the synced board has no note to try to change');

    // the room reports the board unreadable and hangs up
    act(() => {
      FakeSocket.latest.close(CLOSE_BOARD_LOAD_FAILED, 'the board could not be loaded');
    });
    expect(badgeText()).toBe(LOAD_FAILED_MESSAGE);
    expect(badgeInBoard()).toHaveAttribute('data-state', 'load_failed');

    await tryToChangeTheBoard(noteId);

    expect(plain(snapshot(board))).toEqual(before);
    expect(writes.count).toBe(0);
    // the note toolbar is present when selected, and every tool in it is switched off
    const toolbar = within(noteElement(noteId)).getByTestId('note-toolbar');
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(within(toolbar).getByLabelText(`${name} colour`)).toBeDisabled();
    }
    expect(within(toolbar).getByLabelText('Delete note')).toBeDisabled();
    expect(screen.getByTestId('create-sticky-button')).toBeDisabled();
    // and no editor opened anywhere
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();

    // negative control, and the point of the design: read-only is not frozen. The camera is the
    // person's own, so navigating a board that is being retried still works.
    const cameraBefore = getCamera();
    dispatchWheel(viewport(), { deltaY: 200 });
    await runFrames();
    expect(getCamera()).not.toEqual(cameraBefore);
    expect(writes.count).toBe(0); // navigation is still not a change to the board
  });
});

describe('what a closed connection means (TC-28)', () => {
  test('TC-28 only "the board could not be loaded" locks the board; every other code is an outage', async () => {
    const room = roomDoc();
    renderBoardWithScriptedWire();
    openAndSync(room);

    // A close code belongs to one connection, so each of these is its own attempt - which is also
    // what the tab goes through: the room answers one socket, hangs up, and the next one says
    // something else.

    // 1011: the room could not store something. This tab's board is still a copy of the real one,
    // and its unsaved changes go out again when the connection returns.
    act(() => {
      FakeSocket.latest.close(CLOSE_STORAGE_FAILURE, 'the board could not be stored');
    });
    expect(badgeText()).toBe('Reconnecting…');
    expect(screen.getByTestId('create-sticky-button')).toBeEnabled();
    fireEvent.doubleClick(viewport(), { clientX: 500, clientY: 400 });
    await runFrames();
    expect(snapshot(doc())).toHaveLength(2); // editing went on working

    // 1003: this tab sent something the room could not read. Same story: the board is fine.
    act(() => {
      nextAttempt().close(1003, 'frame could not be decoded');
    });
    expect(badgeText()).toBe('Reconnecting…');
    expect(screen.getByTestId('create-sticky-button')).toBeEnabled();

    // a network drop: a socket with no code from the room at all
    act(() => {
      nextAttempt().close(1006, 'no answer');
    });
    expect(badgeText()).toBe('Reconnecting…');
    expect(screen.getByTestId('create-sticky-button')).toBeEnabled();

    // 4500 is the one that says the board itself is the problem
    act(() => {
      nextAttempt().close(CLOSE_BOARD_LOAD_FAILED, 'the board could not be loaded');
    });
    expect(badgeText()).toBe(LOAD_FAILED_MESSAGE);
    expect(screen.getByTestId('create-sticky-button')).toBeDisabled();
  });

  test('TC-28b the room is really retrying, and the first sync back unlocks the board with no reload', async () => {
    const room = roomDoc();
    renderBoardWithScriptedWire();
    openAndSync(room);

    act(() => {
      FakeSocket.latest.close(CLOSE_BOARD_LOAD_FAILED, 'the board could not be loaded');
    });
    expect(badgeText()).toBe(LOAD_FAILED_MESSAGE);

    // "Retrying…" has to be true: the close code 4500 is outside the range y-websocket treats as
    // terminal, so the provider keeps dialling.
    const attempts = FakeSocket.attempts;
    nextAttempt();
    expect(FakeSocket.attempts).toBeGreaterThan(attempts);

    // an attempt that fails is still a load failure, not a return
    const socket = FakeSocket.latest;
    act(() => {
      socket.open();
      socket.close(CLOSE_BOARD_LOAD_FAILED, 'still broken');
    });
    expect(badgeText()).toBe(LOAD_FAILED_MESSAGE);

    // the change made while locked out was never written, so the board has not diverged
    expect(snapshot(doc())).toHaveLength(1);

    // and then the room reads the board. Editing comes back by itself: no reload, no dialog.
    openAndSync(room);
    expect(badgeInBoard()).toBeNull();
    expect(screen.getByTestId('create-sticky-button')).toBeEnabled();

    const writes = watchLocalWrites(doc());
    fireEvent.doubleClick(viewport(), { clientX: 700, clientY: 500 });
    await runFrames();
    expect(snapshot(doc())).toHaveLength(2);
    expect(writes.count).toBe(1);
  });
});
