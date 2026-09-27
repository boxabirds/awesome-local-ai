// Story 8, Task 9 — gesture and typing boundaries through the real App
// wiring (TC-14 to TC-17).
//
// These tests use the REAL undo controller (App creates it exactly as in
// production); only the document is test-seeded. A "step" is observed through
// behaviour: one Ctrl/Cmd+Z must reverse exactly one user action — no more
// (partial reversals) and no less (two actions in one pop).

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import {
  fire,
  flushFrame,
  pointerEvent,
  pressKey,
  seed,
  objectEl,
  clickObject,
  shiftClickObject,
  row,
  rows,
  viewport,
  testDoc,
} from './harness';

const undoBtn = () => document.querySelector<HTMLButtonElement>('[data-testid="undo-button"]')!;
const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea[data-testid="sticky-textarea"]');

/** Double-click the empty background: creates a note there and opens its editor. */
function dblClickEmpty(x = 640, y = 400): void {
  fire(viewport(), pointerEvent('dblclick', x, y));
}

/** Type into the open editor the way the DOM does: one input event = one
 * transaction (the app-internal diffing makes character-level events one
 * replace; capture-window merging is unit-tested separately, TC-12). */
function type(text: string): void {
  act(() => {
    const ta = textarea()!;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TC-14 a whole multi-frame drag is one undo step', () => {
  it('30 frame-coalesced move transactions reverse in a single Ctrl/Cmd+Z', () => {
    render(<App />);
    const a = seed(100, 100);
    const b = seed(400, 300);
    clickObject(a);
    shiftClickObject(b);

    const before = { a: row(a), b: row(b) };
    // Drag both objects 30 frames (one write transaction per frame).
    fire(objectEl(a), pointerEvent('pointerdown', 100, 100));
    for (let i = 1; i <= 30; i++) {
      fire(window, pointerEvent('pointermove', 100 + i, 100 + i));
      flushFrame();
    }
    fire(window, pointerEvent('pointerup', 130, 130));

    expect(row(a).x).toBeCloseTo(before.a.x + 30, 3);
    expect(row(b).x).toBeCloseTo(before.b.x + 30, 3);

    // One undo: every object in the selection is back at its start position...
    expect(pressKey('z', window, { metaKey: true })).toBe(true);
    expect(row(a).x).toBeCloseTo(before.a.x, 3);
    expect(row(a).y).toBeCloseTo(before.a.y, 3);
    expect(row(b).x).toBeCloseTo(before.b.x, 3);
    expect(row(b).y).toBeCloseTo(before.b.y, 3);
    // ...and nothing is left: the drag was ONE step (seeding is not undoable).
    expect(undoBtn().disabled).toBe(true);
  });
});

describe('TC-15 a colour change after a drag is a separate step', () => {
  it('the gesture-end boundary keeps drag and recolour apart', () => {
    render(<App />);
    const a = seed(100, 100);
    const start = row(a).x;

    // Drag the note (step 1).
    fire(objectEl(a), pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 150, 100));
    flushFrame();
    fire(window, pointerEvent('pointerup', 150, 100));
    const dragged = row(a);
    expect(dragged.x).toBeCloseTo(start + 50, 3);

    // A moment later (inside the capture window in wall-clock terms) the
    // user picks a colour in the note toolbar — a second step, because the
    // gesture end closed the capture window.
    clickObject(a); // selection shows the note toolbar
    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Green colour"]')!.click();
    });

    // Undo 1 reverses ONLY the colour.
    expect(pressKey('z', window, { metaKey: true })).toBe(true);
    expect(document.querySelector('[aria-label="Green colour"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(row(a).x).toBeCloseTo(dragged.x, 3); // position untouched
    // Undo 2 reverses the drag itself.
    expect(pressKey('z', window, { metaKey: true })).toBe(true);
    expect(row(a).x).toBeCloseTo(start, 3);
  });
});

describe('TC-16 Ctrl+Z inside the text editor undoes typing, not the earlier move', () => {
  it('the editor intercepts the shortcut and pops only the typing step (negative: move survives)', () => {
    render(<App />);
    const a = seed(100, 100);

    // Step 1: move the note.
    const start = row(a).x;
    fire(objectEl(a), pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 140, 100));
    flushFrame();
    fire(window, pointerEvent('pointerup', 140, 100));

    // Step 2: open the editor (dblclick on the note) and type.
    fire(objectEl(a), pointerEvent('dblclick', 110, 10));
    expect(textarea()).not.toBeNull();
    type('hello');
    expect(getStickyText(testDoc(), a)!.toString()).toBe('hello');

    // Ctrl/Cmd+Z WHILE EDITING: the textarea's own handler routes it to the
    // controller — the typing burst is undone...
    const ta = textarea()!;
    expect(pressKey('z', ta, { ctrlKey: true })).toBe(true);
    expect(getStickyText(testDoc(), a)!.toString()).toBe('');
    // ...and the earlier move is NOT undone (negative assertion).
    expect(row(a).x).toBeCloseTo(start + 40, 3);
    expect(undoBtn().disabled).toBe(false); // the move step is still in history
  });
});

describe('TC-17 pointercancel mid-drag still leaves one undoable step (error path)', () => {
  it('the partially written drag reverses to the start position in one step', () => {
    render(<App />);
    const a = seed(100, 100);
    const before = row(a);

    fire(objectEl(a), pointerEvent('pointerdown', 100, 100));
    fire(window, pointerEvent('pointermove', 150, 150));
    flushFrame(); // the partial move is already committed to the doc
    const partial = row(a);
    expect(partial.x).toBeCloseTo(before.x + 50, 3);

    fire(window, pointerEvent('pointercancel', 150, 150));

    expect(pressKey('z', window, { metaKey: true })).toBe(true);
    expect(row(a).x).toBeCloseTo(before.x, 3);
    expect(row(a).y).toBeCloseTo(before.y, 3);
    expect(undoBtn().disabled).toBe(true); // exactly one step existed
  });
});

describe('TC-16 companion — remote changes are untouchable through the UI', () => {
  it('a remote text edit leaves the undo stack empty and Ctrl/Cmd+Z a no-op (negative)', () => {
    render(<App />);
    const a = seed(100, 100); // seeding is a non-local origin, like a remote change

    // "Someone else" edits the text straight on the document.
    act(() => {
      getStickyText(testDoc(), a)!.insert(0, 'remote text');
    });

    expect(undoBtn().disabled).toBe(true); // nothing of ours to undo
    expect(pressKey('z', window, { metaKey: true })).toBe(true); // preventDefault only
    expect(rows()).toHaveLength(1);
    expect(getStickyText(testDoc(), a)!.toString()).toBe('remote text'); // untouched
  });
});

describe('TC-17 companion — undoing a locally created, remotely deleted note', () => {
  it('skips the dead step without throwing and keeps the board working (error path)', () => {
    render(<App />);
    dblClickEmpty();
    expect(rows()).toHaveLength(1);
    const id = rows()[0].id;

    // A peer deletes the note before we ever press undo — a non-local
    // origin, the way a remote delete arrives.
    act(() => {
      testDoc().getMap('objects').delete(id);
    });
    expect(rows()).toHaveLength(0);

    // Undo must not resurrect the gone note and not throw: the step has no
    // effect and Yjs skips it (leaving the history empty).
    fire(undoBtn(), new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toHaveLength(0);
    expect(undoBtn().disabled).toBe(true);

    // And the board is still alive: a fresh local action works and is undoable.
    dblClickEmpty(300, 300);
    expect(rows()).toHaveLength(1);
    fire(undoBtn(), new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(rows()).toHaveLength(0);
  });
});
