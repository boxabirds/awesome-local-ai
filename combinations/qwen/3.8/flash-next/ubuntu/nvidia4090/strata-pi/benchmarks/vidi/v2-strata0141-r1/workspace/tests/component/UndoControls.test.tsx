// Component tests for story 8: undo/redo controls.
// TC-18 (buttons), TC-19 (shortcuts), TC-20 (edit lock), TC-21 (focus elsewhere).

import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { createPeer } from '../unit/helpers/peer';
import {
  changeDoc,
  clickElement,
  docNotes,
  doubleClickElement,
  dragElement,
  editorElement,
  flushFrame,
  noteElement,
  noteOf,
  renderBoard,
  screenOf,
  selectionCount,
  pressKey,
  typeIntoEditor,
} from './harness';
import { FakeBoardProvider } from '../fixtures/fakeProvider';

afterEach(cleanup);

const undoButton = (): HTMLButtonElement => screen.getByTestId('undo') as HTMLButtonElement;
const redoButton = (): HTMLButtonElement => screen.getByTestId('redo') as HTMLButtonElement;

function setup(): { doc: Y.Doc; undo: UndoController } {
  const doc = new Y.Doc();
  const undo = createUndo(doc);
  renderBoard({ doc, undo });
  return { doc, undo };
}

/**
 * A controller that counts the calls the board makes on it, so a test can tell
 * a shortcut that reached the history from one that stopped at the keyboard.
 */
function spyUndo(real: UndoController): { spy: UndoController; calls: { undo: number; redo: number } } {
  const calls = { undo: 0, redo: 0 };
  const spy: UndoController = {
    undo: () => {
      calls.undo += 1;
      return real.undo();
    },
    redo: () => {
      calls.redo += 1;
      return real.redo();
    },
    boundary: () => real.boundary(),
    group: (open: boolean) => real.group(open),
    canUndo: () => real.canUndo(),
    canRedo: () => real.canRedo(),
    addScope: (type: Y.AbstractType<unknown>) => real.addScope(type),
    onChange: (callback: () => void) => real.onChange(callback),
    destroy: () => real.destroy(),
  };
  return { spy, calls };
}

/** The origin of a note that was already on the board when this person arrived. */
const PRESENT_ORIGIN: unique symbol = Symbol('already-on-the-board');

function placeNote(doc: Y.Doc, centre: { x: number; y: number }): { id: string; cx: number; cy: number } {
  let id = '';
  changeDoc(() => {
    doc.transact(() => {
      id = createSticky(doc, centre);
    }, PRESENT_ORIGIN);
  });
  return { id, cx: centre.x, cy: centre.y };
}

const pos = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const note = noteOf(doc, id);
  return { x: note.x, y: note.y };
};

/** The whole board, comparable: what a press of undo has to leave behind. */
function boardState(doc: Y.Doc) {
  return docNotes(doc).map((note) => ({
    id: note.id,
    x: note.x,
    y: note.y,
    z: note.z,
    color: note.color,
    text: note.text,
    width: note.width ?? STICKY_SIZE_WORLD,
    height: note.height ?? STICKY_SIZE_WORLD,
  }));
}

async function dragNoteTo(
  note: { id: string; cx: number; cy: number },
  delta: { x: number; y: number },
  steps = 4,
): Promise<void> {
  const from = screenOf({ x: note.cx, y: note.cy });
  dragElement(noteElement(note.id), from, { x: from.x + delta.x, y: from.y + delta.y }, steps);
  await flushFrame();
}

function openEditor(note: { id: string; cx: number; cy: number }): HTMLElement {
  const screen_ = screenOf({ x: note.cx, y: note.cy });
  doubleClickElement(noteElement(note.id), screen_.x, screen_.y);
  const editor = editorElement();
  if (!editor) {
    throw new Error('the note did not open for editing');
  }
  editor.focus();
  return editor;
}

describe('undo.controls - the toolbar buttons (TC-18, TC-20)', () => {
  it('TC-18 the buttons carry the state of this person\'s history', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });

    // Nothing of theirs yet.
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(undoButton().getAttribute('aria-label')).toBe('Undo');
    expect(redoButton().getAttribute('aria-label')).toBe('Redo');

    await dragNoteTo(a, { x: 60, y: 20 });
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
    // The tooltip shows the shortcut the button stands for.
    expect(undoButton().getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().disabled).toBe(true);
    expect(redoButton().getAttribute('title')).toBe('Nothing to redo');

    fireEvent.click(undoButton());
    expect(redoButton().disabled).toBe(false);
    fireEvent.click(redoButton());
    expect(undoButton().disabled).toBe(false);
  });

  it('TC-18 one press takes back exactly one step', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 420 });
    const before = { a: pos(doc, a.id), b: pos(doc, b.id) };

    await dragNoteTo(a, { x: 80, y: 0 });
    const moved = pos(doc, a.id);
    await dragNoteTo(b, { x: 0, y: 70 });

    fireEvent.click(undoButton());
    // Only the last thing that happened is taken back.
    expect(pos(doc, b.id)).toEqual(before.b);
    expect(pos(doc, a.id)).toEqual(moved);

    fireEvent.click(undoButton());
    expect(pos(doc, a.id)).toEqual(before.a);

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('five actions, and five presses take them back one at a time', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const states: ReturnType<typeof boardState>[] = [boardState(doc)];

    // 1. move it.
    await dragNoteTo(a, { x: 70, y: 30 });
    states.push(boardState(doc));

    // 2. recolour it.
    clickElement(noteElement(a.id), ...centreOfNote(doc, a.id));
    fireEvent.click(screen.getByTestId('swatch-blue'));
    states.push(boardState(doc));

    // 3. type in it.
    openEditor(a);
    typeIntoEditor('written by me');
    await flushFrame();
    pressKey('Escape');
    states.push(boardState(doc));

    // 4. create a second note.
    fireEvent.click(screen.getByTestId('create-sticky'));
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(2);
    pressKey('Escape'); // the new note was opened for editing; close the editor
    states.push(boardState(doc));

    // 5. delete it.
    const created = docNotes(doc).find((note) => note.id !== a.id)!;
    clickElement(noteElement(created.id), ...centreOfNote(doc, created.id));
    fireEvent.click(screen.getByTestId('delete-note'));
    await flushFrame();
    states.push(boardState(doc));
    expect(docNotes(doc)).toHaveLength(1);

    // Five presses, and after each one the board is exactly what it was one
    // action earlier - no more, no less.
    for (let index = 4; index >= 0; index -= 1) {
      expect(undoButton().disabled).toBe(false);
      fireEvent.click(undoButton());
      await flushFrame();
      expect(boardState(doc)).toEqual(states[index]);
    }
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    // And five presses put them all back.
    for (let index = 1; index <= 5; index += 1) {
      fireEvent.click(redoButton());
      await flushFrame();
      expect(boardState(doc)).toEqual(states[index]);
    }
    expect(redoButton().disabled).toBe(true);
  });

  it('TC-20 both buttons are disabled when there is nothing of this person\'s to take back', async () => {
    const { doc } = setup();
    const peer = createPeer(doc);

    // Someone else's change, delivered to this board.
    changeDoc(() => {
      peer.change((peerDoc) => createSticky(peerDoc, { x: 300, y: 300 }, 'blue'));
    });
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);

    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
    expect(undoButton().title).toBe('Nothing of yours to undo');

    // Pressing them changes nothing.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);
  });

  it('TC-20 undo back to the start leaves Undo disabled and Redo enabled', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    await dragNoteTo(a, { x: 40, y: 40 });
    clickElement(noteElement(a.id), ...centreOfNote(doc, a.id));
    fireEvent.click(screen.getByTestId('swatch-violet'));
    await flushFrame();

    fireEvent.click(undoButton());
    fireEvent.click(undoButton());
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('TC-20 a new action after an undo clears the redo stack', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    await dragNoteTo(a, { x: 50, y: 0 });
    fireEvent.click(undoButton());
    expect(redoButton().disabled).toBe(false);

    clickElement(noteElement(a.id), ...centreOfNote(doc, a.id));
    fireEvent.click(screen.getByTestId('swatch-pink'));
    await flushFrame();
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it('a board nobody was given has undo and redo unavailable (TC-20 negative)', async () => {
    const doc = new Y.Doc();
    const provider = new FakeBoardProvider();
    const undo = createUndo(doc);
    renderBoard({ doc, connect: true, providerFactory: () => provider, undo });

    // A step of this person's, made while the board was still editable.
    changeDoc(() => {
      createSticky(doc, { x: 400, y: 400 }, 'yellow');
    });
    await flushFrame();
    expect(undo.canUndo()).toBe(true);
    expect(undoButton().disabled).toBe(false);

    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();
    expect(document.querySelector('[data-board-editable="false"]')).not.toBeNull();

    // The step is still there - and the controls are not: `undo.controls` says
    // the shortcuts and the buttons are unavailable when a board is not editable.
    expect(undo.canUndo()).toBe(true);
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);

    // The shortcut is unavailable too: nothing is taken back.
    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', ctrlKey: true });
    await flushFrame();
    expect(docNotes(doc)).toHaveLength(1);
    expect(undo.canUndo()).toBe(true);
  });

  it('the buttons are in the toolbar, in a group, labelled by their action', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Undo and redo' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(group.contains(undo)).toBe(true);
    expect(group.contains(redo)).toBe(true);
    expect(undo.getAttribute('title')).toBe('Nothing of yours to undo');
    expect(redo.getAttribute('title')).toBe('Nothing to redo');
  });
});

describe('undo.controls - the keyboard (TC-19, TC-21)', () => {
  it('TC-21 Ctrl+Z and Ctrl+Shift+Z, with nothing selected', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    await dragNoteTo(a, { x: 60, y: 40 });
    const moved = pos(doc, a.id);
    // Nothing is selected: undo is not a selection command (`undo.controls`).
    pressKey('Escape');
    expect(selectionCount()).toBe(0);

    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', ctrlKey: true });
    expect(pos(doc, a.id)).toEqual(before);
    expect(selectionCount()).toBe(0);

    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(pos(doc, a.id)).toEqual(moved);

    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', ctrlKey: true });
    expect(pos(doc, a.id)).toEqual(before);

    // Ctrl+Y is the same redo.
    fireEvent.keyDown(screen.getByTestId('board'), { key: 'y', ctrlKey: true });
    expect(pos(doc, a.id)).toEqual(moved);
  });

  it('TC-21 Cmd+Z works on a Mac keyboard', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    await dragNoteTo(a, { x: 30, y: 30 });

    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', metaKey: true });
    expect(pos(doc, a.id)).toEqual(before);
    fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', metaKey: true, shiftKey: true });
    expect(pos(doc, a.id)).toEqual({ x: before.x + 30, y: before.y + 30 });
  });

  it('the shortcut works with focus on a note, and with the focus nowhere', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    await dragNoteTo(a, { x: 45, y: 0 });

    noteElement(a.id).focus();
    fireEvent.keyDown(noteElement(a.id), { key: 'z', ctrlKey: true });
    expect(pos(doc, a.id)).toEqual(before);

    await dragNoteTo(a, { x: 45, y: 0 });
    act(() => {
      document.body.focus();
    });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(pos(doc, a.id)).toEqual(before);
  });

  it('Ctrl+Z with a note open for editing goes to the editor, not to the board twice', async () => {
    const { doc } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    await dragNoteTo(a, { x: 40, y: 0 });
    openEditor(a);
    typeIntoEditor('typing');
    await flushFrame();
    const moved = pos(doc, a.id);

    fireEvent.keyDown(editorElement()!, { key: 'z', ctrlKey: true });
    await flushFrame();
    // One step, the typing: the move is still there.
    expect(noteOf(doc, a.id).text).toBe('');
    expect(pos(doc, a.id)).toEqual(moved);
  });

  it('TC-19 Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y all reach the controller', async () => {
    const doc = new Y.Doc();
    const { spy, calls } = spyUndo(createUndo(doc));
    renderBoard({ doc, undo: spy });
    const a = placeNote(doc, { x: 400, y: 400 });
    const start = pos(doc, a.id);
    const middle = { x: start.x + 50, y: start.y };
    const end = { x: start.x + 50, y: start.y + 40 };

    // Two steps of this person's, made through the board.
    await dragNoteTo(a, { x: 50, y: 0 });
    await dragNoteTo(a, { x: 0, y: 40 });
    expect(pos(doc, a.id)).toEqual(end);
    pressKey('Escape');

    // `fireEvent` returns false once a handler has called preventDefault, which
    // is the other half of TC-19: the browser's own behaviour is stopped.
    const board = screen.getByTestId('board');
    expect(fireEvent.keyDown(board, { key: 'z', ctrlKey: true })).toBe(false);
    expect(calls.undo).toBe(1);
    expect(pos(doc, a.id)).toEqual(middle);

    expect(fireEvent.keyDown(board, { key: 'z', metaKey: true })).toBe(false);
    expect(calls.undo).toBe(2);
    expect(pos(doc, a.id)).toEqual(start);

    expect(fireEvent.keyDown(board, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(calls.redo).toBe(1);
    expect(pos(doc, a.id)).toEqual(middle);

    expect(fireEvent.keyDown(board, { key: 'z', metaKey: true, shiftKey: true })).toBe(false);
    expect(calls.redo).toBe(2);
    expect(pos(doc, a.id)).toEqual(end);

    expect(fireEvent.keyDown(board, { key: 'z', ctrlKey: true })).toBe(false);
    expect(calls.undo).toBe(3);
    expect(pos(doc, a.id)).toEqual(middle);

    // Ctrl+Y is the same redo.
    expect(fireEvent.keyDown(board, { key: 'y', ctrlKey: true })).toBe(false);
    expect(calls.redo).toBe(3);
    expect(pos(doc, a.id)).toEqual(end);

    // Nothing in the page's own undo was allowed to run: the board is the only
    // thing that moved.
    expect(docNotes(doc)).toHaveLength(1);
  });

  it('TC-21 Ctrl+Z with focus in a text input that is not the board does not reach the controller (negative)', async () => {
    const doc = new Y.Doc();
    const { spy, calls } = spyUndo(createUndo(doc));
    const { container } = renderBoard({ doc, undo: spy });
    const a = placeNote(doc, { x: 400, y: 400 });
    await dragNoteTo(a, { x: 60, y: 0 });
    const moved = pos(doc, a.id);

    // The share link field: an input the board does not own.
    const share = document.createElement('input');
    share.type = 'text';
    share.setAttribute('data-testid', 'share-link-input');
    share.setAttribute('aria-label', 'Share link');
    share.value = `${window.location.origin}/b/some-board`;
    container.appendChild(share);
    share.focus();

    expect(fireEvent.keyDown(share, { key: 'z', ctrlKey: true })).toBe(true);
    expect(calls.undo).toBe(0);
    expect(calls.redo).toBe(0);
    expect(pos(doc, a.id)).toEqual(moved);
    expect(undoButton().disabled).toBe(false);

    // The same key from the board, with focus back on the board, still reaches it.
    share.blur();
    expect(fireEvent.keyDown(screen.getByTestId('board'), { key: 'z', ctrlKey: true })).toBe(false);
    expect(calls.undo).toBe(1);
    expect(pos(doc, a.id)).not.toEqual(moved);
  });
});

/** Screen coordinates of a note's centre, for `clickElement`. */
function centreOfNote(doc: Y.Doc, id: string): [number, number] {
  const note = noteOf(doc, id);
  const centre = screenOf({
    x: note.x + (note.width ?? STICKY_SIZE_WORLD) / 2,
    y: note.y + (note.height ?? STICKY_SIZE_WORLD) / 2,
  });
  return [centre.x, centre.y];
}
