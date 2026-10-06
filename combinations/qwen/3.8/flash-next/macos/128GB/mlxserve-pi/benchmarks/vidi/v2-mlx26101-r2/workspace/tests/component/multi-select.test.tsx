import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSticky, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model.js';
import { HANDLE_SIZE_PX, MAX_OBJECT_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config.js';
import { worldToScreen, type Point } from '../../src/client/canvas/camera.js';
import {
  board,
  boardDoc,
  camera,
  clickBoard,
  countDocumentWrites,
  docNotes,
  flushFrames,
  keydown,
  noteId,
  noteToolbarElement,
  pressKey,
  renderBoard,
} from './helpers.js';
import { addTestbox } from '../fixtures/testbox.js';

/**
 * Story 7 - selecting, moving, resizing and deleting several objects at once.
 *
 * These are the multi-object interactions: the set of selected objects grows and
 * shrinks (click, Shift-click, marquee, select-all, deselect), the whole set
 * moves and resizes together (drag, handle, keyboard), and Delete removes the
 * whole set. Selection is local (never in the document), writes are coalesced to
 * one transaction per animation frame, and the resize is generic enough that a
 * non-square, non-aspect-locked test-only type behaves correctly (the `testbox`).
 */

beforeEach(() => {
  renderBoard();
});

/* ----------------------------------------------------------- local helpers */

/** Add a sticky note at a world *centre*, returning its id. */
function addSticky(center: Point): string {
  let id = '';
  act(() => {
    id = createSticky(boardDoc(), center) as string;
  });
  flushFrames();
  return id;
}

/** A snapshot entry by id, whatever its type. */
function snapshotOf(id: string): ObjectSnapshot {
  const found = docNotes().find((object) => object.id === id);
  if (!found) throw new Error(`no object ${id} in the document`);
  return found;
}

/** The element that draws an object (sticky note or testbox). */
function el(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!element) throw new Error(`object ${id} is not rendered`);
  return element;
}

/** An object's centre on the screen, derived from the document and camera. */
function centre(id: string): Point {
  const bounds = objectBounds(snapshotOf(id));
  return worldToScreen(camera(), {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
}

/** The ids the board currently holds selected (in the DOM). */
function selectedIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"][data-selected="true"], [data-testid="testbox"][data-selected="true"]'),
  ).map((element) => element.dataset.noteId!);
}

function selectionCount(): string | null {
  return document.querySelector<HTMLElement>('[data-testid="selection-count"]')?.textContent ?? null;
}

function selectionBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="selection-bar"]');
}

function handleCount(): number {
  return document.querySelectorAll('[data-testid="resize-handle"]').length;
}

function pointer(p: Point, element: Element, extra: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...extra,
  });
  flushFrames();
}
function move(p: Point, element: Element, extra: Record<string, unknown> = {}): void {
  fireEvent.pointerMove(element, {
    pointerId: 1,
    pointerType: 'mouse',
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
    ...extra,
  });
  flushFrames();
}
function release(p: Point, element: Element): void {
  fireEvent.pointerUp(element, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: p.x,
    clientY: p.y,
  });
  flushFrames();
}

/** Replace the selection with one object (a plain press on it). */
function selectOne(id: string): void {
  const at = centre(id);
  pointer(at, el(id));
  release(at, el(id));
}

/** Add or remove one object from the selection (Shift-press). */
function toggle(id: string): void {
  const at = centre(id);
  pointer(at, el(id), { shiftKey: true });
  release(at, el(id));
}

/** Shift-drag on empty board space: the marquee. */
function marquee(from: Point, to: Point, steps = 3, cancel = false): void {
  pointer(from, board(), { shiftKey: true });
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    move({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, board(), {
      shiftKey: true,
    });
  }
  if (cancel) {
    fireEvent.pointerCancel(board(), {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: to.x,
      clientY: to.y,
    });
    flushFrames();
  } else {
    release(to, board());
  }
}

/** A screen-space rectangle just around a group of ids, padded by `margin`. */
function screenBox(ids: string[], margin: number): { from: Point; to: Point } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const bounds = objectBounds(snapshotOf(id));
    const a = worldToScreen(camera(), { x: bounds.x, y: bounds.y });
    const b = worldToScreen(camera(), { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    left = Math.min(left, a.x);
    top = Math.min(top, a.y);
    right = Math.max(right, b.x);
    bottom = Math.max(bottom, b.y);
  }
  return {
    from: { x: left - margin, y: top - margin },
    to: { x: right + margin, y: bottom + margin },
  };
}

/** Press a resize handle of the current selection and move it by `delta`. */
function dragHandle(handle: string, delta: Point, moves = 1): void {
  const node = document.querySelector<HTMLElement>(`[data-testid="resize-handle"][data-handle="${handle}"]`);
  if (!node) throw new Error(`no resize handle "${handle}" is shown`);
  const grab = {
    x: parseFloat(node.style.left) + HANDLE_SIZE_PX / 2,
    y: parseFloat(node.style.top) + HANDLE_SIZE_PX / 2,
  };
  pointer(grab, node);
  for (let step = 1; step <= moves; step += 1) {
    const t = step / moves;
    move({ x: grab.x + delta.x * t, y: grab.y + delta.y * t }, node);
  }
  release({ x: grab.x + delta.x, y: grab.y + delta.y }, node);
}

/* ------------------------------------------------------ TC-16: select all */

describe('select all (TC-16)', () => {
  it('Ctrl/Cmd+A selects every object and shows the selection bar', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    keydown('a', { ctrl: true });
    expect(selectedIds().sort()).toEqual([a, b].sort());
    expect(selectionCount()).toBe('2 selected');
  });

  it('Escape clears the selection', () => {
    addSticky({ x: -500, y: -300 });
    keydown('a', { ctrl: true });
    expect(selectedIds()).toHaveLength(1);
    keydown('Escape');
    expect(selectedIds()).toHaveLength(0);
  });
});

/* ------------------------------------------------------- TC-17: the marquee */

describe('marquee selection (TC-17, TC-20, TC-22)', () => {
  it('a marquee that fully covers two notes selects both', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    const box = screenBox([a, b], 40);
    marquee(box.from, box.to);
    expect(selectedIds().sort()).toEqual([a, b].sort());
  });

  it('a marquee that only overlaps part of a note leaves it unselected', () => {
    const a = addSticky({ x: -500, y: -300 });
    // Start in empty space, sweep only into the top-left corner of the note.
    const c = centre(a);
    marquee({ x: c.x - 200, y: c.y - 200 }, { x: c.x - 50, y: c.y - 50 });
    expect(selectedIds()).toEqual([]);
  });

  it('TC-20 a marquee after selecting adds to the selection', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    selectOne(a);
    expect(selectedIds()).toEqual([a]);
    const box = screenBox([a, b], 40);
    marquee(box.from, box.to);
    expect(selectedIds().sort()).toEqual([a, b].sort());
  });

  it('TC-22 cancelling a marquee mid-drag leaves the selection unchanged', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    selectOne(a);
    const box = screenBox([a, b], 40);
    marquee(box.from, box.to, 3, true);
    expect(selectedIds()).toEqual([a]);
  });

  it('a plain drag on empty space pans the board and starts no marquee', () => {
    addSticky({ x: -500, y: -300 });
    selectOne(noteId(0));
    const before = camera();
    pointer({ x: 400, y: 400 }, board());
    move({ x: 600, y: 500 }, board());
    release({ x: 600, y: 500 }, board());
    expect(document.querySelector('[data-testid="marquee-rect"]')).toBeNull();
    expect(camera().x).not.toBe(before.x);
    // The pan does not disturb the selection.
    expect(selectedIds()).toHaveLength(1);
  });
});

/* -------------------------------------------------- TC-18/TC-19: selection UI */

describe('selection chrome (TC-18, TC-19)', () => {
  it('one selected sticky shows its own toolbar; two selected show the bar instead', () => {
    const a = addSticky({ x: -500, y: -300 });
    selectOne(a);
    expect(noteToolbarElement()).not.toBeNull();
    expect(selectionBar()).toBeNull();

    const b = addSticky({ x: -100, y: -100 });
    const box = screenBox([a, b], 40);
    marquee(box.from, box.to);
    expect(selectedIds()).toHaveLength(2);
    expect(noteToolbarElement()).toBeNull();
    expect(selectionBar()).not.toBeNull();
    expect(selectionCount()).toBe('2 selected');
  });

  it('TC-19 clicking empty board space selects nothing', () => {
    const a = addSticky({ x: -500, y: -300 });
    selectOne(a);
    clickBoard({ x: 40, y: 700 });
    expect(selectedIds()).toEqual([]);
  });

  it('TC-19 Shift-clicking each selected object off leaves none selected', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    keydown('a', { ctrl: true });
    expect(selectedIds()).toHaveLength(2);
    toggle(a);
    toggle(b);
    expect(selectedIds()).toEqual([]);
  });
});

/* ---------------------------------------------------- TC-23/TC-26: group move */

describe('group move (TC-23, TC-26, TC-31)', () => {
  it('dragging one selected note moves every selected note by the same delta', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -200, y: -100 });
    keydown('a', { ctrl: true });
    const beforeA = objectBounds(snapshotOf(a));
    const beforeB = objectBounds(snapshotOf(b));

    // Drag A by (120, 60) screen px (zoom 1 = the same in world units).
    const from = centre(a);
    pointer(from, el(a));
    move({ x: from.x + 120, y: from.y + 60 }, el(a));
    release({ x: from.x + 120, y: from.y + 60 }, el(a));

    expect(objectBounds(snapshotOf(a)).x).toBeCloseTo(beforeA.x + 120, 1);
    expect(objectBounds(snapshotOf(a)).y).toBeCloseTo(beforeA.y + 60, 1);
    expect(objectBounds(snapshotOf(b)).x).toBeCloseTo(beforeB.x + 120, 1);
    expect(objectBounds(snapshotOf(b)).y).toBeCloseTo(beforeB.y + 60, 1);
  });

  it('a burst of moves coalesces into far fewer transactions than moves', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -200, y: -100 });
    keydown('a', { ctrl: true });

    const counter = countDocumentWrites();
    const beforeB = objectBounds(snapshotOf(b));
    const from = centre(a);
    pointer(from, el(a));
    // Twelve moves, but only ever settle once at the end so they coalesce.
    for (let step = 1; step <= 12; step += 1) {
      fireEvent.pointerMove(el(a), {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 1,
        clientX: from.x + step * 10,
        clientY: from.y,
      });
    }
    flushFrames();
    release({ x: from.x + 120, y: from.y }, el(a));
    counter.stop();

    expect(counter.writes()).toBeGreaterThan(0);
    // Twelve moves never become twelve writes (rAF coalescing, `sel.raf`).
    expect(counter.writes()).toBeLessThan(12);
    // The whole selection moved with it, in that same handful of transactions.
    expect(objectBounds(snapshotOf(b)).x).toBeCloseTo(beforeB.x + 120, 1);
  });

  it('TC-26 select-all then drag moves every object on the board', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -200, y: -100 });
    const c = addSticky({ x: 100, y: 100 });
    keydown('a', { ctrl: true });
    const before = [a, b, c].map((id) => ({ id, rect: objectBounds(snapshotOf(id)) }));
    const from = centre(c);
    pointer(from, el(c));
    move({ x: from.x + 50, y: from.y - 40 }, el(c));
    release({ x: from.x + 50, y: from.y - 40 }, el(c));
    for (const { id, rect } of before) {
      expect(objectBounds(snapshotOf(id)).x).toBeCloseTo(rect.x + 50, 1);
      expect(objectBounds(snapshotOf(id)).y).toBeCloseTo(rect.y - 40, 1);
    }
  });

  it('TC-31 arrow keys nudge the whole selection, Shift makes it larger', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -200, y: -100 });
    keydown('a', { ctrl: true });
    const startA = objectBounds(snapshotOf(a));
    const startB = objectBounds(snapshotOf(b));

    keydown('ArrowRight');
    expect(objectBounds(snapshotOf(a)).x).toBeCloseTo(startA.x + 1, 6);
    expect(objectBounds(snapshotOf(b)).x).toBeCloseTo(startB.x + 1, 6);

    keydown('ArrowDown', { shift: true });
    // The arrow moved x only; the Shift arrow moves y by the large step.
    expect(objectBounds(snapshotOf(a)).y).toBeCloseTo(startA.y + 10, 6);
    expect(objectBounds(snapshotOf(b)).y).toBeCloseTo(startB.y + 10, 6);
  });
});

/* -------------------------------------------------- TC-24/25/27/28: resizing */

describe('resize (TC-24, TC-25, TC-27, TC-28)', () => {
  it('TC-24 the selection shows eight Resize-labelled handles on the union box', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -100, y: -100 });
    selectOne(a);
    expect(handleCount()).toBe(8);
    for (const node of Array.from(document.querySelectorAll('[data-testid="resize-handle"]'))) {
      expect(node.getAttribute('aria-label')).toMatch(/^Resize /u);
    }
    // Two selected share ONE set of eight handles (the union box), not sixteen.
    toggle(b);
    expect(selectedIds()).toHaveLength(2);
    expect(handleCount()).toBe(8);
  });

  it('TC-24 an edge handle changes one axis on a non-aspect-locked type', () => {
    let box = '';
    act(() => {
      box = addTestbox(boardDoc(), { x: 0, y: 0 }, { width: 100, height: 80 });
    });
    flushFrames();
    selectOne(box);
    const before = objectBounds(snapshotOf(box));
    dragHandle('e', { x: 60, y: 0 });
    const after = objectBounds(snapshotOf(box));
    expect(after.width).toBeCloseTo(before.width + 60, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
  });

  it('TC-25 two notes shrink together and stop at the minimum size', () => {
    const a = addSticky({ x: -500, y: -300 });
    const b = addSticky({ x: -200, y: -100 });
    keydown('a', { ctrl: true });
    // Shrink the union box by far more than its size through the SE corner.
    dragHandle('se', { x: -1000, y: -1000 });
    for (const id of [a, b]) {
      const bounds = objectBounds(snapshotOf(id));
      expect(bounds.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
      expect(bounds.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
    }
  });

  it('TC-27 one sticky stays square through a corner handle', () => {
    const a = addSticky({ x: -500, y: -300 });
    selectOne(a);
    expect(handleCount()).toBe(8);
    dragHandle('se', { x: 100, y: 40 });
    const bounds = objectBounds(snapshotOf(a));
    expect(bounds.width).toBeCloseTo(bounds.height, 1);
    expect(bounds.width).toBeCloseTo(STICKY_SIZE_WORLD + 100, 1);
  });

  it('TC-28 a resize stops at the global maximum size', () => {
    const a = addSticky({ x: -500, y: -300 });
    selectOne(a);
    dragHandle('se', { x: 100000, y: 100000 });
    const bounds = objectBounds(snapshotOf(a));
    expect(bounds.width).toBeLessThanOrEqual(MAX_OBJECT_SIZE_WORLD + 0.5);
    expect(bounds.width).toBeCloseTo(MAX_OBJECT_SIZE_WORLD, 0);
  });
});

/* ------------------------------------------------- TC-29/TC-30: group delete */

describe('group delete (TC-29, TC-30)', () => {
  it('TC-29 the selection bar Delete button removes the whole selection', () => {
    addSticky({ x: -500, y: -300 });
    addSticky({ x: -100, y: -100 });
    keydown('a', { ctrl: true });
    expect(selectedIds()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(docNotes()).toHaveLength(0);
    expect(selectedIds()).toHaveLength(0);
  });

  it('TC-30 Delete removes every selected object', () => {
    addSticky({ x: -500, y: -300 });
    addSticky({ x: -100, y: -100 });
    keydown('a', { ctrl: true });
    keydown('Delete');
    expect(docNotes()).toHaveLength(0);
  });

  it('TC-30 Backspace removes a single selected object', () => {
    const a = addSticky({ x: -500, y: -300 });
    selectOne(a);
    pressKey('Backspace', el(a));
    expect(docNotes()).toHaveLength(0);
  });
});
