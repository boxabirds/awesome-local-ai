/**
 * Story 7 component tests: selecting several objects, the selection bar, the marquee,
 * group move and the board's keyboard commands.
 *
 * These drive the real component tree in jsdom — the viewport, the registry, the gesture
 * hook, the overlay and the keys — and assert against what the document stored, because
 * the document is what the other people on the board see. Notes are put into the document
 * directly rather than clicked into existence: what is under test is what happens to
 * objects that are already there, and a test that made each note through the tool would be
 * testing story 2 fifty times.
 *
 * jsdom has no layout, so a note's screen position is computed from the camera rather than
 * measured (`screenPointOf`) — the same maths the components use.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, createSticky, deleteObject, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD
} from '../../src/shared/config';
import { worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  CENTRE,
  fireKey,
  firePointer,
  flushCameraFrame,
  flushFrames,
  noteToolbar,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  viewportElement
} from './harness';

interface BoardFixture {
  doc: Y.Doc;
  result: RenderResult;
  root: HTMLElement;
  /** Every object on the board, bottom to top. */
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return {
    doc,
    result,
    root: result.container,
    objects: () => boardObjects(doc)
  };
}

/** Put an object on the board, as another client's write would. */
function addNote(board: BoardFixture, world: Point): string {
  let id = '';
  act(() => {
    id = createSticky(board.doc, world);
  });
  return id;
}

/** Put several notes on the board at once. */
function addNotes(board: BoardFixture, points: Point[]): string[] {
  return points.map((point) => addNote(board, point));
}

/** The screen point in the middle of an object, as the camera sees it. */
function screenPointOf(object: ObjectSnapshot): Point {
  const bounds = objectBounds(object);
  return worldToScreen(testCamera(), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

/** Where a world point lands on the screen. */
function toScreen(point: Point): Point {
  return worldToScreen(testCamera(), point);
}

/** The rendered element of one object. */
function objectElement(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!element) throw new Error(`object ${id} is not on screen`);
  return element;
}

function objectById(board: BoardFixture, id: string): ObjectSnapshot {
  const object = board.objects().find((candidate) => candidate.id === id);
  if (!object) throw new Error(`object ${id} is not on the board`);
  return object;
}

/** Press and release an object without moving: a click, or a Shift-click. */
function clickObject(board: BoardFixture, id: string, shift = false): void {
  const element = objectElement(board, id);
  const point = screenPointOf(objectById(board, id));
  firePointer(element, 'pointerdown', point.x, point.y, { shiftKey: shift });
  firePointer(element, 'pointerup', point.x, point.y, { shiftKey: shift });
}

/** Press on an element, move in steps, and release, letting each frame's write land. */
async function drag(
  target: Element,
  from: Point,
  to: Point,
  options: { shift?: boolean; steps?: number } = {}
): Promise<void> {
  firePointer(target, 'pointerdown', from.x, from.y, { shiftKey: options.shift });
  const steps = options.steps ?? 4;
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      target,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
      { shiftKey: options.shift }
    );
    await flushFrames();
  }
  firePointer(target, 'pointerup', to.x, to.y, { shiftKey: options.shift });
  await flushFrames();
}

/** Drag an object from its own middle by a screen-space offset. */
function dragObjectBy(board: BoardFixture, id: string, dx: number, dy: number): Promise<void> {
  const start = screenPointOf(objectById(board, id));
  return drag(objectElement(board, id), start, { x: start.x + dx, y: start.y + dy });
}

/** The selection bar, or null when none is shown. */
function selectionBar(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-vidi6="selection-bar"]');
}

function selectionText(root: HTMLElement): string {
  return selectionBar(root)?.querySelector('[data-testid="selection-count"]')?.textContent ?? '';
}

/** The live region that says the count to a screen reader. */
function selectionLive(root: HTMLElement): Element | null {
  return root.querySelector('[data-testid="selection-live"]');
}

function selectionDelete(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-vidi6="selection-delete"]');
}

function marqueeElement(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-vidi6="marquee"]');
}

function handle(root: HTMLElement, name: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-vidi6="resize-handle"][data-handle="${name}"]`);
}

/** Every object's top-left, in the order the board draws them. */
function positionsOf(board: BoardFixture): { x: number; y: number }[] {
  return board.objects().map((object) => ({ x: object.x, y: object.y }));
}

/** Three notes, well apart, bottom to top: a, b, c. */
const SPOTS = [
  { x: -600, y: 0 },
  { x: 0, y: 0 },
  { x: 600, y: 0 },
  { x: 0, y: 600 }
];

describe('selecting several objects (sel.interaction)', () => {
  it('TC-17: two selected objects show "2 selected" and a delete button', async () => {
    const board = await renderBoard();
    const [a, b] = addNotes(board, [SPOTS[0], SPOTS[1]]);

    clickObject(board, a);
    clickObject(board, b, true);

    expect(selectionText(board.root)).toBe('2 selected');
    expect(selectionDelete(board.root)).not.toBeNull();
    // Announced politely, so a screen reader says it without interrupting.
    expect(selectionLive(board.root)?.getAttribute('aria-live')).toBe('polite');
    expect(selectionLive(board.root)?.textContent).toBe('2 selected');
    // Each selected object says so about itself, which is how it gets its outline.
    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(objectElement(board, b).dataset.selected).toBe('true');
  });

  it('TC-18: one selected sticky note gets its own toolbar instead of the bar', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);

    clickObject(board, a);

    expect(selectionBar(board.root)).toBeNull();
    expect(noteToolbar(objectElement(board, a))).not.toBeNull();

    // And the bar takes over the moment a second object joins.
    const [, b] = board.objects();
    clickObject(board, b ? b.id : addNote(board, SPOTS[1]), true);
    expect(selectionBar(board.root)).not.toBeNull();
    expect(noteToolbar(objectElement(board, a))).toBeNull();
  });

  it('Shift-click removes one object and keeps the rest selected', async () => {
    const board = await renderBoard();
    const [a, b, c] = addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);

    clickObject(board, a);
    clickObject(board, b, true);
    clickObject(board, c, true);
    expect(selectionText(board.root)).toBe('3 selected');

    clickObject(board, b, true);

    expect(selectionText(board.root)).toBe('2 selected');
    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(objectElement(board, b).dataset.selected).toBe('false');
    expect(objectElement(board, c).dataset.selected).toBe('true');
  });

  it('TC-19: a click on empty board space clears the selection', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });
    expect(selectionText(board.root)).toBe('2 selected');

    // A press on empty space that never moved: a click, not a pan.
    firePointer(viewportElement(board.root), 'pointerdown', CENTRE.x, CENTRE.y);
    firePointer(viewportElement(board.root), 'pointerup', CENTRE.x, CENTRE.y);

    expect(selectionBar(board.root)).toBeNull();
    expect(board.root.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    expect(selectionLive(board.root)?.textContent).toBe('');
  });

  it('TC-16: an object deleted by somebody else leaves the selection', async () => {
    const board = await renderBoard();
    const [a, b, c] = addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);
    clickObject(board, a);
    clickObject(board, b, true);
    clickObject(board, c, true);
    expect(selectionText(board.root)).toBe('3 selected');

    // Another person deletes `b`: this client is not told, the document just changes.
    act(() => {
      deleteObject(board.doc, b);
    });

    expect(selectionText(board.root)).toBe('2 selected');
    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(objectElement(board, c).dataset.selected).toBe('true');
  });

  it('every object deleted by everybody else leaves no selection and no bar', async () => {
    const board = await renderBoard();
    const [a, b] = addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { metaKey: true });
    expect(selectionText(board.root)).toBe('2 selected');

    act(() => {
      deleteObject(board.doc, a);
      deleteObject(board.doc, b);
    });

    expect(selectionBar(board.root)).toBeNull();
    expect(selectionLive(board.root)?.textContent).toBe('');
  });

  it('the selection bounding box has eight handles with accessible names', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });

    const handles = Array.from(board.root.querySelectorAll<HTMLElement>('[data-vidi6="resize-handle"]'));
    expect(handles).toHaveLength(8);
    expect(handles.map((element) => element.getAttribute('aria-label'))).toEqual([
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left'
    ]);
  });
});

describe('selecting with a box (sel.marquee)', () => {
  it('TC-20: Shift+drag adds the objects inside the box to the selection', async () => {
    const board = await renderBoard();
    const [a, b, c] = addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);
    // `a` is already selected by hand; the marquee is drawn around `b`.
    clickObject(board, a);

    const middle = toScreen(SPOTS[1]);
    const box = { x0: middle.x - 200, y0: middle.y - 200, x1: middle.x + 200, y1: middle.y + 200 };
    const viewport = viewportElement(board.root);
    firePointer(viewport, 'pointerdown', box.x0, box.y0, { shiftKey: true });
    firePointer(viewport, 'pointermove', box.x1, box.y1, { shiftKey: true });
    expect(marqueeElement(board.root)).not.toBeNull();
    firePointer(viewport, 'pointerup', box.x1, box.y1, { shiftKey: true });

    expect(selectionText(board.root)).toBe('2 selected');
    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(objectElement(board, b).dataset.selected).toBe('true');
    // `c`, 600 units away, was never inside.
    expect(objectElement(board, c).dataset.selected).toBe('false');
    expect(marqueeElement(board.root)).toBeNull();
  });

  it('only an object lying entirely inside the box is selected', async () => {
    const board = await renderBoard();
    const [a, b] = addNotes(board, [SPOTS[0], SPOTS[1]]);
    const insideScreen = toScreen(SPOTS[0]);
    const viewport = viewportElement(board.root);

    // A box whose right edge stops halfway across `b`, which starts 500 units to the
    // right of `a`'s centre and is 200 units wide.
    const cut = toScreen({ x: SPOTS[1].x - STICKY_SIZE_WORLD / 4, y: SPOTS[1].y });
    firePointer(viewport, 'pointerdown', insideScreen.x - 400, insideScreen.y - 400, { shiftKey: true });
    firePointer(viewport, 'pointermove', cut.x, insideScreen.y + 400, { shiftKey: true });
    firePointer(viewport, 'pointerup', cut.x, insideScreen.y + 400, { shiftKey: true });

    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(objectElement(board, b).dataset.selected).toBe('false');
  });

  it('TC-21: a drag without Shift pans the board and draws no box', async () => {
    const board = await renderBoard();
    const before = testCamera();
    const viewport = viewportElement(board.root);

    firePointer(viewport, 'pointerdown', CENTRE.x, CENTRE.y);
    firePointer(viewport, 'pointermove', CENTRE.x + 120, CENTRE.y + 40);
    firePointer(viewport, 'pointerup', CENTRE.x + 120, CENTRE.y + 40);
    await flushFrames();

    expect(marqueeElement(board.root)).toBeNull();
    expect(testCamera()).not.toEqual(before);
  });

  it('TC-22: a marquee whose pointer is taken away changes nothing', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    clickObject(board, a);
    const viewport = viewportElement(board.root);
    const middle = toScreen(SPOTS[1]);

    firePointer(viewport, 'pointerdown', middle.x - 200, middle.y - 200, { shiftKey: true });
    firePointer(viewport, 'pointermove', middle.x + 200, middle.y + 200, { shiftKey: true });
    expect(marqueeElement(board.root)).not.toBeNull();
    firePointer(viewport, 'pointercancel', middle.x + 200, middle.y + 200, { shiftKey: true });

    expect(marqueeElement(board.root)).toBeNull();
    expect(objectElement(board, a).dataset.selected).toBe('true');
    expect(board.root.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
  });

  it('Escape during a marquee throws the box away without clearing the selection', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    clickObject(board, a);
    const viewport = viewportElement(board.root);
    const middle = toScreen(SPOTS[1]);

    firePointer(viewport, 'pointerdown', middle.x - 200, middle.y - 200, { shiftKey: true });
    firePointer(viewport, 'pointermove', middle.x + 200, middle.y + 200, { shiftKey: true });
    fireKey('Escape');
    firePointer(viewport, 'pointerup', middle.x + 200, middle.y + 200, { shiftKey: true });

    expect(marqueeElement(board.root)).toBeNull();
    expect(objectElement(board, a).dataset.selected).toBe('true');
  });

  it('a marquee over an empty board selects nothing and leaves nothing on screen', async () => {
    const board = await renderBoard();
    const viewport = viewportElement(board.root);

    firePointer(viewport, 'pointerdown', 100, 100, { shiftKey: true });
    firePointer(viewport, 'pointermove', 400, 400, { shiftKey: true });
    firePointer(viewport, 'pointerup', 400, 400, { shiftKey: true });

    expect(marqueeElement(board.root)).toBeNull();
    expect(selectionBar(board.root)).toBeNull();
  });
});

describe('moving a selection (sel.group_move, sel.drag_unselected)', () => {
  it('TC-23: dragging an unselected object selects only it and moves only it', async () => {
    const board = await renderBoard();
    const [a, b] = addNotes(board, [SPOTS[0], SPOTS[1]]);
    clickObject(board, a);
    const before = positionsOf(board);

    await dragObjectBy(board, b, 150, 0);

    expect(objectById(board, b).x).toBeCloseTo(before[1].x + 150, 6);
    expect(objectById(board, a).x).toBeCloseTo(before[0].x, 6);
    expect(objectElement(board, a).dataset.selected).toBe('false');
    expect(objectElement(board, b).dataset.selected).toBe('true');
  });

  it('dragging one object of a selection moves them all, keeping their arrangement', async () => {
    const board = await renderBoard();
    const [a, b, c] = addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);
    clickObject(board, a);
    clickObject(board, b, true);
    clickObject(board, c, true);
    const before = positionsOf(board);

    await dragObjectBy(board, b, 200, 120);

    board.objects().forEach((object, index) => {
      expect(object.x).toBeCloseTo(before[index].x + 200, 6);
      expect(object.y).toBeCloseTo(before[index].y + 120, 6);
    });
  });

  it('a moved selection goes above the objects it is dragged over, in its own order', async () => {
    const board = await renderBoard();
    // `a` under `b`, and `other` on top of everything, far away.
    const [a, b, other] = addNotes(board, [
      { x: -120, y: 0 },
      { x: -60, y: 0 },
      { x: 3000, y: 3000 }
    ]);
    expect(board.objects().map((object) => object.id)).toEqual([a, b, other]);
    clickObject(board, a);
    clickObject(board, b, true);

    await dragObjectBy(board, a, 600, 0);

    // The two moved notes are now on top, and `a` is still under `b`.
    expect(board.objects().map((object) => object.id)).toEqual([other, a, b]);
  });

  it('a press that never passes the drag threshold is a click, not a move', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    const before = objectById(board, a);
    const element = objectElement(board, a);
    const start = screenPointOf(before);

    firePointer(element, 'pointerdown', start.x, start.y);
    firePointer(element, 'pointermove', start.x + DRAG_THRESHOLD_PX - 1, start.y);
    await flushFrames();
    firePointer(element, 'pointerup', start.x + DRAG_THRESHOLD_PX - 1, start.y);

    expect(objectById(board, a).x).toBeCloseTo(before.x, 6);
    expect(objectElement(board, a).dataset.selected).toBe('true');
  });
});

describe('keyboard commands (sel.keyboard)', () => {
  it('TC-27: Ctrl+A selects every object and does not select the page text', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);

    const event = fireKey('a', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(selectionText(board.root)).toBe('3 selected');
    expect(board.root.ownerDocument.defaultView?.getSelection()?.toString() ?? '').toBe('');
    // Cmd works too, on the keyboards where that is the key.
    fireKey('a', { metaKey: true });
    expect(selectionText(board.root)).toBe('3 selected');
  });

  it('TC-28: Ctrl+A on an empty board selects nothing and is not an error', async () => {
    const board = await renderBoard();

    fireKey('a', { ctrlKey: true });

    expect(selectionBar(board.root)).toBeNull();
    expect(selectionLive(board.root)?.textContent).toBe('');
  });

  it('Ctrl+A is left to the browser while typing in a note', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    // Open the editor the way a user does, then press Ctrl+A inside its textarea.
    clickObject(board, a);
    fireKey('Enter');
    const textarea = board.root.querySelector<HTMLTextAreaElement>('[data-testid="sticky-input"]');
    if (!textarea) throw new Error('the note is not being edited');

    const event = fireKey('a', { ctrlKey: true, target: textarea });

    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-29: arrows nudge the selection by the small step, Shift by the large one', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });
    const before = positionsOf(board);

    const right = fireKey('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    board.objects().forEach((object, index) => {
      expect(object.x).toBeCloseTo(before[index].x + NUDGE_STEP_WORLD, 6);
      expect(object.y).toBeCloseTo(before[index].y, 6);
    });

    const up = fireKey('ArrowUp', { shiftKey: true });
    expect(up.defaultPrevented).toBe(true);
    board.objects().forEach((object, index) => {
      expect(object.x).toBeCloseTo(before[index].x + NUDGE_STEP_WORLD, 6);
      expect(object.y).toBeCloseTo(before[index].y - NUDGE_LARGE_STEP_WORLD, 6);
    });
  });

  it('arrows with nothing selected are left to the page', async () => {
    await renderBoard();

    const event = fireKey('ArrowRight');

    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-31: Delete removes every selected object and clears the selection', async () => {
    const board = await renderBoard();
    const [a, b, c] = addNotes(board, [SPOTS[0], SPOTS[1], SPOTS[2]]);
    clickObject(board, a);
    clickObject(board, c, true);

    const event = fireKey('Delete');

    expect(event.defaultPrevented).toBe(true);
    expect(board.objects().map((object) => object.id)).toEqual([b]);
    expect(selectionBar(board.root)).toBeNull();
    expect(selectionLive(board.root)?.textContent).toBe('');
  });

  it('Backspace deletes the selection too', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });

    fireKey('Backspace');

    expect(board.objects()).toHaveLength(0);
  });

  it('the bar’s Delete button removes the selection', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });

    act(() => {
      selectionDelete(board.root)?.click();
    });

    expect(board.objects()).toHaveLength(0);
    expect(selectionBar(board.root)).toBeNull();
  });

  it('TC-30: Backspace inside a note edits its text and deletes nothing', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    clickObject(board, a);
    fireKey('Enter');
    const textarea = board.root.querySelector<HTMLTextAreaElement>('[data-testid="sticky-input"]');
    if (!textarea) throw new Error('Enter did not open the note for editing');

    const event = fireKey('Backspace', { target: textarea });

    expect(event.defaultPrevented).toBe(false);
    expect(board.objects()).toHaveLength(1);
    expect(objectElement(board, a).dataset.selected).toBe('true');
  });

  it('Escape closes the editor and then clears the selection', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    clickObject(board, a);
    fireKey('Enter');
    expect(board.root.querySelector('[data-testid="sticky-input"]')).not.toBeNull();

    const editor = board.root.querySelector('[data-testid="sticky-input"]');
    if (!editor) throw new Error('Enter did not open the note for editing');
    fireKey('Escape', { target: editor });
    fireKey('Escape');

    expect(board.root.querySelector('[data-testid="sticky-input"]')).toBeNull();
    expect(objectElement(board, a).dataset.selected).toBe('false');
  });

  it('Enter opens the single selected sticky note for editing', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0]]);
    clickObject(board, a);

    fireKey('Enter');

    expect(board.root.querySelector('[data-testid="sticky-input"]')).not.toBeNull();
    expect(objectElement(board, a).dataset.interaction).toBe('editing');
  });

  it('Enter with two objects selected does nothing', async () => {
    const board = await renderBoard();
    addNotes(board, [SPOTS[0], SPOTS[1]]);
    fireKey('a', { ctrlKey: true });

    fireKey('Enter');

    expect(board.root.querySelector('[data-testid="sticky-input"]')).toBeNull();
  });
});

describe('resizing the selection (sel.resize)', () => {
  it('resizing a note keeps it square and spreads the notes apart', async () => {
    const board = await renderBoard();
    const [a] = addNotes(board, [SPOTS[0], SPOTS[1]]);
    clickObject(board, a);
    const before = objectById(board, a);
    const beforeBounds = objectBounds(before);

    const corner = handle(board.root, 'se');
    if (!corner) throw new Error('no bottom-right handle');
    await drag(corner, { x: 100, y: 100 }, { x: 200, y: 200 });

    const after = objectBounds(objectById(board, a));
    expect(after.width).toBeCloseTo(beforeBounds.width + 100, 6);
    expect(after.height).toBeCloseTo(after.width, 6);
  });

  it('a note made before story 7 is resizable at its default size', async () => {
    const board = await renderBoard();
    // A document written by the previous build: no width, no height.
    const id = 'legacy-note';
    act(() => {
      const objects = board.doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
      const note = new Y.Map<unknown>();
      note.set('type', 'sticky');
      note.set('x', SPOTS[0].x - STICKY_SIZE_WORLD / 2);
      note.set('y', SPOTS[0].y - STICKY_SIZE_WORLD / 2);
      note.set('z', 1);
      note.set('color', 'yellow');
      objects.set(id, note);
    });

    const before = objectBounds(objectById(board, id));
    expect(before.width).toBe(STICKY_SIZE_WORLD);

    clickObject(board, id);
    const corner = handle(board.root, 'se');
    if (!corner) throw new Error('a note with no stored size has no resize handle');
    await drag(corner, { x: 50, y: 50 }, { x: 150, y: 150 });

    const after = board.objects().find((object) => object.id === id);
    expect(after?.width).toBeCloseTo(STICKY_SIZE_WORLD + 100, 6);
    expect(after?.height).toBeCloseTo(STICKY_SIZE_WORLD + 100, 6);
  });
});


