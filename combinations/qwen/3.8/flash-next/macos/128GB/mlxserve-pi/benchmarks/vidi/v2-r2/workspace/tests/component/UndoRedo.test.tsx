// Undo / redo as a person at the board experiences it (story 8): the toolbar
// buttons and the Ctrl/Cmd+Z, Shift+Z and Ctrl+Y shortcuts, their enabled state,
// and a whole typing edit or group operation coming back as one step.
//
// These use the real app (`renderBoard`), so a note's edit, drag and the group
// toolbar all go through the same code the browser runs. Two contributors are
// covered in the unit suite and the e2e suite, where a second real document
// exists; here the board is the single local author.

import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { connectorSnapshot } from '../../src/shared/objects/connector';
import type { Point } from '../../src/shared/geometry';
import {
  clickOn,
  connectorCount,
  connectorToolLayer,
  dragNote,
  dragOn,
  editorElement,
  editorFocused,
  flushFrames,
  holdConnectorTool,
  holdShapeTool,
  modelText,
  newConnector,
  newNote,
  newShape,
  noteAt,
  noteCount,
  notePosition,
  pressKey,
  pressKeyOn,
  renderBoard,
  shapeAt,
  shapeBox,
  shapeCount,
  shapeToolLayer,
  typeInto,
  useBoardTestLifecycle,
} from './helpers';

const undoButton = (): HTMLButtonElement => screen.getByTestId('undo') as HTMLButtonElement;
const redoButton = (): HTMLButtonElement => screen.getByTestId('redo') as HTMLButtonElement;

/** Ctrl+Z (or +Shift, or Ctrl+Y) sent exactly where the browser would send it. */
function modifyKey(
  target: EventTarget,
  key: string,
  init: { shiftKey?: boolean; metaKey?: boolean } = {},
): Event {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: init.metaKey !== true,
    metaKey: init.metaKey === true,
    shiftKey: init.shiftKey ?? false,
  });
  // act(): the handler changes the document, and the board repaints the note
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('undo and redo at the board', () => {
  useBoardTestLifecycle();

  it('TC-14 the Undo button reverses my last move, Redo puts it back', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const before = notePosition(0);

    dragNote(0, 120, 60);
    expect(notePosition(0)).not.toEqual(before);

    fireEvent.click(undoButton());
    expect(notePosition(0)).toEqual(before);

    fireEvent.click(redoButton());
    expect(notePosition(0)).not.toEqual(before);
  });

  it('TC-15 Ctrl+Z undoes my move and Ctrl+Shift+Z redoes it', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const before = notePosition(0);

    dragNote(0, 120, 60);
    const moved = notePosition(0);

    modifyKey(window, 'z');
    expect(notePosition(0)).toEqual(before);

    modifyKey(window, 'z', { shiftKey: true });
    flushFrames();
    expect(notePosition(0)).toEqual(moved);
  });

  it('TC-16 Ctrl+Y redoes an undone move', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const before = notePosition(0);

    dragNote(0, 120, 60);
    const moved = notePosition(0);

    modifyKey(window, 'z');
    expect(notePosition(0)).toEqual(before);

    modifyKey(window, 'y');
    flushFrames();
    expect(notePosition(0)).toEqual(moved);
  });

  it('TC-17 the buttons say what they can do with disabled and aria-disabled', () => {
    const { doc } = renderBoard();
    // nothing to undo or redo at first
    expect(undoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().disabled).toBe(true);
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    newNote(doc, { x: 0, y: 0 });
    dragNote(0, 120, 60);
    // now my move can be undone, and there is nothing to redo
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
    expect(redoButton().disabled).toBe(true);

    fireEvent.click(undoButton());
    // and after undoing, the redo became available
    expect(redoButton().disabled).toBe(false);
    expect(redoButton().getAttribute('aria-disabled')).toBe('false');
  });

  it('TC-18 a whole typing edit is one undo step', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    pressKeyOn(noteAt(0), 'Enter');
    expect(editorElement()).not.toBeNull();

    typeInto('hello world');
    expect(modelText(doc, id)).toBe('hello world');
    // leave editing, which closes the step
    pressKeyOn(editorElement(), 'Escape');

    fireEvent.click(undoButton());
    // one undo removes the whole edit, not one word of it
    expect(modelText(doc, id)).toBe('');

    fireEvent.click(redoButton());
    expect(modelText(doc, id)).toBe('hello world');
  });

  it('TC-19 Ctrl+Z inside the open editor undoes the text here, in place, and does not leak', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    pressKeyOn(noteAt(0), 'Enter');

    typeInto('hello world');
    const editor = editorElement();
    expect(editor).not.toBeNull();

    // the keystroke goes to the focused textarea, as the browser would send it
    const event = modifyKey(editor!, 'z');

    expect(event.defaultPrevented).toBe(true); // the browser's own undo never sees it
    // the typing is reversed in the document and shown back in the field, focused
    expect(modelText(doc, id)).toBe('');
    expect(editorElement()?.value).toBe('');
    expect(editorFocused()).toBe(true);
  });

  it('TC-20 moving a group of notes is one undo step', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 400, y: 200 });
    const before = [notePosition(0), notePosition(1)];

    // select both, then drag one of them: the whole selection moves
    pressKey('a', { ctrlKey: true });
    dragNote(0, 120, 60);
    expect(notePosition(0)).not.toEqual(before[0]);
    expect(notePosition(1)).not.toEqual(before[1]);

    // one undo returns the whole group at once
    fireEvent.click(undoButton());
    expect([notePosition(0), notePosition(1)]).toEqual(before);

    fireEvent.click(redoButton());
    expect(notePosition(0)).not.toEqual(before[0]);
    expect(notePosition(1)).not.toEqual(before[1]);
  });

  it('TC-21 deleting a group then undoing restores every object exactly once', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 400, y: 200 });
    const before = snapshot(doc).map((n) => ({ id: n.id, x: n.x, y: n.y }));

    pressKey('a', { ctrlKey: true });
    fireEvent.click(screen.getByTestId('selection-delete'));
    expect(noteCount()).toBe(0);

    fireEvent.click(undoButton());
    const after = snapshot(doc).map((n) => ({ id: n.id, x: n.x, y: n.y }));
    // the same two objects, each once, where they were
    expect(after).toEqual(before);
    expect(noteCount()).toBe(2);
  });
});

// Story 10 adds two kinds of object and two ways of drawing them. Undo is the story
// 8 convention they have to keep: "creating, restyling, labelling and re-attaching are
// each one undo step" - which is only true if a shape and an arrow are written with the
// board's own transaction origin, the one the undo stack watches. A string of their own
// would make every shape and arrow drawn here invisible to Ctrl+Z.
describe('undo and redo for shapes and arrows', () => {
  useBoardTestLifecycle();

  /** Where the middle of a drawn shape is, which is where a press on it lands. */
  const centreOf = (index: number): Point => {
    const box = shapeBox(index);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  it('a shape drawn with the Shape tool is one undo step, and Redo draws it again', () => {
    renderBoard();
    holdShapeTool();
    dragOn(shapeToolLayer(), { x: 120, y: 120 }, { x: 320, y: 240 });
    flushFrames();
    expect(shapeCount()).toBe(1);

    fireEvent.click(undoButton());
    flushFrames();
    expect(shapeCount()).toBe(0);

    fireEvent.click(redoButton());
    flushFrames();
    expect(shapeCount()).toBe(1);
  });

  it('an arrow drawn with the Connector tool is one undo step of its own', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: 100, y: 100 });
    newShape(doc, { x: 600, y: 100 });
    flushFrames();

    holdConnectorTool();
    dragOn(connectorToolLayer(), centreOf(0), centreOf(1));
    flushFrames();
    expect(connectorCount()).toBe(1);

    fireEvent.click(undoButton());
    flushFrames();
    // only the arrow goes: the two shapes it was drawn between stay on the board
    expect(connectorCount()).toBe(0);
    expect(shapeCount()).toBe(2);

    fireEvent.click(redoButton());
    flushFrames();
    expect(connectorCount()).toBe(1);
  });

  it('undoing the delete of a shape puts the arrow back pointing at it, in one step', () => {
    const { doc } = renderBoard();
    const a = newShape(doc, { x: 100, y: 100 });
    const b = newShape(doc, { x: 600, y: 100 });
    const arrow = newConnector(doc, a, b);
    flushFrames();
    expect(connectorSnapshot(doc, arrow)?.to.kind).toBe('attached');

    const at = centreOf(1);
    clickOn(shapeAt(1), at.x, at.y);
    pressKey('Delete');
    flushFrames();
    expect(shapeCount()).toBe(1);
    // the arrow outlived the shape, its end freed where the shape's side was
    expect(connectorSnapshot(doc, arrow)?.to.kind).toBe('free');

    // one undo, and the shape is back with the arrow pointing at it again: the detach
    // was written in the delete's own transaction, so it goes back with it
    fireEvent.click(undoButton());
    flushFrames();
    expect(shapeCount()).toBe(2);
    expect(connectorSnapshot(doc, arrow)?.to).toMatchObject({ kind: 'attached', objectId: b });
  });
});
