// Story 11, tasks.md task 5 — the stroke object: rendering, selection by line, and a
// remote delete (TC-15, TC-16, TC-21), component.
//
// As in the other component suites: the real `BoardApp` over a `Y.Doc` mounted directly,
// and jsdom's zero-sized rectangles mean a screen point and the board point under it are
// the same numbers at the identity camera.
//
// jsdom does no hit testing of its own — an event goes exactly where the test puts it —
// so "a click inside the box but away from the line falls through" is asserted twice over:
// against the registry's `hitTest`, which is the promise the board's own marquee and
// future lasso use, and against the DOM, where the fall-through is real because the
// stroke's root element takes no pointer and only its line does.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { getObjectType } from '../../src/client/objects/registry.tsx';
import {
  deleteObjects,
  initDoc,
  objectSnapshots,
  createSticky,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import {
  createStroke,
  scaledPoints,
  strokeSnapshot,
  strokeSnapshots,
  type PenColor,
  type PenThickness,
  type StrokeSnap,
} from '../../src/shared/objects/stroke.ts';
import { smoothPath } from '../../src/shared/geometry/simplify.ts';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';
import type { Point } from '../../src/shared/geometry.ts';

let doc: Y.Doc;
let undo: UndoController;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new Y.Doc();
  initDoc(doc);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount() {
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
}

const world = () => screen.getByTestId('world-layer') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const pressed = (name: string) => toolButton(name).getAttribute('aria-pressed');

function firePointer(target: EventTarget, type: string, x = 20, y = 20) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
function write<T>(fn: () => T): T {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
}

/** A stroke written straight through the model, as a fixture. */
const mkStroke = (
  points: readonly Point[],
  color: PenColor = 'black',
  thickness: PenThickness = 'thin',
) => createStroke(doc, { points, color, thickness }, 'someone-else')!;

const strokeEl = (id: string) => world().querySelector(`[data-stroke-id="${id}"]`) as HTMLElement;
const hitPath = (id: string) =>
  strokeEl(id).querySelector('[data-testid="stroke-hit-area"]') as SVGPathElement;
const linePath = (id: string) =>
  strokeEl(id).querySelector('[data-testid="stroke-path"]') as SVGPathElement;
const snap = (id: string): StrokeSnap => strokeSnapshot(doc, id)!;
/** Press on something and let go: what a click is at the identity camera. */
const clickOn = (el: Element, x: number, y: number) => {
  firePointer(el, 'pointerdown', x, y);
  firePointer(window, 'pointerup', x, y);
};
const spec = () => getObjectType('stroke')!;

/** A straight horizontal line 400 units long, 2 units thick. */
const RULE: Point[] = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
];
/** A U: a 400 x 400 box whose line is a long way from its own centre. */
const HOOK: Point[] = [
  { x: 100, y: 100 },
  { x: 100, y: 500 },
  { x: 500, y: 500 },
  { x: 500, y: 100 },
];

describe('story 11 stroke hit test (TC-15)', () => {
  it('the registry holds a stroke type that resizes proportionally and holds no text', () => {
    const s = spec();
    expect(s).toBeTruthy();
    expect(s.resizable).toBe(true);
    expect(s.aspectLocked).toBe(true);
    expect(s.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(s.editableText).toBe(false);
    expect(typeof s.hitTest).toBe('function');
  });

  it('a point 5 px from the line hits and 7 px misses, at 100% zoom', () => {
    const id = mkStroke(RULE);
    mount();
    const o = snap(id);
    expect(scaledPoints(o)[0]).toEqual({ x: 100, y: 100 });
    expect(spec().hitTest(o, { x: 300, y: 100 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 105 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 107 }, 1)).toBe(false);
    // Above and below alike: the line is a line, not a half-plane.
    expect(spec().hitTest(o, { x: 300, y: 95 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 93 }, 1)).toBe(false);
  });

  it('the tolerance is screen pixels, so 200% zoom is half as many board units', () => {
    const id = mkStroke(RULE);
    mount();
    const o = snap(id);
    // At 200% a click tolerance of 6 px is 3 board units: 2.9 units (5.8 px) is on the
    // line, 3.5 units (7 px) is not.
    expect(spec().hitTest(o, { x: 300, y: 102.9 }, 2)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 103.5 }, 2)).toBe(false);
    // And the same board points at 100%: both are inside 6 units.
    expect(spec().hitTest(o, { x: 300, y: 102.9 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 103.5 }, 1)).toBe(true);
  });

  it('the click tolerance ends exactly where it is stated to end', () => {
    const id = mkStroke(RULE);
    mount();
    const o = snap(id);
    expect(STROKE_HIT_TOLERANCE_PX).toBe(6);
    expect(spec().hitTest(o, { x: 300, y: 105.9 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 300, y: 106.1 }, 1)).toBe(false);
  });

  it('a thick stroke is its own tolerance: its paint is a wider target than a click', () => {
    const thin = mkStroke(RULE, 'black', 'thin');
    const fat = mkStroke(RULE, 'black', 'thick');
    mount();
    // Half of an 8-unit stroke is 4 board units, which is more than the 3 units six
    // screen pixels are at 200% zoom: the same point is inside the thick stroke's paint
    // and beside the thin one's line.
    expect(spec().hitTest(snap(fat), { x: 300, y: 103.5 }, 2)).toBe(true);
    expect(spec().hitTest(snap(thin), { x: 300, y: 103.5 }, 2)).toBe(false);
    // At 100% zoom the click tolerance (6 units) is the wider of the two, so both are hit.
    expect(spec().hitTest(snap(fat), { x: 300, y: 103.5 }, 1)).toBe(true);
    expect(spec().hitTest(snap(thin), { x: 300, y: 103.5 }, 1)).toBe(true);
  });

  it('a dot is hit by landing on it and missed beside it', () => {
    const id = mkStroke([{ x: 250, y: 250 }], 'black', 'thick');
    mount();
    const o = snap(id);
    expect(scaledPoints(o).length).toBe(1);
    expect(spec().hitTest(o, { x: 252, y: 252 }, 1)).toBe(true);
    expect(spec().hitTest(o, { x: 260, y: 250 }, 1)).toBe(false);
  });

  it('a stroke whose points are unusable hits nothing and renders no line', () => {
    const id = mkStroke(HOOK);
    mount();
    // A corrupt write is not a stroke anybody can select: the board must not throw and
    // must not select an empty line either.
    const broken = write(() => {
      const o = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
      o.set('points', [1, 2, 3]);
      return objectSnapshots(doc).find((s) => s.id === id)! as ObjectSnapshot;
    });
    expect(spec().hitTest(broken, { x: 100, y: 300 }, 1)).toBe(false);
    expect(strokeSnapshots(doc)[0]!.points.length).toBe(0);
  });
});

describe('story 11 select by line, not by box (TC-16)', () => {
  it('the line takes the click and the box does not', () => {
    const noteId = createSticky(doc, { x: 250, y: 250 });
    const id = mkStroke(HOOK);
    mount();
    const o = snap(id);
    // The stroke's box is the whole 400 x 400; its centre is nowhere near its line.
    expect({ x: o.x, y: o.y, width: o.width, height: o.height }).toEqual({
      x: 99,
      y: 99,
      width: 402,
      height: 402,
    });
    expect(spec().hitTest(o, { x: 300, y: 300 }, 1)).toBe(false);
    expect(spec().hitTest(o, { x: 100, y: 300 }, 1)).toBe(true);

    // A click in the middle of the box, where the note is: the note is selected, the
    // stroke is not. In a browser the click reaches the note because the stroke's root
    // element takes no pointer; the test puts it there.
    clickOn(world().querySelector(`[data-note-id="${noteId}"]`)!, 300, 300);
    expect(strokeEl(id).getAttribute('data-selected')).toBe('false');
    expect(world().querySelector(`[data-note-id="${noteId}"]`)!.getAttribute('data-selected')).toBe(
      'true',
    );

    // A click on the stroke's own line selects the stroke and lets the note go.
    clickOn(hitPath(id), 100, 300);
    expect(strokeEl(id).getAttribute('data-selected')).toBe('true');
    expect(world().querySelector(`[data-note-id="${noteId}"]`)!.getAttribute('data-selected')).toBe(
      'false',
    );
    // The line the click landed on is the line that is painted: same path data.
    expect(hitPath(id).getAttribute('d')).toBe(linePath(id).getAttribute('d'));
  });

  it('a selected stroke shows a selection line and keeps its own thickness', () => {
    const id = mkStroke(HOOK, 'red', 'medium');
    mount();
    clickOn(hitPath(id), 100, 300);
    const selection = strokeEl(id).querySelector('[data-testid="stroke-selection"]') as SVGPathElement;
    expect(selection).toBeTruthy();
    const line = linePath(id);
    // The paint is the stroke's own colour and width; the selection is a separate line.
    expect(line.getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    expect(selection.getAttribute('stroke-width')).not.toBe(String(PEN_THICKNESS_WORLD.medium));
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
    // It is a path through the scaled points, in board units inside a viewBox of the box.
    expect(line.getAttribute('d')).toBe(smoothPath(scaledPoints(snap(id))));
    expect(strokeEl(id).getAttribute('viewBox')).toBe('98 98 404 404');
    // It is announced as a drawing.
    expect(strokeEl(id).getAttribute('aria-label')).toContain('Drawing');
  });

  it('selecting a stroke writes nothing to it, and opens no text editor', () => {
    const id = mkStroke(HOOK);
    mount();
    const before = linePath(id).getAttribute('d');
    clickOn(hitPath(id), 100, 300);
    expect(strokeEl(id).getAttribute('data-selected')).toBe('true');
    // Selected, and yet the stroke is untouched: same line, same box, no undo step.
    expect(linePath(id).getAttribute('d')).toBe(before);
    expect(snap(id).x).toBe(99);
    expect(undo.canUndo()).toBe(false);
    // A stroke holds no text: selecting it must not open an editor.
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });

  it('deleting the selected stroke with Delete removes it and is one undo step', () => {
    const id = mkStroke(HOOK);
    mount();
    clickOn(hitPath(id), 100, 300);
    fireKey('Delete');
    expect(strokeSnapshots(doc).length).toBe(0);
    expect(strokeEl(id)).toBeNull();
    expect(undo.canUndo()).toBe(true);
    act(() => {
      undo.undo();
    });
    expect(strokeSnapshots(doc).length).toBe(1);
    expect(strokeEl(id)).toBeTruthy();
  });
});

describe('story 11 a stroke deleted elsewhere (TC-21)', () => {
  it('a stroke removed by somebody else while selected leaves no selection and no error', () => {
    const id = mkStroke(HOOK);
    const noteId = createSticky(doc, { x: 600, y: 600 });
    mount();
    clickOn(hitPath(id), 100, 300);
    expect(strokeEl(id).getAttribute('data-selected')).toBe('true');
    expect(screen.getAllByTestId('resize-handle').length).toBe(8);

    // The other client deletes it.
    write(() => deleteObjects(doc, [id]));

    // It is gone from the board and from the selection; the board still answers.
    expect(strokeEl(id)).toBeNull();
    expect(strokeSnapshots(doc).length).toBe(0);
    expect(screen.queryAllByTestId('resize-handle').length).toBe(0);
    // Nothing stale was left selected: pressing on empty board and then on the note works.
    clickOn(world().querySelector(`[data-note-id="${noteId}"]`)!, 650, 650);
    expect(world().querySelector(`[data-note-id="${noteId}"]`)!.getAttribute('data-selected')).toBe(
      'true',
    );
    // The pen is still armable, and the board is still editable.
    fireKey('p');
    expect(pressed('Pen')).toBe('true');
    fireKey('v');
    expect(pressed('Select')).toBe('true');
  });
});

describe('story 11 a stroke is not a thing you can pick up', () => {
  // Firefox — Firefox alone — starts a native drag the moment the pointer is pressed on an
  // SVG element, and a pointer handed over to a drag is cancelled: the stroke never moves
  // under the hand. That is what tests/e2e/pen.spec.ts ran into, where TC-20's body drag
  // moved the drawing in two browsers and nothing in the third. jsdom has no native drag to
  // start, so the two things that prevent one are asserted where they can be seen.
  it('refuses the native drag that would steal the pointer mid-drag', () => {
    const id = mkStroke(RULE);
    mount();
    const svg = strokeEl(id);
    expect(/user-select:\s*none/.test(svg.getAttribute('style') ?? '')).toBe(true);

    // A drag begun on the line itself is cancelled before it starts: the browser is told
    // no, and the pointer it was about to take is the pointer the stroke is moved with.
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    act(() => {
      hitPath(id).dispatchEvent(drag);
    });
    expect(drag.defaultPrevented).toBe(true);
  });
});
