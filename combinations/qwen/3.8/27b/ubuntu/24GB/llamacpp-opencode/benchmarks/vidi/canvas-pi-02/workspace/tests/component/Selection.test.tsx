import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { createNote, renderNotesHarness, seedNoteText } from './notes-harness';
import { enableFakeFrameTimers, flushFrames } from './test-utils';
import { createTestbox } from '../fixtures/testbox';

/**
 * Story 7 component tests (task 14, TC-16 to TC-31): selection bar, marquee,
 * the generic transform gesture (move/resize, incl. the test-only `testbox`
 * type) and the selection keyboard.
 *
 * Coordinate model: 1280x800 viewport, home camera {-640, -400, 1}, so
 * screen = world + (640, 400). A note created at world (x, y) is centred
 * there (top-left x-100, y-100).
 */
const PID = 1;

const sc = (wx: number, wy: number) => ({ clientX: wx + 640, clientY: wy + 400 });

const notes = () => screen.getAllByRole('group', { name: 'Sticky note' });
const note = (id: string): HTMLElement =>
  notes().find((el) => el.getAttribute('data-note-id') === id) as HTMLElement;
const handle = (name: string): HTMLElement => screen.getByRole('button', { name: `Resize ${name}` }) as HTMLElement;

const press = (el: HTMLElement, wx: number, wy: number, extra: Record<string, unknown> = {}) =>
  fireEvent.pointerDown(el, { button: 0, pointerId: PID, ...sc(wx, wy), ...extra });
const move = (wx: number, wy: number, extra: Record<string, unknown> = {}) =>
  fireEvent.pointerMove(window, { pointerId: PID, ...sc(wx, wy), ...extra });
const release = (wx: number, wy: number) => fireEvent.pointerUp(window, { pointerId: PID, ...sc(wx, wy) });

const get = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id)!;

beforeEach(() => {
  enableFakeFrameTimers();
});

describe('sel.interaction (TC-16 to TC-19)', () => {
  it('TC-16 all selected ids deleted remotely → selection empty, bar hidden', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 400, 0);
    act(() => selectionRef.current!.setMany([a, b], false));
    expect(screen.getByText('2 selected')).toBeTruthy();

    // A remote peer removes both selected objects.
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(selectionRef.current!.ids.size).toBe(0);
    expect(screen.queryByText('2 selected')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-17 two selected → "2 selected" + Delete selection button; count in an aria-live region', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 400, 0);
    act(() => selectionRef.current!.setMany([a, b], false));

    const count = screen.getByText('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    const del = screen.getByRole('button', { name: 'Delete selection' });
    expect(del).toBeTruthy();

    // The bar's Delete removes exactly the selection.
    fireEvent.click(del);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionRef.current!.ids.size).toBe(0);
  });

  it('TC-18 one sticky selected → the story-2 NoteToolbar instead of the bar', () => {
    const { docRef } = renderNotesHarness();
    const a = createNote(docRef.current!, 0, 0);
    const n = note(a);
    press(n, 0, 0);
    release(0, 0);

    expect(n.getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('toolbar', { name: 'Note options' })).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-19 clicking empty board space without dragging clears the selection', () => {
    const { docRef, viewport } = renderNotesHarness();
    const a = createNote(docRef.current!, 0, 0);
    const n = note(a);
    press(n, 0, 0);
    release(0, 0);
    expect(n.getAttribute('data-selected')).toBe('true');

    // A press on empty space that never moves is a click.
    fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(viewport, { pointerId: PID, clientX: 100, clientY: 100 });
    expect(note(a).getAttribute('data-selected')).toBe('false');
    expect(screen.queryByRole('toolbar', { name: 'Note options' })).toBeNull();
  });

  it('actions referencing ids not in the snapshot are ignored (error path)', () => {
    const { selectionRef } = renderNotesHarness();
    act(() => selectionRef.current!.click('missing'));
    expect(selectionRef.current!.ids.size).toBe(0);
    act(() => selectionRef.current!.toggle('gone'));
    expect(selectionRef.current!.ids.size).toBe(0);
    act(() => selectionRef.current!.setMany(['missing', 'also-gone'], false));
    expect(selectionRef.current!.ids.size).toBe(0);
    act(() => selectionRef.current!.startEdit('missing'));
    expect(selectionRef.current!.editingId).toBeNull();
  });
});

describe('sel.marquee (TC-20 to TC-22)', () => {
  it('TC-20 shift-drag around objects with {a} selected adds the fully contained ids', () => {
    const { docRef, selectionRef, viewport } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0); // bounds (-100..100)²
    const b = createNote(doc, 400, 0); // (300..500) × (-100..100)
    const c = createNote(doc, 800, 0); // (700..900) × (-100..100): outside
    press(note(a), 0, 0);
    release(0, 0);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a]));

    // Marquee world rect (-150..550) × (-150..150): contains a and b only.
    fireEvent.pointerDown(viewport, { button: 0, shiftKey: true, pointerId: PID, ...sc(-150, -150) });
    fireEvent.pointerMove(viewport, { pointerId: PID, ...sc(550, 150) });
    fireEvent.pointerUp(viewport, { pointerId: PID, ...sc(550, 150) });

    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a, b]));
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(snapshot(doc)).toHaveLength(3); // viewing only: nothing was moved
  });

  it('TC-21 (negative) a plain drag on empty space pans and never marquees', () => {
    const { apiRef, viewport } = renderNotesHarness();
    const cam0 = apiRef.current!.camera;

    fireEvent.pointerDown(viewport, { button: 0, pointerId: PID, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: PID, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(viewport, { pointerId: PID, clientX: 400, clientY: 300 });
    flushFrames();

    expect(apiRef.current!.camera.x).toBe(cam0.x - 200); // pan by the drag delta
    expect(apiRef.current!.camera.y).toBe(cam0.y - 100);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const { docRef, selectionRef, viewport } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 400, 0);
    press(note(a), 0, 0);
    release(0, 0);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a]));

    // A marquee that would include b is cancelled before release.
    fireEvent.pointerDown(viewport, { button: 0, shiftKey: true, pointerId: PID, ...sc(-150, -150) });
    fireEvent.pointerMove(viewport, { pointerId: PID, ...sc(550, 150) });
    fireEvent.pointerCancel(viewport, { pointerId: PID, ...sc(550, 150) });

    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a]));
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });
});

describe('sel.transform (TC-23 to TC-26)', () => {
  it('TC-23 dragging unselected b while {a} is selected → selection {b}, only b moves', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0); // top-left (-100, -100)
    const b = createNote(doc, 400, 0); // top-left (300, -100)
    press(note(a), 0, 0);
    release(0, 0);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a]));

    // Boundary: DRAG_THRESHOLD_PX - 1 movement is a click (no write).
    press(note(b), 400, 0);
    move(400 + DRAG_THRESHOLD_PX - 1, 0);
    release(400 + DRAG_THRESHOLD_PX - 1, 0);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([b])); // click b
    expect(get(doc, b).x).toBe(300); // no write below the threshold
    expect(get(doc, a).x).toBe(-100);

    // Exactly DRAG_THRESHOLD_PX starts the gesture: b moves, a does not.
    press(note(b), 400, 0);
    move(400 + DRAG_THRESHOLD_PX, 0); // 3px from the press
    flushFrames();
    release(400 + DRAG_THRESHOLD_PX, 0);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([b]));
    expect(get(doc, b).x).toBe(300 + DRAG_THRESHOLD_PX);
    expect(get(doc, b).y).toBe(-100);
    expect(get(doc, a).x).toBe(-100); // a never moved
  });

  it('TC-24 testbox: edge handles change width only; Shift preserves the ratio; labelled handles', () => {
    const { docRef } = renderNotesHarness();
    const doc = docRef.current!;
    let id = '';
    act(() => {
      id = createTestbox(doc, 0, 0, 100, 50); // top-left (0,0), centre (50,25)
    });
    const box = () => get(doc, id)!;

    press(screen.getByTestId('testbox'), 50, 25);
    release(50, 25);

    // All eight handles, labelled by position.
    for (const name of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(handle(name)).toBeTruthy();
    }

    // 'e' handle: width only (50 height kept).
    press(handle('right'), 100, 25);
    move(140, 25);
    release(140, 25);
    flushFrames();
    expect(box().width).toBe(140);
    expect(box().height).toBe(50);

    // 'se' handle without Shift: both axes move independently.
    press(handle('bottom-right'), 140, 50);
    move(160, 60);
    release(160, 60);
    flushFrames();
    expect(box().width).toBe(160);
    expect(box().height).toBe(60);

    // 'se' with Shift: the dominant axis sets one scale → ratio preserved.
    const ratioBefore = box().width! / box().height!; // 160 / 60
    press(handle('bottom-right'), 160, 60);
    move(200, 70, { shiftKey: true }); // dx 40 dominates dy 10 → s = 200/160
    release(200, 70);
    flushFrames();
    expect(box().width).toBe(200);
    expect(box().height).toBeCloseTo(75, 6); // 60 * 1.25
    expect(box().width! / box().height!).toBeCloseTo(ratioBefore, 6);
  });

  it('TC-25 (negative) a locked board (canEdit false) never writes; selection for viewing still works', () => {
    const startSpy = vi.fn();
    const { docRef } = renderNotesHarness({ editable: false, onGestureStart: startSpy });
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const before = get(doc, a);

    press(note(a), 0, 0);
    move(30, 0); // far beyond the threshold
    flushFrames();
    release(30, 0);

    expect(get(doc, a).x).toBe(before.x); // no write
    expect(get(doc, a).y).toBe(before.y);
    expect(startSpy).not.toHaveBeenCalled(); // the gesture never started
    expect(note(a).getAttribute('data-selected')).toBe('true'); // viewing selection works
  });

  it('TC-26 onGestureStart/onGestureEnd fire once per drag; pointercancel keeps the last applied position', () => {
    const startSpy = vi.fn();
    const endSpy = vi.fn();
    const { docRef } = renderNotesHarness({ onGestureStart: startSpy, onGestureEnd: endSpy });
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0); // top-left (-100, -100)

    press(note(a), 0, 0);
    move(10, 0);
    flushFrames();
    release(10, 0);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(get(doc, a).x).toBe(-90);

    // A cancelled drag keeps the last applied (absolute) position.
    press(note(a), 10, 0);
    move(20, 5);
    flushFrames(); // applied: (-80, -95)
    fireEvent.pointerCancel(window, { pointerId: PID, ...sc(20, 5) });
    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(endSpy).toHaveBeenCalledTimes(2);
    expect(get(doc, a).x).toBe(-80);
    expect(get(doc, a).y).toBe(-95);
  });
});

describe('sel.keyboard (TC-27 to TC-31)', () => {
  it('TC-27 Ctrl/Cmd+A selects every object and prevents the default', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 400, 0);

    const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a, b]));

    // The meta (Cmd) variant works too.
    act(() => selectionRef.current!.clear());
    const cmd = new KeyboardEvent('keydown', { key: 'a', metaKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(cmd);
    });
    expect(cmd.defaultPrevented).toBe(true);
    expect(new Set(selectionRef.current!.ids)).toEqual(new Set([a, b]));
  });

  it('TC-28 Ctrl+A on an empty board selects nothing and does not throw', () => {
    const { selectionRef } = renderNotesHarness();
    const e = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(selectionRef.current!.ids.size).toBe(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it('TC-29 ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0); // top-left (-100, -100)
    const b = createNote(doc, 400, 0); // top-left (300, -100)
    act(() => selectionRef.current!.setMany([a, b], false));

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    act(() => {
      window.dispatchEvent(right);
    });
    expect(right.defaultPrevented).toBe(true);
    expect(get(doc, a).x).toBe(-100 + NUDGE_STEP_WORLD);
    expect(get(doc, b).x).toBe(300 + NUDGE_STEP_WORLD); // the whole selection nudges

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(up);
    });
    expect(up.defaultPrevented).toBe(true);
    expect(get(doc, a).y).toBe(-100 - NUDGE_LARGE_STEP_WORLD);
    expect(get(doc, b).y).toBe(-100 - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30 (negative) Backspace while editing a note edits the text, never deletes the object', () => {
    const { docRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    seedNoteText(doc, a, 'ab');
    const n = note(a);
    fireEvent.doubleClick(n, { ...sc(0, 0) });
    const editor = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();

    // The key reaches the editor (native text edit) — the board handler ignores it.
    act(() => {
      fireEvent.keyDown(editor, { key: 'Backspace' });
    });
    // While editing, the window handler also ignores it (the editor owns the keys).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));
    });

    expect(snapshot(doc)).toHaveLength(1); // the object is retained
    expect(screen.queryByRole('textbox', { name: 'Sticky note text' })).toBeTruthy(); // still editing
  });

  it('TC-31 Delete/Backspace with a selection removes everything selected, then clears', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    const b = createNote(doc, 400, 0);
    act(() => selectionRef.current!.setMany([a, b], false));

    const del = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
    act(() => {
      window.dispatchEvent(del);
    });
    expect(del.defaultPrevented).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionRef.current!.ids.size).toBe(0);

    // The Backspace variant behaves the same.
    const c = createNote(doc, 0, 0);
    act(() => selectionRef.current!.click(c));
    const back = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    act(() => {
      window.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionRef.current!.ids.size).toBe(0);
  });

  it('Escape clears the selection (and does not delete)', () => {
    const { docRef, selectionRef } = renderNotesHarness();
    const doc = docRef.current!;
    const a = createNote(doc, 0, 0);
    act(() => selectionRef.current!.click(a));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(selectionRef.current!.ids.size).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});
