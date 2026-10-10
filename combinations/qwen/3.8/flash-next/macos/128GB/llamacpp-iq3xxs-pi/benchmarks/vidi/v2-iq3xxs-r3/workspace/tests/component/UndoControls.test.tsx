/**
 * TC-18, TC-19, TC-20, TC-21 (story 8, `undo.controls` / `undo.only_own`) — the
 * two buttons, the four shortcuts, and the two ways this history refuses to act:
 * on a board that cannot be written to, and in a field that is not the board.
 *
 * TC-18, TC-19 and TC-21 hand the board a history of their own
 * (`renderStickyBoard({ undo })`) that counts what the board asks it to do, and
 * delegates every one of those calls to a real `createUndo` — a fake that only
 * counted would not notice a step that undid the wrong thing. TC-20 goes the
 * other way and mounts the board session with the real controller, because what
 * it is about is a state (`load_failed`) that is decided by the room, not by a
 * test; there the seam is `y-websocket`, the same seam story 4 cut, and the
 * assertion is that the document was not touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Doc } from 'yjs';
import type { AbstractType, Doc as YDoc } from 'yjs';

import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';
import { SharePanel } from '../../src/client/share/SharePanel';
import {
  COMPONENT_BOARD_ID,
  addNote,
  clickNote,
  dispatchKey,
  readNote,
  readNotes,
  renderBoard,
  renderStickyBoard,
  setCamera,
} from './helpers/board';

/** The `y-websocket` instances the board session created, oldest first. */
const rooms = vi.hoisted(() => ({ providers: [] as unknown[] }));

/**
 * The part of `WebsocketProvider` that `connectBoard` touches — `on`, `destroy`,
 * `ws.close`, `awareness.destroy`, the doc it hands to the room — so the board
 * under test can be told the room closed with 4500. `LoadFailure.test.tsx` keeps
 * a fuller version of this fake, including the backoff story 4 listens to.
 */
vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    doc: YDoc;
    awareness = { destroy(): void {} };
    ws: { close(): void } | null;
    readonly listeners = new Map<string, ((...args: any[]) => void)[]>();

    constructor(_serverUrl: string, _roomname: string, doc: YDoc) {
      this.doc = doc;
      this.ws = { close: () => this.roomClosed(null) };
      rooms.providers.push(this);
      this.emit('status', [{ status: 'connecting' }]);
    }

    on(event: string, listener: (...args: any[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    emit(event: string, args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    /** Socket up, and the two documents exchanged: the board is writable. */
    opensAndSyncs(): void {
      this.emit('status', [{ status: 'connected' }]);
      this.emit('sync', [true]);
    }

    /** The room's last word, in the order the real provider emits it. */
    roomClosed(code: number | null): void {
      this.emit('connection-close', [code === null ? null : { code }, this]);
      this.emit('status', [{ status: 'disconnected' }]);
      this.emit('sync', [false]);
    }

    destroy(): void {
      this.listeners.clear();
      this.ws = null;
    }
  }

  return { WebsocketProvider: FakeWebsocketProvider };
});

interface Room {
  readonly doc: YDoc;
  opensAndSyncs(): void;
  roomClosed(code: number | null): void;
}

function lastRoom(): Room {
  const last = rooms.providers[rooms.providers.length - 1];
  if (!last) throw new Error('the board never opened a connection');
  return last as Room;
}

/* -------------------------------------------------------------------------- *
 * The board, and a history that writes down what it was asked to do.          *
 * -------------------------------------------------------------------------- */

/** A real history, with every call recorded on the way past it. */
function watched(doc: Doc): { controller: UndoController; calls: string[] } {
  const real = createUndo(doc);
  const calls: string[] = [];
  created.push(real);
  const record = (what: 'undo' | 'redo' | 'boundary'): void => {
    calls.push(what);
  };
  return {
    calls,
    controller: {
      undo: () => {
        record('undo');
        return real.undo();
      },
      redo: () => {
        record('redo');
        return real.redo();
      },
      boundary: () => {
        record('boundary');
        real.boundary();
      },
      canUndo: () => real.canUndo(),
      canRedo: () => real.canRedo(),
      // A method, not an arrow: `addScope` is generic, and an arrow would pin `T`
      // to one type the board never asks for.
      addScope: function <T>(type: AbstractType<T>): void {
        real.addScope(type);
      },
      onChange: (callback: () => void) => real.onChange(callback),
      destroy: () => real.destroy(),
    },
  };
}

/** The histories this file owns, so their observers go with the board. */
const created: UndoController[] = [];

function startBoard(): { doc: Doc; calls: string[]; undo: UndoController } {
  const doc = new Doc();
  const board = watched(doc);
  renderStickyBoard(doc, { undo: board.controller });
  act(() => setCamera({ x: 0, y: 0, zoom: 1 }));
  return { doc, calls: board.calls, undo: board.controller };
}

/** The two controls, found the way a keyboard-only person finds them. */
const undoButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

/** Undo and redo only: the boundaries the board brackets its commands with too. */
const steps = (calls: string[]): string[] => calls.filter((call) => call !== 'boundary');

/** Notes on the board, as the screen draws them. */
function drawnNotes(): number {
  return document.querySelectorAll('[data-note-id]').length;
}

/** Counts the document's own changes, so "nothing was written" is one line. */
function watchUpdates(doc: YDoc): { since(): number; reset(): void } {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return {
    since: () => updates,
    reset: () => {
      updates = 0;
    },
  };
}

afterEach(() => {
  cleanup();
  created.length = 0;
  rooms.providers.length = 0;
});

describe('undo and redo in the toolbar (undo.controls)', () => {
  /** TC-18: an empty history says so, in both attributes, and cannot be clicked. */
  it('TC-18 both buttons are disabled with nothing to undo, and say so', () => {
    const { doc, calls, undo } = startBoard();

    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
    // The tooltip carries the shortcut, so the control can be found without one.
    expect(undoButton().getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().getAttribute('title')).toBe('Redo (Ctrl/Cmd+Shift+Z)');

    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(calls).toEqual([]);
    // And asked directly, the same answer: false, not an exception.
    const fresh = createUndo(doc);
    created.push(fresh);
    expect(fresh.undo()).toBe(false);
    expect(fresh.redo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  /**
   * TC-19: the five ways of saying "take it back" and the four of saying
   * "put it back", every one of them reaching the history with the browser's own
   * undo left without a say.
   */
  it('TC-19 Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y all reach the history', () => {
    const { doc, calls } = startBoard();
    const id = addNote(doc, { x: 300, y: 200 });
    clickNote(doc, id);
    dispatchKey({ key: 'Delete' }); // one own step: a note this client deleted
    expect(readNote(doc, id)).toBeUndefined();
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');

    const shortcuts = [
      { label: 'Ctrl+Z', init: { key: 'z', ctrlKey: true }, did: 'undo', back: true },
      { label: 'Ctrl+Y', init: { key: 'y', ctrlKey: true }, did: 'redo', back: false },
      { label: 'Cmd+Z', init: { key: 'z', metaKey: true }, did: 'undo', back: true },
      { label: 'Cmd+Shift+Z', init: { key: 'Z', metaKey: true, shiftKey: true }, did: 'redo', back: false },
      { label: 'Ctrl+Shift+Z', init: { key: 'Z', ctrlKey: true, shiftKey: true }, did: 'redo', back: false },
    ] as const;

    for (const shortcut of shortcuts) {
      const event = dispatchKey({ ...shortcut.init });
      expect(event.defaultPrevented, shortcut.label).toBe(true);
      expect(steps(calls).at(-1), shortcut.label).toBe(shortcut.did);
      expect(readNote(doc, id) === undefined, shortcut.label).toBe(!shortcut.back);
    }

    expect(steps(calls)).toEqual(['undo', 'redo', 'undo', 'redo', 'redo']);
    // The last of them had nothing left to redo: the call happened, and the note
    // is still gone because the redo stack was empty, not because the key was.
    expect(readNote(doc, id)).toBeUndefined();
  });
});

describe('a board that cannot be written to (story 4’s edit lock)', () => {
  /** TC-20: `load_failed` takes the shortcuts away too, and leaves them uncaught. */
  it('TC-20 on a board that could not be loaded the shortcuts are ignored and both buttons are disabled', () => {
    renderBoard();
    const room = lastRoom();
    act(() => room.opensAndSyncs());
    const doc = room.doc;

    // A step made while the board was healthy: history survives the failure.
    fireEvent.click(screen.getByTestId('create-sticky'));
    fireEvent.keyDown(screen.getByTestId('sticky-textarea'), { key: 'Escape' });
    expect(drawnNotes()).toBe(1);
    expect(undoButton().disabled).toBe(false);

    const updates = watchUpdates(doc);
    updates.reset();

    act(() => room.roomClosed(CLOSE_BOARD_LOAD_FAILED));

    // The buttons go dark with the rest of the board, although the history still
    // holds this client's own step: read-only is read-only.
    expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe(
      'load_failed',
    );
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);

    for (const init of [
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
      { key: 'y', ctrlKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
    ]) {
      const event = dispatchKey(init);
      // Not swallowed: the page keeps a key the board will not use.
      expect(event.defaultPrevented).toBe(false);
    }
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());

    expect(readNotes(doc)).toHaveLength(1);
    expect(drawnNotes()).toBe(1);
    expect(updates.since()).toBe(0);
  });
});

describe('typing belongs to its field (undo.controls)', () => {
  /** TC-21: the share link field is not the board, and its Ctrl+Z stays there. */
  it('TC-21 Ctrl+Z in a field that is not the board never reaches the history', () => {
    const { doc, calls } = startBoard();
    const id = addNote(doc, { x: 300, y: 200 });
    clickNote(doc, id);
    dispatchKey({ key: 'Delete' });
    expect(readNote(doc, id)).toBeUndefined();

    // The app's own share panel, with the app's own link field.
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link') as HTMLInputElement;
    act(() => field.focus());
    expect(document.activeElement).toBe(field);

    const event = dispatchKey({ key: 'z', ctrlKey: true }, field);
    expect(event.defaultPrevented).toBe(false);
    expect(steps(calls)).toEqual([]);
    expect(readNote(doc, id)).toBeUndefined(); // the deletion is still standing

    // The same three keys, from the board itself, are taken.
    expect(dispatchKey({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(readNote(doc, id)).toBeDefined();
    expect(steps(calls)).toEqual(['undo']);
  });
});
