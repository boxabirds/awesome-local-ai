import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  boardNotes,
  click,
  createNote,
  deleteNote,
  doubleClick,
  dragNote,
  editorElement,
  flushFrames,
  noteCentreOnScreen,
  noteElement,
  notePositions,
  notePosition,
  pointerCancelOn,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  pressKey,
  readCamera,
  renderBoard,
  selectNote,
  selectedNoteIds,
  noteToolbarElement,
  waitForNotes,
} from './fixtures/board';

/**
 * Sticky note interaction (sticky.interaction): selecting, moving, the drag threshold,
 * creating by double-click and deleting with the keyboard. Each test drives the real
 * app and asserts both the DOM and the document behind it.
 */
describe('sticky note selection (TC-18, TC-22)', () => {
  it('TC-18: pressing and releasing a note selects it, with the outline and the note toolbar', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await waitForNotes(1);
    const note = noteElement(id);
    expect(note.dataset.selected).toBe('false');

    await selectNote(id);

    expect(selectedNoteIds()).toEqual([id]);
    expect(note.dataset.selected).toBe('true');
    expect(note.style.outlineWidth).toBe('2px');
    // Accessible name, so a screen reader does not announce a note as colour only.
    expect(note.getAttribute('role')).toBe('group');
    expect(note.getAttribute('aria-label')).toBe('Sticky note');
    expect(noteToolbarElement()).not.toBeNull();
  });

  it('TC-22: clicking empty board space clears the selection and hides the toolbar', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    expect(selectedNoteIds()).toEqual([id]);

    await click({ x: 200, y: 700 });

    expect(selectedNoteIds()).toEqual([]);
    expect(noteElement(id).dataset.selected).toBe('false');
    expect(noteToolbarElement()).toBeNull();
  });

  it('TC-36: pressing Enter while nothing is selected creates and edits nothing', async () => {
    await renderBoard();

    pressKey('Enter');
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(editorElement()).toBeNull();
  });
});

describe('dragging a note (TC-19, TC-20, TC-21)', () => {
  it('TC-19: a press that moves less than the threshold selects without moving the note', async () => {
    await renderBoard();
    const id = createNote({ x: 120, y: 40 });
    const before = notePosition(id);
    const note = noteElement(id);
    const at = noteCentreOnScreen(id);
    expect(DRAG_THRESHOLD_PX).toBe(3);

    pointerDownOn(note, at);
    pointerMoveOn(note, { x: at.x + 2, y: at.y });
    await flushFrames();
    pointerUpOn(note, { x: at.x + 2, y: at.y });
    await flushFrames();

    expect(notePosition(id)).toEqual(before);
    expect(selectedNoteIds()).toEqual([id]);
  });

  it('TC-20: a drag starting on a note moves the note by the pointer delta and leaves the camera alone', async () => {
    await renderBoard();
    const id = createNote({ x: 120, y: 40 });
    const before = notePosition(id);
    const cameraBefore = readCamera();
    const note = noteElement(id);
    const at = noteCentreOnScreen(id);

    // Exactly the threshold, in screen pixels, on the first step.
    pointerDownOn(note, at);
    pointerMoveOn(note, { x: at.x + 3, y: at.y });
    await flushFrames();
    expect(notePosition(id).x).toBeCloseTo(before.x + 3, 6);

    for (let step = 1; step <= 3; step += 1) {
      pointerMoveOn(note, {
        x: at.x + (100 * step) / 3,
        y: at.y + (50 * step) / 3,
      });
      await flushFrames();
    }
    pointerUpOn(note, { x: at.x + 100, y: at.y + 50 });
    await flushFrames();

    // 100% zoom: screen pixels and board units are the same.
    const after = notePosition(id);
    expect(after.x).toBeCloseTo(before.x + 100, 6);
    expect(after.y).toBeCloseTo(before.y + 50, 6);
    // The board did not pan (sticky.no_pan).
    expect(readCamera()).toEqual(cameraBefore);
    // What the model says is what is drawn.
    expect(note.style.left).toBe(`${after.x}px`);
    expect(note.style.top).toBe(`${after.y}px`);
  });

  it('TC-21: pointercancel ends the drag where the last frame left the note, still selected', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    const before = notePosition(id);
    const note = noteElement(id);
    const at = noteCentreOnScreen(id);

    pointerDownOn(note, at);
    pointerMoveOn(note, { x: at.x + 60, y: at.y + 40 });
    await flushFrames();
    const applied = notePosition(id);
    pointerCancelOn(note, { x: at.x + 60, y: at.y + 40 });
    await flushFrames();

    expect(applied.x).toBeCloseTo(before.x + 60, 6);
    expect(applied.y).toBeCloseTo(before.y + 40, 6);
    expect(selectedNoteIds()).toEqual([id]);

    // The gesture is over: later movement does nothing.
    pointerMoveOn(note, { x: at.x + 900, y: at.y + 900 });
    pointerUpOn(note, { x: at.x + 900, y: at.y + 900 });
    await flushFrames();
    expect(notePosition(id)).toEqual(applied);
  });

  it('TC-37: a note deleted from the document mid-drag ends the interaction silently', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    const note = noteElement(id);
    const at = noteCentreOnScreen(id);

    pointerDownOn(note, at);
    pointerMoveOn(note, { x: at.x + 30, y: at.y + 30 });
    await flushFrames();
    deleteNote(id);
    await flushFrames();
    pointerMoveOn(note, { x: at.x + 90, y: at.y + 90 });
    pointerUpOn(note, { x: at.x + 90, y: at.y + 90 });
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(selectedNoteIds()).toEqual([]);
  });
});

describe('creating and deleting a note (TC-25, TC-35, TC-37)', () => {
  it('TC-35: double-clicking an existing note edits it instead of creating another one', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    const note = noteElement(id);
    const positionsBefore = notePositions();

    doubleClick(noteCentreOnScreen(id), note);
    await flushFrames();

    expect(notePositions()).toEqual(positionsBefore);
    expect(editorElement()).not.toBeNull();
    expect(note.dataset.editing).toBe('true');
  });

  it('creates a note where the board was double-clicked, centred on that point', async () => {
    await renderBoard();
    const camera = readCamera();

    doubleClick({ x: 250, y: 250 });
    await flushFrames();

    await waitForNotes(1);
    const [note] = boardNotes();
    // The world point under (250, 250) ends up in the middle of the note.
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(250 + camera.x, 6);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(250 + camera.y, 6);
    expect(editorElement()).not.toBeNull();
  });

  it('TC-25: Delete on the keyboard removes the selected note', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);

    pressKey('Delete');
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(selectedNoteIds()).toEqual([]);
  });

  it('TC-25: Backspace on the keyboard removes the selected note', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);

    pressKey('Backspace');
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(selectedNoteIds()).toEqual([]);
  });

  it('TC-37: a note deleted from the document while being edited leaves no editor and is not recreated', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    pressKey('Enter');
    await flushFrames();
    expect(editorElement()).not.toBeNull();

    deleteNote(id);
    await flushFrames();

    expect(boardNotes()).toEqual([]);
    expect(editorElement()).toBeNull();
    expect(selectedNoteIds()).toEqual([]);
    // Nothing the editor does afterwards brings the note back or throws.
    pressKey('Escape');
    pressKey('Enter');
    await flushFrames();
    expect(boardNotes()).toEqual([]);
    expect(editorElement()).toBeNull();
  });
});

describe('notes and the rest of the board', () => {
  it('renders every note in the document through the model', async () => {
    await renderBoard();
    createNote({ x: 0, y: 0 });
    createNote({ x: 300, y: 0 });
    await waitForNotes(2);

    expect(notePositions().map((note) => note.z)).toEqual([1, 2]);
    expect(document.querySelectorAll('[data-note-id]').length).toBe(2);
  });

  it('keeps the selection on the note that was dragged last and brings it to the front', async () => {
    await renderBoard();
    const back = createNote({ x: 0, y: 0 });
    const front = createNote({ x: 100, y: 0 });
    await waitForNotes(2);

    await dragNote(back, { x: 100, y: 0 });

    expect(notePosition(back).z).toBeGreaterThan(notePosition(front).z);
    expect(selectedNoteIds()).toEqual([back]);
  });

  it('a click on the toolbar of a note does not clear the selection', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    const toolbar = noteToolbarElement();
    expect(toolbar).not.toBeNull();

    // pointerdown on the toolbar must not reach the viewport's "empty click" handling.
    const at = { x: 640, y: 200 };
    pointerDownOn(toolbar as HTMLElement, at);
    pointerUpOn(toolbar as HTMLElement, at);
    await flushFrames();

    expect(selectedNoteIds()).toEqual([id]);
  });

  it('a note that is not selected shows no toolbar and no editor', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    const other = createNote({ x: 500, y: 0 });
    await selectNote(other);

    expect(selectedNoteIds()).toEqual([other]);
    expect(document.querySelectorAll('[data-testid="note-toolbar"]').length).toBe(1);
    expect(noteElement(id).dataset.selected).toBe('false');
    expect(noteElement(id).style.outlineWidth).toBe('0px');
  });
});
