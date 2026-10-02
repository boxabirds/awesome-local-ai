import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getObjectType } from '../../src/client/objects/registry';
import { snapshotAll, deleteObjects, type StrokeSnapshot } from '../../src/shared/board-model';
import { createStroke, scaledPoints, strokeHitTest } from '../../src/shared/objects/stroke';
import { handwrittenLoop } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STICKY_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import {
  applyRemote,
  createNote,
  flushFrame,
  moveTo,
  noteData,
  noteEl,
  peerOf,
  pressOn,
  releaseOn,
  renderBoard,
  surfaceOf,
} from './helpers';

/**
 * TC-15, TC-16 and TC-21: a stroke as an object on the board — what it can be
 * clicked through, what can be clicked on, and what happens to the board's choice
 * when the drawing is taken away by somebody else.
 *
 * The thing these cases are really about is that a stroke is a line inside a box,
 * and the box is only where the line happens to be. An underline's box covers the
 * whole sentence above it; a circle's box covers everything inside the circle. So
 * the click has to be answered by the line and not by the box, at every zoom, and
 * the corridor that decides it is the same corridor that is drawn.
 *
 * jsdom hit-tests nothing: a dispatched event goes to whichever element the test
 * names. Where a case turns on where a click landed, the board's own hit test is
 * asked which element a browser would have answered with and the event is sent
 * there, and the drawn width of the corridor is asserted alongside it — because the
 * corridor that is drawn is the only corridor a real pointer can touch, and a
 * corridor that agreed with the model and not with the paint would agree with
 * nobody.
 */

let doc: Doc;
let view: HTMLElement;
let surface: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
  view = document.querySelector<HTMLElement>('.app')!;
  surface = surfaceOf(view);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ── helpers ─────────────────────────────────────────────────────────── */

function camera(): Camera {
  const transform = view.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
  const zoom = Number(/scale\(([-0-9.]+)\)/.exec(transform)?.[1]);
  const translate = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
  return { x: -Number(translate![1]), y: -Number(translate![2]), zoom };
}

function lookThrough(next: Camera): void {
  act(() => {
    window.__vidi6?.setCamera(next);
  });
  flushFrame();
}

function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
  flushFrame();
}

function strokes(): StrokeSnapshot[] {
  return snapshotAll(doc).filter((object) => object.type === 'stroke') as StrokeSnapshot[];
}

/** Write a stroke through the model, from board-unit points. */
function addStroke(
  points: readonly Point[],
  color: PenColor = 'black',
  thickness: PenThickness = 'medium',
): StrokeSnapshot {
  act(() => {
    const id = createStroke(doc, { points: points.map((p) => ({ ...p })), color, thickness });
    if (id === null) throw new Error('the model refused to create a stroke');
  });
  flushFrame();
  const all = strokes();
  const stored = all[all.length - 1];
  if (stored === undefined) throw new Error('the stroke did not arrive in the document');
  return stored;
}

function strokeEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`);
  if (el === null) throw new Error(`stroke ${id} is not drawn`);
  return el;
}

function corridorEl(id: string): SVGPathElement {
  const path = strokeEl(id).querySelector<SVGPathElement>('[data-testid="stroke-hit"]');
  if (path === null) throw new Error(`stroke ${id} is drawn with no click corridor`);
  return path;
}

function lineEl(id: string): SVGPathElement {
  const path = strokeEl(id).querySelector<SVGPathElement>('[data-testid="stroke-line"]');
  if (path === null) throw new Error(`stroke ${id} is drawn with no line`);
  return path;
}

/** A horizontal stroke, `length` board units long, drawn at `at`. */
function underline(at: Point = { x: 0, y: 0 }, length = 200): StrokeSnapshot {
  return addStroke([at, { x: at.x + length, y: at.y }]);
}

/**
 * Hand a screen point to whichever element a browser would have handed it: the
 * stroke's drawn corridor when the point is near enough to its line to be caught
 * there, and otherwise whatever is painted under the drawing — the board itself, or
 * the note a drawing was sketched over.
 */
function clickAt(x: number, y: number): void {
  const at = screenToWorld(camera(), { x, y });
  const zoom = camera().zoom;
  // Whatever is painted highest wins, as it would in a browser: a drawing is painted
  // over the note it was sketched on, and it answers only where its line is.
  let target: Element | null = null;
  for (const object of snapshotAll(doc)) {
    if (object.type !== 'stroke') continue;
    if (strokeHitTest(object, at, zoom)) {
      target = corridorEl(object.id);
      break;
    }
  }
  if (target === null) {
    const note = noteUnder(at);
    target = note === null ? surface : noteEl(note);
  }
  pressOn(target, x, y);
  releaseOn(target, x, y);
  flushFrame();
}

/** The note a board point falls inside, if one is painted there. */
function noteUnder(at: Point): string | null {
  for (const object of snapshotAll(doc)) {
    if (object.type !== 'sticky') continue;
    if (
      at.x >= object.x &&
      at.x <= object.x + STICKY_SIZE_WORLD &&
      at.y >= object.y &&
      at.y <= object.y + STICKY_SIZE_WORLD
    ) {
      return object.id;
    }
  }
  return null;
}

function selectedStrokeIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-stroke-id]'))
    .filter((el) => el.dataset.selected === 'true')
    .map((el) => el.dataset.strokeId!);
}

function selectedNoteIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'))
    .filter((el) => el.dataset.selected === 'true')
    .map((el) => el.dataset.noteId!);
}

/* ── TC-15: where a drawing can be clicked, at every zoom ────────────── */

describe('clicking a drawing', () => {
  it('TC-15 answers a click 5 pixels off its line and refuses one 7 off, at half size and at double', () => {
    const stroke = underline({ x: 100, y: 100 }, 200);
    const spec = getObjectType('stroke');
    if (spec === undefined) throw new Error('the board does not know what a drawing is');

    for (const zoom of [0.5, 2]) {
      // The middle of the line, moved away from it by a number of *screen* pixels:
      // what a person aims at is a distance on their screen, and the board units it
      // is worth depend entirely on how far they are zoomed in.
      const on = (screenPixels: number): Point => ({ x: 200, y: 100 + screenPixels / zoom });
      expect(spec.hitTest(stroke, on(5), zoom)).toBe(true);
      expect(spec.hitTest(stroke, on(7), zoom)).toBe(false);
      // On both sides of the line, and along it, not only under it.
      expect(spec.hitTest(stroke, { x: 200, y: 100 - 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(stroke, { x: 200, y: 100 - 7 / zoom }, zoom)).toBe(false);
      expect(spec.hitTest(stroke, { x: 100 + 5 / zoom, y: 100 }, zoom)).toBe(true);
    }
    // A click is neither easier when the drawing is big nor harder when it is small:
    // the tolerance is counted in the pixels of the screen at every one of them.
    expect(strokeHitTest(stroke, { x: 200, y: 100 + 5 / 0.5 }, 0.5)).toBe(
      strokeHitTest(stroke, { x: 200, y: 100 + 5 / 2 }, 2),
    );
  });

  it('TC-15 draws the corridor it clicks in, the same width at every zoom, in screen pixels', () => {
    const stroke = underline({ x: 100, y: 100 }, 200);
    for (const zoom of [0.5, 1, 2]) {
      lookThrough({ x: -640 / zoom, y: -400 / zoom, zoom });
      const width = Number(corridorEl(stroke.id).getAttribute('stroke-width'));
      // Board units, so multiplied back by the zoom it is drawn at, it is the same
      // corridor on the screen that the model measures the click against.
      expect(width * zoom).toBeCloseTo(STROKE_HIT_TOLERANCE_PX * 2, 6);
    }
  });

  it('TC-15 is registered as a thing that can be moved, scaled in proportion, and never typed into', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
  });

  it('is a drawing and not a box: a point inside the box and far from the line is not the drawing', () => {
    // A loop: its box covers everything inside the loop, and none of it is the loop.
    const loop = addStroke(handwrittenLoop(40));
    const centre = { x: loop.x + loop.width / 2, y: loop.y + loop.height / 2 };
    expect(getObjectType('stroke')!.hitTest(loop, centre, 1)).toBe(false);
    // While the ends of a line are the line.
    const line = underline({ x: 400, y: 400 }, 60);
    expect(getObjectType('stroke')!.hitTest(line, { x: 430, y: 400 }, 1)).toBe(true);
  });

  it('is clicked on the screen where the model says it is, at a zoom that is neither of the two', () => {
    const stroke = underline({ x: 0, y: 0 }, 200);
    lookThrough({ x: -640 / 1.5, y: -400 / 1.5, zoom: 1.5 });
    // A screen point five pixels from the drawn line, taken from the screen.
    const near = worldToScreen(camera(), { x: 100, y: 5 / 1.5 });
    expect(getObjectType('stroke')!.hitTest(stroke, screenToWorld(camera(), near), camera().zoom)).toBe(true);
    const far = worldToScreen(camera(), { x: 100, y: 8 / 1.5 });
    expect(getObjectType('stroke')!.hitTest(stroke, screenToWorld(camera(), far), camera().zoom)).toBe(false);
  });
});

/* ── TC-16: the box of a drawing belongs to what is under it ─────────── */

describe('a drawing over a note', () => {
  it('TC-16 gives a click inside the drawing’s box, away from its line, to the note underneath', () => {
    const note = createNote(doc, 0, 0);
    // A loop sketched over the note: its box covers the middle of the note.
    const circle: Point[] = [];
    for (let index = 0; index < 25; index++) {
      const angle = (index / 24) * Math.PI * 2;
      circle.push({ x: Math.cos(angle) * 60, y: Math.sin(angle) * 60 });
    }
    const loop = addStroke(circle, 'red', 'thin');
    expect(getObjectType('stroke')!.hitTest(loop, { x: 0, y: 0 }, 1)).toBe(false);

    // Click the middle of the loop: inside its box, 60 units from its line.
    clickAt(640, 400);
    expect(selectedNoteIds()).toEqual([note]);
    expect(selectedStrokeIds()).toEqual([]);
  });

  it('TC-16 takes a click on its line for itself, and gives the drag that follows to nothing but itself', () => {
    const note = createNote(doc, 0, 0);
    // A line drawn across the note, which the note is behind and not under.
    const line = addStroke([
      { x: -80, y: 0 },
      { x: 80, y: 0 },
    ]);

    clickAt(640, 400);
    expect(selectedStrokeIds()).toEqual([line.id]);
    expect(selectedNoteIds()).toEqual([]);

    // Drag it: the note does not move, and the drawing does.
    const before = noteData(doc, note);
    const boxBefore = { x: line.x, y: line.y };
    pressOn(corridorEl(line.id), 640, 400);
    moveTo(corridorEl(line.id), 700, 460);
    releaseOn(corridorEl(line.id), 700, 460);
    flushFrame();

    expect(noteData(doc, note)).toEqual(before);
    const moved = strokes().find((object) => object.id === line.id)!;
    expect(moved.x).not.toBe(boxBefore.x);
    expect(moved.y).not.toBe(boxBefore.y);
  });

  it('lets the pointer through its box and its line, and answers only in the corridor', () => {
    const line = underline({ x: 0, y: 0 }, 200);
    // The wrapper: not a target at all, so a click in the box that is not near the
    // line reaches whatever the board has painted there.
    expect(strokeEl(line.id).style.pointerEvents).toBe('none');
    // The picture: also none, so the line's own paint is never a target either — a
    // drawing could otherwise be clicked on its ink and not beside it.
    const svg = strokeEl(line.id).querySelector<SVGElement>('[data-testid="stroke-svg"]');
    expect(svg!.style.pointerEvents).toBe('none');
    // The corridor: the one thing here the pointer can find.
    expect(corridorEl(line.id).style.pointerEvents).toBe('stroke');
    expect(lineEl(line.id).getAttribute('stroke')).toBe(PEN_COLORS.black);
  });

  it('draws its box around the drawing and no larger than the pen needs', () => {
    const line = underline({ x: 0, y: 0 }, 200);
    expect(line.x).toBeCloseTo(-PEN_THICKNESS_WORLD.medium / 2, 6);
    expect(line.width).toBeCloseTo(200 + PEN_THICKNESS_WORLD.medium, 6);
    // The painted area reaches a little past the box, so that the corridor is
    // clickable at the ends of the line as well as along it.
    const svg = strokeEl(line.id).querySelector('[data-testid="stroke-svg"]')!;
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(line.width);
  });
});

/* ── TC-21: a drawing deleted under the person who selected it ───────── */

describe('a drawing taken away while it is selected', () => {
  it('TC-21 lets the selection go when the drawing is deleted elsewhere, and says nothing worse than that', () => {
    const line = addStroke([
      { x: -80, y: 0 },
      { x: 80, y: 0 },
    ]);
    pressKey('v');
    clickAt(640, 400);
    expect(selectedStrokeIds()).toEqual([line.id]);
    expect(screen.getByTestId('selection-bounding-box')).toBeInTheDocument();

    // Somebody else deletes it. The board is left holding a selection of a thing
    // that is no longer there, and the only right answer is to stop holding it.
    const peer = peerThatDeletes(line.id);
    expect(() => {
      applyRemote(doc, peer);
    }).not.toThrow();
    flushFrame();

    expect(strokes()).toHaveLength(0);
    expect(selectedStrokeIds()).toEqual([]);
    expect(document.querySelector('[data-testid="resize-handle-e"]')).toBeNull();
    expect(screen.queryByTestId('selection-bounding-box')).toBeNull();
    // And the board still works afterwards: a drawing can be drawn on it.
    pressKey('p');
    pressOn(surface, 300, 300);
    moveTo(surface, 420, 360);
    releaseOn(surface, 420, 360);
    flushFrame();
    expect(strokes()).toHaveLength(1);
  });

  it('leaves the other drawings of a multi-selection alone when one of them goes', () => {
    const first = addStroke([
      { x: -80, y: 0 },
      { x: 80, y: 0 },
    ]);
    const second = addStroke([
      { x: -80, y: 120 },
      { x: 80, y: 120 },
    ]);
    pressKey('v');
    clickAt(640, 400);
    // Shift-click the second, so both are held.
    const at = worldToScreen(camera(), { x: 0, y: 120 });
    const target = corridorEl(second.id);
    fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 0, shiftKey: true, clientX: at.x, clientY: at.y });
    fireEvent.pointerUp(target, { pointerId: 1, isPrimary: true, button: 0, shiftKey: true, clientX: at.x, clientY: at.y });
    flushFrame();
    expect(selectedStrokeIds().sort()).toEqual([first.id, second.id].sort());

    act(() => {
      deleteObjects(doc, [first.id]);
    });
    flushFrame();
    expect(selectedStrokeIds()).toEqual([second.id]);
    expect(strokeEl(second.id).dataset.selected).toBe('true');
  });
});

/* ── the peer the two cases above need ───────────────────────────────── */

/** A second client, holding this board's state minus one drawing. */
function peerThatDeletes(id: string): Doc {
  const peer = peerOf(doc);
  peer.transact(() => {
    peer.getMap('objects').delete(id);
  });
  return peer;
}
