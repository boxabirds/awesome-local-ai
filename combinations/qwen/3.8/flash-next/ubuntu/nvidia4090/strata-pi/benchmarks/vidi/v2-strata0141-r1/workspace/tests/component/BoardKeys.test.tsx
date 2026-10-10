import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  changeDoc,
  clickElement,
  createNote,
  docNotes,
  doubleClickElement,
  editorElement,
  flushFrame,
  noteElement,
  objectElement,
  noteOf,
  pressKey,
  readCamera,
  renderBoard,
  screenCentre,
  screenOf,
  selectionBarElement,
  selectionCount,
} from './harness';
import { FakeBoardProvider } from '../fixtures/fakeProvider';
import { createTestBox, testBoxBounds } from '../fixtures/testbox';

/**
 * The board's keyboard commands (TC-27 to TC-31): select all, nudge, edit and
 * delete - all of them aimed at the selection, whatever it holds.
 */

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

function placeNote(doc: Y.Doc, centre: { x: number; y: number }): Placed {
  return { id: createNote(doc, centre), cx: centre.x, cy: centre.y };
}

function pressNote(note: Placed, additive = false): void {
  const screen = screenOf({ x: note.cx, y: note.cy });
  clickElement(noteElement(note.id), screen.x, screen.y, additive ? { shiftKey: true } : {});
}

function editorNow(): HTMLElement {
  const editor = editorElement();
  if (!editor) {
    throw new Error('no note is being edited');
  }
  return editor;
}

const pos = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const note = noteOf(doc, id);
  return { x: note.x, y: note.y };
};

describe('sel.keys - select all (TC-27, TC-28)', () => {
  it('TC-27 Ctrl+A selects every object, sticky notes included', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 300, y: 300 });
    const b = placeNote(doc, { x: 600, y: 300 });
    let boxId = '';
    changeDoc(() => {
      boxId = createTestBox(doc, { x: 900, y: 300, width: 300, height: 100 });
    });

    const event = pressKey('a', { ctrl: true });
    await flushFrame();

    expect(event.defaultPrevented).toBe(true);
    // `allObjectIds` is generic: the testbox is selected too (`sel.all_types`).
    expect(selectionCount()).toBe(3);
    expect(noteElement(a.id).getAttribute('data-selected')).toBe('true');
    expect(noteElement(b.id).getAttribute('data-selected')).toBe('true');
    expect(noteElement(a.id).getAttribute('data-selected')).toBe('true');
    expect(objectSelected(boxId)).toBe(true);
    expect(selectionBarElement()).not.toBeNull();
  });

  it('Cmd+A does the same thing', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    placeNote(doc, { x: 300, y: 300 });
    placeNote(doc, { x: 600, y: 300 });

    expect(selectionCount()).toBe(0);
    pressKey('a', { meta: true });
    expect(selectionCount()).toBe(2);
  });

  it('TC-28 Ctrl+A on a board with nothing on it changes nothing (negative)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    const before = docNotes(doc).length;
    const event = pressKey('a', { ctrl: true });

    expect(before).toBe(0);
    expect(selectionCount()).toBe(0);
    expect(selectionBarElement()).toBeNull();
    // There was nothing to select, but the board still owns the key.
    expect(event.defaultPrevented).toBe(true);
  });

  it('Escape empties the selection', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    placeNote(doc, { x: 300, y: 300 });
    pressKey('a', { ctrl: true });
    expect(selectionCount()).toBe(1);

    const event = pressKey('Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(selectionCount()).toBe(0);
    expect(selectionBarElement()).toBeNull();
  });

  it('Ctrl+A typed into a note is text, not select all', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 300, y: 300 });
    placeNote(doc, { x: 600, y: 300 });
    pressNote(a);
    act(() => {
      doubleClickElement(noteElement(a.id), screenOf({ x: a.cx, y: a.cy }).x, screenOf({ x: a.cx, y: a.cy }).y);
    });
    const editor = editorNow();
    editor.focus();

    pressKey('a', { ctrl: true });

    // The board's own selection is untouched: the keystroke belongs to the note.
    expect(selectionCount()).toBe(1);
    expect(editorElement()).toBe(editorFor(a.id));
  });
});

describe('sel.keys - nudge (TC-29)', () => {
  it('TC-29 arrows move the whole selection by NUDGE_STEP_WORLD, and Shift is larger', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 500 });
    const other = placeNote(doc, { x: 1000, y: 1000 });
    pressNote(a);
    pressNote(b, true);
    const before = { a: pos(doc, a.id), b: pos(doc, b.id), other: pos(doc, other.id) };
    const cameraBefore = readCamera();

    expect(pressKey('ArrowRight').defaultPrevented).toBe(true);
    expect(pos(doc, a.id)).toEqual({ x: before.a.x + NUDGE_STEP_WORLD, y: before.a.y });
    expect(pos(doc, b.id)).toEqual({ x: before.b.x + NUDGE_STEP_WORLD, y: before.b.y });

    pressKey('ArrowUp', { shift: true });
    expect(pos(doc, a.id)).toEqual({
      x: before.a.x + NUDGE_STEP_WORLD,
      y: before.a.y - NUDGE_LARGE_STEP_WORLD,
    });
    expect(pos(doc, b.id)).toEqual({
      x: before.b.x + NUDGE_STEP_WORLD,
      y: before.b.y - NUDGE_LARGE_STEP_WORLD,
    });

    // The board does not pan, and nothing unselected moved.
    expect(pos(doc, other.id)).toEqual(before.other);
    expect(readCamera()).toEqual(cameraBefore);
  });

  it('a nudge moves a mixed selection, testbox included', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const rect = { x: 300, y: 300, width: 400, height: 200 };
    let boxId = '';
    changeDoc(() => {
      boxId = createTestBox(doc, rect);
    });
    const note = placeNote(doc, { x: 800, y: 400 });
    pressNote(note);
    const centre = screenCentre(rect);
    clickElement(objectElement(boxId), centre.x, centre.y, { shiftKey: true });
    expect(selectionCount()).toBe(2);

    pressKey('ArrowLeft');

    expect(pos(doc, note.id).x).toBeCloseTo(800 - HALF - NUDGE_STEP_WORLD);
    expect(testBoxBounds(doc, boxId).x).toBeCloseTo(rect.x - NUDGE_STEP_WORLD);
  });

  it('arrow keys with nothing selected are still swallowed, and change nothing', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    const event = pressKey('ArrowRight');

    expect(event.defaultPrevented).toBe(false);
    expect(pos(doc, a.id)).toEqual(before);
  });
});

describe('sel.keys - editing and deleting (TC-30, TC-31)', () => {
  it('TC-30 Backspace and Delete while editing a note edit its text (negative)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    act(() => {
      doubleClickElement(noteElement(a.id), screenOf({ x: a.cx, y: a.cy }).x, screenOf({ x: a.cx, y: a.cy }).y);
    });
    const editor = editorNow();
    editor.focus();
    const centre = screenOf({ x: a.cx, y: a.cy });
    act(() => {
      clickElement(noteElement(a.id), centre.x, centre.y);
    });
    expect(editorElement()).toBe(editorFor(a.id));
    expect(selectionCount()).toBe(1);

    // Text typed into the note stays text: the note survives every "delete" key.
    typeInto(editor, 'keep me');
    pressKey('Backspace');
    pressKey('Delete');
    pressKey('ArrowRight');

    expect(docNotes(doc).map((note) => note.id)).toEqual([a.id]);
    expect(noteOf(doc, a.id).text).toBe('keep me');
  });

  it('TC-30 a delete key outside the editor still cannot delete the note being edited', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    pressNote(a);
    pressKey('Enter');
    expect(selectionBarElement()).toBeNull(); // one note: its own toolbar
    expect(editorElement()).toBe(editorFor(a.id));
    editorNow().blur();
    document.body.focus();

    pressKey('Delete');
    pressKey('Backspace');

    expect(docNotes(doc).map((note) => note.id)).toEqual([a.id]);
  });

  it('TC-31 Delete removes the whole selection, Backspace does too', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 400 });
    const survivor = placeNote(doc, { x: 1000, y: 400 });
    const survivorBefore = pos(doc, survivor.id);

    pressNote(a);
    pressNote(b, true);
    expect(selectionCount()).toBe(2);

    const event = pressKey('Delete');

    expect(event.defaultPrevented).toBe(true);
    expect(docNotes(doc).map((note) => note.id)).toEqual([survivor.id]);
    expect(selectionCount()).toBe(0);
    expect(selectionBarElement()).toBeNull();
    expect(pos(doc, survivor.id)).toEqual(survivorBefore);
  });

  it('Backspace deletes a mixed selection, testbox included', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const rect = { x: 300, y: 300, width: 400, height: 200 };
    let boxId = '';
    changeDoc(() => {
      boxId = createTestBox(doc, rect);
    });
    const note = placeNote(doc, { x: 800, y: 400 });
    pressNote(note);
    const centre = screenCentre(rect);
    clickElement(objectElement(boxId), centre.x, centre.y, { shiftKey: true });
    expect(selectionCount()).toBe(2);

    pressKey('Backspace');

    expect(docNotes(doc).map((entry) => entry.id)).toEqual([]);
    expect(document.querySelector(`[data-testid="object-${boxId}"]`)).toBeNull();
    expect(selectionCount()).toBe(0);
  });

  it('Enter edits a single selected editable object, and never a group', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 400 });

    pressNote(a);
    pressKey('Enter');
    expect(editorElement()).toBe(editorFor(a.id));

    pressKey('Escape'); // end editing, keep the selection
    pressNote(b, true);
    expect(selectionCount()).toBe(2);
    pressKey('Enter');
    expect(editorElement()).toBeNull();
    expect(docNotes(doc).map((note) => note.id)).toEqual([a.id, b.id]);
  });

  it('TC-25 the keyboard cannot edit a board the room refused to load (negative)', async () => {
    const doc = new Y.Doc();
    const provider = new FakeBoardProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    const a = placeNote(doc, { x: 400, y: 400 });
    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();

    pressKey('a', { ctrl: true });
    expect(selectionCount()).toBe(1); // selecting is the client's own business
    expect(noteElement(a.id).getAttribute('data-selected')).toBe('true');

    const before = docNotes(doc).map((note) => ({ id: note.id, x: note.x, y: note.y }));
    pressKey('ArrowRight', { shift: true });
    pressKey('Delete');
    pressKey('Enter');

    expect(docNotes(doc).map((note) => ({ id: note.id, x: note.x, y: note.y }))).toEqual(before);
    expect(editorElement()).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const HALF = STICKY_SIZE_WORLD / 2;

function editorFor(id: string): HTMLElement | null {
  return noteElement(id).querySelector('textarea');
}

function objectSelected(id: string): boolean {
  return (
    document.querySelector(`[data-testid="object-${id}"]`)?.getAttribute('data-selected') === 'true'
  );
}

function typeInto(editor: HTMLElement, text: string): void {
  act(() => {
    fireEvent.change(editor, { target: { value: text } });
  });
}
