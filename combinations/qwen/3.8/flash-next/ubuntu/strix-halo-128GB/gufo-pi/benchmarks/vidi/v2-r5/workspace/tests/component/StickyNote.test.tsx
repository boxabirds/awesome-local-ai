import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObject } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  cancelPointer,
  clickAt,
  editorElement,
  modelNotes,
  noteElement,
  noteElements,
  press,
  pressKey,
  release,
  renderStickyBoard,
  moveTo,
  seedNote,
  toolbarElement,
  viewport,
} from './stickyHarness';
import { advanceFrame, homeCamera, readCamera } from './boardHarness';

describe('sticky.interaction: select', () => {
  it('TC-18 press and release without movement selects the note and shows its toolbar', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const note = noteElement(id);
    press(note, 300, 200);
    expect(note.getAttribute('data-interaction')).toBe('pressed');
    release(note, 300, 200);

    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(toolbarElement()).toBeTruthy();
    // An accessible name, so the note is findable without relying on colour.
    expect(noteElement(id).getAttribute('aria-label')).toBe('Sticky note');
    expect(noteElement(id).getAttribute('role')).toBe('group');
  });

  it('TC-22 clicking empty board space clears the selection and hides the toolbar', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');

    clickAt(viewport(), 800, 600);
    expect(noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(toolbarElement()).toBeNull();
  });

  it('TC-36 Enter with nothing selected creates and edits nothing', () => {
    const doc = new Y.Doc();
    renderStickyBoard(doc);

    pressKey('Enter');

    expect(modelNotes(doc)).toHaveLength(0);
    expect(editorElement()).toBeNull();
  });
});

describe('sticky.interaction: move by dragging', () => {
  it('TC-19 moving 2 px stays under the threshold: selected, but the note does not move', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);
    const before = modelNotes(doc).find((note) => note.id === id);

    const note = noteElement(id);
    press(note, 300, 200);
    moveTo(note, 302, 200);
    release(note, 302, 200);
    advanceFrame();

    const after = modelNotes(doc).find((note) => note.id === id);
    expect(after?.x).toBeCloseTo(before?.x ?? Number.NaN, 9);
    expect(after?.y).toBeCloseTo(before?.y ?? Number.NaN, 9);
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(noteElement(id).getAttribute('data-interaction')).toBe('unselected');
  });

  it('TC-20 moving 3 px drags the note, and dragging never pans the board', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);
    const cameraBefore = homeCamera();
    const before = modelNotes(doc).find((note) => note.id === id);

    const note = noteElement(id);
    press(note, 300, 200);
    moveTo(note, 303, 200);
    expect(noteElement(id).getAttribute('data-interaction')).toBe('dragging');

    // Negative case: the camera is untouched while a note is dragged.
    expect(readCamera()).toEqual(cameraBefore);

    moveTo(note, 340, 230);
    release(note, 340, 230);
    advanceFrame();

    const after = modelNotes(doc).find((note) => note.id === id);
    // The camera zoom is 1 in jsdom, so screen pixels equal world units here.
    expect(after?.x).toBeCloseTo((before?.x ?? 0) + 40, 6);
    expect(after?.y).toBeCloseTo((before?.y ?? 0) + 30, 6);
    expect(noteElement(id).getAttribute('data-interaction')).toBe('unselected');
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    // The note toolbar is back once the drag ends.
    expect(toolbarElement()).toBeTruthy();
  });

  it('TC-21 an interrupted drag keeps the last position shown and selects the note', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);
    const before = modelNotes(doc).find((note) => note.id === id);

    const note = noteElement(id);
    press(note, 300, 200);
    moveTo(note, 310, 200);
    moveTo(note, 320, 210);
    advanceFrame();
    const moved = modelNotes(doc).find((note) => note.id === id);
    expect(moved?.x).toBeCloseTo((before?.x ?? 0) + 20, 6);

    cancelPointer(note, 320, 210);
    // Later moves belong to nothing: the position that was last shown is kept.
    moveTo(note, 900, 900);
    advanceFrame();

    const after = modelNotes(doc).find((note) => note.id === id);
    expect(after?.x).toBeCloseTo(moved?.x ?? Number.NaN, 9);
    expect(after?.y).toBeCloseTo(moved?.y ?? Number.NaN, 9);
    expect(noteElement(id).getAttribute('data-interaction')).toBe('unselected');
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
  });

  it('dragging raises the note above every other note', () => {
    const doc = new Y.Doc();
    const bottom = seedNote(doc, { x: 0, y: 0 });
    seedNote(doc, { x: 20, y: 20 });
    renderStickyBoard(doc);
    expect(modelNotes(doc)[0]?.id).toBe(bottom);

    const note = noteElement(bottom);
    press(note, 300, 200);
    moveTo(note, 320, 220);
    advanceFrame();

    expect(modelNotes(doc)[modelNotes(doc).length - 1]?.id).toBe(bottom);
    release(note, 320, 220);
  });
});

describe('sticky.delete: keyboard', () => {
  it('TC-25 Delete removes the selected note', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    pressKey('Delete');

    expect(modelNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it('TC-25 Backspace removes the selected note', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    pressKey('Backspace');

    expect(modelNotes(doc)).toHaveLength(0);
  });

  it('Delete with nothing selected removes nothing', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    pressKey('Delete');

    expect(modelNotes(doc).map((note) => note.id)).toEqual([id]);
  });
});

describe('sticky.edit_start: double-click on a note', () => {
  it('TC-35 double-clicking an existing note edits it instead of creating another', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const note = noteElement(id);
    press(note, 300, 200);
    release(note, 300, 200);
    fireEvent.doubleClick(note, { clientX: 300, clientY: 200 });

    expect(noteElements()).toHaveLength(1);
    expect(editorElement()).toBeTruthy();
    expect(modelNotes(doc).map((entry) => entry.id)).toEqual([id]);
  });

  it('a double-click on empty board space creates one note and starts editing it', () => {
    const doc = new Y.Doc();
    renderStickyBoard(doc);

    press(viewport(), 400, 300);
    release(viewport(), 400, 300);
    fireEvent.doubleClick(viewport(), { clientX: 400, clientY: 300 });

    const notes = modelNotes(doc);
    expect(notes).toHaveLength(1);
    // jsdom is 1024x768 with the origin centred: the click at (400, 300) is world (-112, -84).
    expect(notes[0]?.x).toBeCloseTo(-112 - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.y).toBeCloseTo(-84 - STICKY_SIZE_WORLD / 2, 6);
    expect(editorElement()).toBeTruthy();
  });
});

describe('sticky.interaction: a note disappearing mid-interaction', () => {
  it('TC-37 deleting the note while it is being dragged ends the drag silently', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const note = noteElement(id);
    press(note, 300, 200);
    moveTo(note, 320, 220);
    advanceFrame();

    // Somebody else removes the note mid-drag (story 3).
    expect(() => act(() => deleteObject(doc, id))).not.toThrow();
    expect(noteElements()).toHaveLength(0);

    // The captured pointer keeps moving; nothing throws and nothing is re-created.
    expect(() => {
      moveTo(note, 400, 400);
      release(note, 400, 400);
      advanceFrame();
    }).not.toThrow();

    expect(modelNotes(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it('TC-37 deleting the note while it is being edited ends the edit silently', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    clickAt(noteElement(id), 300, 200);
    pressKey('Enter');
    expect(editorElement()).toBeTruthy();

    expect(() => act(() => deleteObject(doc, id))).not.toThrow();

    expect(modelNotes(doc)).toHaveLength(0);
    expect(editorElement()).toBeNull();
    expect(noteElements()).toHaveLength(0);
  });
});

describe('sticky.note geometry', () => {
  it('notes are STICKY_SIZE_WORLD squares positioned at their world coordinates', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 500, y: 300 });
    renderStickyBoard(doc);

    const note = noteElement(id);
    expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.left).toBe(`${500 - STICKY_SIZE_WORLD / 2}px`);
    expect(note.style.top).toBe(`${300 - STICKY_SIZE_WORLD / 2}px`);
    expect(note.getAttribute('tabindex')).toBe('0');
  });
});
