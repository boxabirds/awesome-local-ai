import { act } from '@testing-library/react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { enableFakeFrameTimers, flushFrames } from './test-utils';
import { createNote, renderNotesHarness, seedNoteText } from './notes-harness';

/** The single note in the board (all these tests keep at most one live note). */
const noteEl = () => screen.getByRole('group', { name: 'Sticky note' }) as HTMLElement;
const noteToolbar = () => screen.queryByRole('toolbar', { name: 'Note options' });
const editor = () => screen.queryByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement | null;

/** Press the centre of the note (screen 640,400 = world 0,0). */
const press = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
};
const release = (el: HTMLElement) => {
  fireEvent.pointerUp(el, { clientX: 640, clientY: 400, pointerId: 1 });
};

const attr = (el: Element | null, name: string): string | null => (el ? el.getAttribute(name) : null);

describe('sticky.interaction (jsdom, real Y.Doc)', () => {
  beforeEach(() => {
    enableFakeFrameTimers();
  });

  it('TC-18 a press without movement selects the note (outline + note toolbar)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    expect(attr(note, 'data-selected')).toBe('false');
    expect(noteToolbar()).toBeNull();

    press(note);
    release(note);

    expect(attr(note, 'data-selected')).toBe('true');
    expect(note.className).toContain('vidi6-sticky--selected');
    expect(noteToolbar()).not.toBeNull();
    expect(snapshot(docRef.current!).find((n) => n.id === id)).toBeTruthy();
  });

  it('TC-19 moving less than the drag threshold keeps the note in place (boundary 2px)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    const before = snapshot(docRef.current!).find((n) => n.id === id)!;

    fireEvent.pointerDown(note, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 642, clientY: 400, pointerId: 1 }); // 2px < DRAG_THRESHOLD_PX
    fireEvent.pointerUp(note, { clientX: 642, clientY: 400, pointerId: 1 });
    flushFrames();

    const after = snapshot(docRef.current!).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(attr(note, 'data-selected')).toBe('true');
    expect(attr(note, 'data-dragging')).toBeNull();
  });

  it('TC-20 moving exactly the drag threshold starts a drag and never pans the board (boundary 3px)', () => {
    const { docRef, apiRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    const cameraBefore = apiRef.current!.camera;

    fireEvent.pointerDown(note, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 643, clientY: 400, pointerId: 1 }); // 3px = DRAG_THRESHOLD_PX
    flushFrames();

    // Crossing the threshold selects the (unselected) note and starts the move.
    expect(attr(note, 'data-selected')).toBe('true');
    const after = snapshot(docRef.current!).find((n) => n.id === id)!;
    expect(after.x).toBe(-100 + 3 / 1); // world units = screen px / zoom(1)
    expect(after.y).toBe(-100);
    // Negative: dragging a note never moves the board camera (no pan).
    expect(apiRef.current!.camera).toEqual(cameraBefore);
  });

  it('TC-21 pointercancel during a drag ends it at the last applied position', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();

    fireEvent.pointerDown(note, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 650, clientY: 405, pointerId: 1 });
    flushFrames(); // the move is applied
    fireEvent.pointerCancel(note, { pointerId: 1 });

    const after = snapshot(docRef.current!).find((n) => n.id === id)!;
    expect(after.x).toBe(-100 + 10);
    expect(after.y).toBe(-100 + 5);
    expect(attr(note, 'data-selected')).toBe('true');
    expect(attr(note, 'data-dragging')).toBeNull();
  });

  it('TC-22 clicking empty board space clears the selection and hides the toolbar', () => {
    const { docRef, viewport } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    press(note);
    release(note);
    expect(attr(note, 'data-selected')).toBe('true');
    expect(noteToolbar()).not.toBeNull();

    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(attr(note, 'data-selected')).toBe('false');
    expect(noteToolbar()).toBeNull();
    expect(snapshot(docRef.current!).find((n) => n.id === id)).toBeTruthy(); // the note itself remains
  });

  it('TC-25 Delete removes the selected note', () => {
    const { docRef } = renderNotesHarness();
    createNote(docRef.current!, 0, 0);
    const note = noteEl();
    press(note);
    release(note);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(snapshot(docRef.current!)).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
  });

  it('TC-25 (Backspace run) Backspace removes the selected note', () => {
    const { docRef } = renderNotesHarness();
    createNote(docRef.current!, 0, 0);
    const note = noteEl();
    press(note);
    release(note);
    expect(attr(note, 'data-selected')).toBe('true');

    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(snapshot(docRef.current!)).toHaveLength(0);
  });

  it('TC-35 double-clicking an existing note edits it and creates no new note (negative)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'idea');
    const note = noteEl();

    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });

    const notes = snapshot(docRef.current!);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    const ta = editor();
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe('idea');
  });

  it('TC-36 Enter with nothing selected does nothing (negative)', () => {
    const { docRef } = renderNotesHarness();

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(snapshot(docRef.current!)).toHaveLength(0);
    expect(editor()).toBeNull();
  });

  it('TC-37 a note deleted mid-drag ends the drag silently (error path)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();

    fireEvent.pointerDown(note, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 660, clientY: 410, pointerId: 1 });
    // The note is deleted before the rAF move is applied.
    act(() => {
      deleteObject(docRef.current!, id);
    });
    expect(() => flushFrames()).not.toThrow();

    expect(snapshot(docRef.current!)).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Sticky note' })).toBeNull();
    // No re-creation: the doc holds nothing and later frames stay clean.
    act(() => {
      vi.runAllTimers();
    });
    expect(snapshot(docRef.current!)).toHaveLength(0);
  });

  it('TC-37 a note deleted while editing ends editing without re-creation (error path)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'half');
    const note = noteEl();
    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    expect(editor()).not.toBeNull();

    act(() => {
      deleteObject(docRef.current!, id);
    });

    expect(screen.queryByRole('textbox', { name: 'Sticky note text' })).toBeNull();
    expect(snapshot(docRef.current!)).toHaveLength(0);
  });
});
