import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import { createNote, renderNotesHarness } from './notes-harness';
import { enableFakeFrameTimers, flushFrames } from './test-utils';

/**
 * Story 8 component tests (task 9, TC-14 to TC-17): undo step boundaries for
 * gestures and typing, in jsdom with a real Y.Doc, a real controller and the
 * story 7 transform gesture.
 *
 * Coordinate model: 1280x800 viewport, home camera {-640, -400, 1}, so
 * screen = world + (640, 400). A note created at world (x, y) is centred
 * there (top-left x-100, y-100).
 *
 * Frame control: `enableFakeFrameTimers` fakes rAF (one moveObjects write per
 * advanced frame) plus the common timers, but NOT Date — the Yjs capture
 * window therefore sees a (near) constant clock, so the step boundaries under
 * test (gesture start/end, editor mount/end) are what isolate the steps, not
 * real elapsed time.
 */
const PID = 1;

const sc = (wx: number, wy: number) => ({ clientX: wx + 640, clientY: wy + 400 });

const notes = () => screen.getAllByRole('group', { name: 'Sticky note' });
const note = (id: string): HTMLElement =>
  notes().find((el) => el.getAttribute('data-note-id') === id) as HTMLElement;
const editor = (): HTMLTextAreaElement | null =>
  screen.queryByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement | null;

const press = (el: HTMLElement, wx: number, wy: number): boolean =>
  fireEvent.pointerDown(el, { button: 0, pointerId: PID, ...sc(wx, wy) });
const move = (wx: number, wy: number): boolean =>
  fireEvent.pointerMove(window, { pointerId: PID, ...sc(wx, wy) });
const release = (wx: number, wy: number): boolean =>
  fireEvent.pointerUp(window, { pointerId: PID, ...sc(wx, wy) });
const cancel = (wx: number, wy: number): boolean =>
  fireEvent.pointerCancel(window, { pointerId: PID, ...sc(wx, wy) });

const get = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id)!;

/** One advanced rAF frame = one coalesced moveObjects write. */
const frame = (): void => {
  act(() => {
    vi.advanceTimersByTime(16);
  });
};

beforeEach(() => {
  enableFakeFrameTimers();
});

describe('undo.boundaries (jsdom, real Y.Doc, real controller)', () => {
  it('TC-14 a 30-frame drag of a selection is one undo step restoring every object', () => {
    const { docRef, selectionRef, undoRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0); // top-left (-100, -100)
    const b = createNote(doc, 400, 0); // top-left (300, -100)
    act(() => selectionRef.current!.setMany([a, b], false));

    // A 30-frame drag: press a (selected), cross the threshold (boundary at
    // gesture start), then 30 pointer frames each flushed on their own rAF.
    press(note(a), 0, 0);
    move(5, 0); // crosses DRAG_THRESHOLD_PX → beginGesture → boundary()
    for (let i = 1; i <= 30; i += 1) {
      move(5 + i * 5, 0);
      frame();
    }
    release(5 + 30 * 5, 0); // boundary at gesture end
    flushFrames();

    // Both objects moved by the final delta (5 + 150 = 155).
    expect(get(doc, a).x).toBe(-100 + 155);
    expect(get(doc, a).y).toBe(-100);
    expect(get(doc, b).x).toBe(300 + 155);
    expect(get(doc, b).y).toBe(-100);
    expect(undoRef.current!.canUndo()).toBe(true);

    // A SINGLE undo restores every object's start position.
    act(() => {
      expect(undoRef.current!.undo()).toBe(true);
    });
    expect(get(doc, a).x).toBe(-100);
    expect(get(doc, a).y).toBe(-100);
    expect(get(doc, b).x).toBe(300);
    expect(get(doc, b).y).toBe(-100);
  });

  it('TC-15 a colour change 200 ms after a drag is a separate step (gesture-end boundary)', () => {
    const { docRef, undoRef } = renderNotesHarness();
    const doc = docRef.current!;
    const id = createNote(doc, 0, 0); // top-left (-100, -100), yellow
    const noteEl = note(id);

    // Step 1: drag the note (+50 x).
    press(noteEl, 0, 0);
    move(50, 0);
    frame();
    release(50, 0);
    flushFrames();
    expect(get(doc, id).x).toBe(-50);

    // 200 ms later the user recolors the note (a new action, still inside the
    // 500 ms capture window in real clock terms — only the gesture-end
    // boundary keeps it a separate step).
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));

    // Two separate steps: the first undo reverts only the colour...
    act(() => {
      expect(undoRef.current!.undo()).toBe(true);
    });
    expect(get(doc, id).color).toBe('yellow'); // colour reverted
    expect(get(doc, id).x).toBe(-50); // ...the move is still applied

    // ...the second undo reverts the move.
    act(() => {
      expect(undoRef.current!.undo()).toBe(true);
    });
    expect(get(doc, id).x).toBe(-100);
    expect(get(doc, id).color).toBe('yellow');
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing but not an earlier move', () => {
    const { docRef, undoRef } = renderNotesHarness();
    const doc = docRef.current!;
    const id = createNote(doc, 0, 0); // top-left (-100, -100)
    const noteEl = note(id);

    // Step 1: move the note (+50 x).
    press(noteEl, 0, 0);
    move(50, 0);
    frame();
    release(50, 0);
    flushFrames();
    const movedX = get(doc, id).x; // -50
    expect(movedX).toBe(-50);

    // Start editing the (still selected) note.
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor()!;
    expect(ta).not.toBeNull();

    // Type "hello" (one diff into the empty Y.Text).
    act(() => {
      ta.value = 'hello';
      fireEvent.input(ta, { target: { value: 'hello' } });
    });
    expect(getStickyText(doc, id)!.toString()).toBe('hello');

    // Ctrl+Z inside the editor is intercepted and runs against the Y.Text
    // history: it undoes the typing burst only.
    fireEvent.keyDown(ta, { key: 'z', ctrlKey: true });
    expect(getStickyText(doc, id)!.toString()).toBe(''); // typing undone
    expect(get(doc, id).x).toBe(movedX); // the earlier move is NOT undone
  });

  it('TC-17 a pointercancel mid-drag is one step restoring the start position', () => {
    const { docRef, undoRef } = renderNotesHarness();
    const doc = docRef.current!;
    const id = createNote(doc, 0, 0); // top-left (-100, -100)
    const noteEl = note(id);

    press(noteEl, 0, 0);
    move(30, 0);
    frame(); // a → -70
    move(60, 0);
    frame(); // a → -40
    // Cancel mid-drag (no release): the last applied state is kept.
    cancel(60, 0);
    flushFrames();

    expect(get(doc, id).x).toBe(-40); // last applied kept
    expect(get(doc, id).y).toBe(-100);
    expect(undoRef.current!.canUndo()).toBe(true);

    // One undo restores the start position.
    act(() => {
      expect(undoRef.current!.undo()).toBe(true);
    });
    expect(get(doc, id).x).toBe(-100);
    expect(get(doc, id).y).toBe(-100);
  });
});
