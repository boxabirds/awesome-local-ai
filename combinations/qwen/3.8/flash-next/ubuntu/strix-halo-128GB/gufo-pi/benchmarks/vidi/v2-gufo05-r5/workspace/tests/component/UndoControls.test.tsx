/**
 * Story 8, `undo.controls` in the running app (TC-18 to TC-21).
 *
 * The strip in the left toolbar and the shortcuts are the whole interface of this story, so both
 * are driven here: what is enabled, what a press does, and which keystrokes the board must leave
 * strictly alone.
 */
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { UNDO_TOOLTIP, REDO_TOOLTIP } from '../../src/client/board/UndoButtons';
import { dispatchKey, renderBoard, runFrames } from './helpers';
import { FakeSocket, fakeWebSocket } from './fakeSocket';
import {
  boardDoc,
  mineNote,
  notes,
  noteOf,
  placeOf,
  redoButton,
  undoButton,
} from './undoHarness';

/** A room with a note in it, so a synced tab really holds a board. */
function roomDoc(): Y.Doc {
  const room = new Y.Doc();
  const objects = room.getMap<Y.Map<unknown>>('objects');
  const note = new Y.Map<unknown>();
  note.set('type', 'sticky');
  note.set('x', -25);
  note.set('y', -25);
  note.set('color', 'yellow');
  note.set('text', new Y.Text('from the room'));
  note.set('z', 1);
  objects.set('room-note', note);
  return room;
}

function plain(notes: readonly ReturnType<typeof snapshot>[number][]) {
  return notes.map((note) => [note.id, note.x, note.y, note.color, note.text, note.z]);
}

describe('undo.controls in the app', () => {
  test('TC-18 with nothing to undo, both buttons are disabled and say so', async () => {
    renderBoard();
    await runFrames();

    expect(undoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(redoButton()).toBeDisabled();
    expect(redoButton()).toHaveAttribute('aria-disabled', 'true');

    // a press of a disabled button is not a command
    await act(async () => {
      fireEvent.click(undoButton());
      fireEvent.click(redoButton());
    });
    expect(notes()).toHaveLength(0);
  });

  test('TC-18b a tooltip names each button and its shortcut', async () => {
    renderBoard();
    await runFrames();
    expect(undoButton()).toHaveAttribute('title', UNDO_TOOLTIP);
    expect(redoButton()).toHaveAttribute('title', REDO_TOOLTIP);
    expect(UNDO_TOOLTIP).toContain('Ctrl');
    expect(undoButton()).toHaveAccessibleName('Undo');
    expect(redoButton()).toHaveAccessibleName('Redo');
  });

  test('TC-18c one change of my own enables Undo; Redo waits for something to come back', async () => {
    renderBoard();
    await mineNote(0, 0);

    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();

    await act(async () => {
      fireEvent.click(undoButton());
    });
    expect(notes()).toHaveLength(0);
    expect(redoButton()).toBeEnabled();
  });

  test('TC-19 every undo and redo shortcut reaches the controller, and the browser gets nothing', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    const started = placeOf(id);
    await mineNote(400, 400); // both notes are one step: one undo takes both back

    const undoShortcuts = [
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
    ] as const;
    const redoShortcuts = [
      { key: 'z', ctrlKey: true, shiftKey: true },
      { key: 'z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ] as const;

    for (const shortcut of undoShortcuts) {
      const event = dispatchKey(window, shortcut);
      expect(event.defaultPrevented, `${JSON.stringify(shortcut)} should be taken over`).toBe(true);
      expect(notes()).toHaveLength(0);

      for (const back of redoShortcuts) {
        const again = dispatchKey(window, back);
        expect(again.defaultPrevented, `${JSON.stringify(back)} should be taken over`).toBe(true);
        expect(notes()).toHaveLength(2);
        expect(placeOf(id)).toEqual(started);

        const next = dispatchKey(window, shortcut);
        expect(next.defaultPrevented).toBe(true);
        expect(notes()).toHaveLength(0);
      }

      // put it back for the next undo shortcut
      dispatchKey(window, redoShortcuts[0]);
      expect(notes()).toHaveLength(2);
    }
  });

  test('TC-19b undo works with nothing selected', async () => {
    renderBoard();
    const id = await mineNote(0, 0);

    // nothing is selected at any point in this test
    expect(document.querySelector('[data-note-id][data-selected="true"]')).toBeNull();

    dispatchKey(window, { key: 'z', ctrlKey: true });
    expect(notes()).toHaveLength(0);
    dispatchKey(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(noteOf(id)).toBeDefined();
  });

  test('TC-21 Ctrl+Z inside an ordinary field is left to that field', async () => {
    renderBoard();
    const id = await mineNote(0, 0);
    const before = placeOf(id);

    // some other field on the page - the share link box, say - has the caret
    const field = document.createElement('input');
    field.type = 'text';
    field.value = 'https://example.invalid/b/abcdefghijklmnopqrstuv';
    document.body.appendChild(field);
    field.focus();

    const event = dispatchKey(field, { key: 'z', ctrlKey: true });

    // the board did not take the key, and did not touch its own history
    expect(event.defaultPrevented).toBe(false);
    expect(placeOf(id)).toEqual(before);
    expect(undoButton()).toBeEnabled();
    expect(document.activeElement).toBe(field);

    field.remove();
  });

  describe('on a board that could not be loaded', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      FakeSocket.reset();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    test('TC-20 the shortcuts do nothing and the buttons stay disabled', async () => {
      const room = roomDoc();
      vi.stubGlobal('WebSocket', fakeWebSocket);
      renderBoard();
      act(() => {
        FakeSocket.latest.open();
        FakeSocket.latest.syncWith(room);
      });
      await runFrames();

      // while the board was readable, this screen made a change of its own
      const id = await mineNote(0, 0);
      const before = plain(snapshot(boardDoc()));
      expect(undoButton()).toBeEnabled();

      // the room reports the board unreadable and hangs up
      act(() => {
        FakeSocket.latest.close(CLOSE_BOARD_LOAD_FAILED, 'the board could not be loaded');
      });
      await runFrames();
      const board = snapshot(boardDoc());
      expect(board.find((note) => note.id === id)).toBeDefined();

      // the history still holds the step, but nothing here may write, so the strip is switched off
      expect(undoButton()).toBeDisabled();
      expect(redoButton()).toBeDisabled();

      for (const shortcut of [
        { key: 'z', ctrlKey: true },
        { key: 'z', ctrlKey: true, shiftKey: true },
        { key: 'y', ctrlKey: true },
      ]) {
        const event = dispatchKey(window, shortcut);
        expect(event.defaultPrevented, `${JSON.stringify(shortcut)} should not reach the browser`).toBe(
          true,
        );
        expect(plain(snapshot(boardDoc())), `${JSON.stringify(shortcut)} changed the board`).toEqual(
          before,
        );
      }
    });
  });
});
