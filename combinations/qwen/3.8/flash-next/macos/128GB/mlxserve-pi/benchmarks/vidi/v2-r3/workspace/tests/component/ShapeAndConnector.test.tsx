import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from '../../src/client/canvas/camera';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_LABEL_MAX_CHARS,
} from '../../src/shared/config';
import { snapshotAll, type ConnectorSnapshot, type ShapeSnapshot } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector, readConnector } from '../../src/shared/objects/connector';
import {
  VIEWPORT,
  createNote,
  dragBy,
  flushFrame,
  moveTo,
  noteData,
  noteEl,
  pressOn,
  releaseOn,
  renderBoard,
  surfaceOf,
} from './helpers';

/**
 * TC-15 to TC-22 and TC-28: shapes, and the arrows that follow them.
 *
 * What the component tier settles that the unit one cannot is the wiring: that one
 * drag of the Shape tool reaches the model exactly once and comes back in Select
 * holding what it made; that a swatch paints a shape and touches nothing else; that
 * the four points offered over a shape are the four points the model would attach
 * to; and that a shape is drawn *over* a note without the note moving.
 *
 * One thing jsdom cannot do is hit-test: it hands a pointer event to whichever
 * element the test names, not to whatever is painted under the pointer. So where a
 * case turns on where a click lands (TC-20), the board's own hit test is asked which
 * element a browser would have landed on and the event is dispatched there — the same
 * corridor the browser tests the drawn stroke against, and where it is relied on the
 * test says so, and asserts the corridor's drawn width as well.
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

/** The camera the board is drawing with, read back off the world layer: the layer
 *  is `scale(zoom) translate(-x, -y)`, so what it says is what the board is looking
 *  through, whatever the test asked it to be. */
function camera(): Camera {
  const transform = view.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
  const zoom = Number(/scale\(([-0-9.]+)\)/.exec(transform)?.[1]);
  const translate = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
  return { x: -Number(translate![1]), y: -Number(translate![2]), zoom };
}

/** Screen pixels to board units. The test viewport reports its top-left at the
 *  origin (setup.ts), so a client point and a screen point are one and the same. */
function board(x: number, y: number): Point {
  return screenToWorld(camera(), { x, y });
}

/** Board units to the screen pixels they are drawn at. */
function screenOf(point: Point): Point {
  return worldToScreen(camera(), point);
}

/** Look at the board through a zoom, by the same hook the end-to-end tests use. */
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

function pressed(name: string): boolean {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';
}

function shapes(): ShapeSnapshot[] {
  return snapshotAll(doc).filter((object) => object.type === 'shape') as ShapeSnapshot[];
}

function arrows(): ConnectorSnapshot[] {
  return snapshotAll(doc).filter((object) => object.type === 'connector') as ConnectorSnapshot[];
}

/** Put a shape on the board through the model, naming the box it is drawn in on
 *  the screen; the conversion to board units is the board's, and is asserted
 *  elsewhere. */
function addShape(box: Rect, kind: 'rect' | 'ellipse' | 'diamond' = 'rect'): string {
  const a = board(box.x, box.y);
  const b = board(box.x + box.width, box.y + box.height);
  let id = '';
  act(() => {
    id = createShape(doc, { kind, rect: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, at: a }) ?? '';
  });
  if (id === '') throw new Error('the model refused to create a shape');
  flushFrame();
  return id;
}

/** Put an arrow between two screen points, loose at both ends. */
function addArrow(from: Point, to: Point): string {
  let id = '';
  act(() => {
    id =
      createConnector(doc, {
        from: { kind: 'free', x: from.x, y: from.y },
        to: { kind: 'free', x: to.x, y: to.y },
      }) ?? '';
  });
  if (id === '') throw new Error('the model refused to create an arrow');
  flushFrame();
  return id;
}

/** An arrow fastened to two shapes, at the points it is drawn between. */
function attachArrow(fromId: string, from: Point, toId: string, to: Point): string {
  let id = '';
  act(() => {
    id =
      createConnector(doc, {
        from: { kind: 'attached', objectId: fromId, fallback: from },
        to: { kind: 'attached', objectId: toId, fallback: to },
      }) ?? '';
  });
  if (id === '') throw new Error('the model refused to create an arrow');
  flushFrame();
  return id;
}

function shapeData(id: string): ShapeSnapshot | undefined {
  return shapes().find((object) => object.id === id);
}

function arrowData(id: string): ConnectorSnapshot | undefined {
  return arrows().find((object) => object.id === id);
}

function shapeEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
  if (el === null) throw new Error(`shape ${id} is not drawn`);
  return el;
}

function arrowEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (el === null) throw new Error(`arrow ${id} is not drawn`);
  return el;
}

function dot(side: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="attach-dot-${side}"]`);
}

/** The arrowhead handle, looked up each time: the selection redraws it wherever
 *  the arrow's end now is, and a test that kept the element would be holding one
 *  from a board that is no longer drawn. */
function headHandle(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="connector-end-to"]');
  if (el === null) throw new Error('the selected arrow has no arrowhead handle');
  return el;
}

function swatch(bar: HTMLElement, testId: string): HTMLElement {
  const el = bar.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`${testId} is not in the shape toolbar`);
  return el;
}

/**
 * Hand a screen point to whichever element a browser would have handed it.
 *
 * A browser gives a click that lands within `CONNECTOR_HIT_TOLERANCE_PX` screen
 * pixels of an arrow's line to that arrow's wide transparent stroke, and one outside
 * that corridor to the board underneath — which is how a click off an arrow comes to
 * deselect. jsdom paints nothing and hit-tests nothing, so the board's own hit test
 * decides which of the two the pointer was on, and the event goes there. What is
 * being tested is the answer and what the board does with it; that the drawn stroke
 * is the same width as the answer is asserted separately.
 */
function clickAt(x: number, y: number): void {
  const at = board(x, y);
  const zoom = camera().zoom;
  let target: Element = surface;
  for (const object of snapshotAll(doc)) {
    if (object.type !== 'connector') continue;
    if (getObjectType('connector')!.hitTest(object, at, zoom)) {
      target = arrowEl(object.id).querySelector<HTMLElement>('[data-testid="connector-hit"]')!;
      break;
    }
  }
  pressOn(target, x, y);
  releaseOn(target, x, y);
  flushFrame();
}

function selectedArrowIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-connector-id]'))
    .filter((el) => el.dataset.selected === 'true')
    .map((el) => el.dataset.connectorId!);
}

/* ── TC-15, TC-16, TC-17, TC-22, TC-28: shapes ───────────────────────── */

describe('drawing shapes', () => {
  it('TC-15 drags a preview, makes one shape of it, and is back in Select holding it', () => {
    pressKey('s');
    expect(pressed('Shape (S)')).toBe(true);

    pressOn(surface, 100, 100);
    moveTo(surface, 300, 220);

    // The preview is the drag, drawn: screen pixels, dashed, and no shape yet.
    const preview = document.querySelector<HTMLElement>('[data-testid="shape-preview"]');
    expect(preview).not.toBeNull();
    expect(Number(preview!.dataset.width)).toBeCloseTo(200, 0);
    expect(Number(preview!.dataset.height)).toBeCloseTo(120, 0);
    expect(shapes().length).toBe(0);

    releaseOn(surface, 300, 220);
    flushFrame();

    // One drag, one shape: the preview is gone and the model was asked once.
    expect(document.querySelector('[data-testid="shape-preview"]')).toBeNull();
    const made = shapes();
    expect(made.length).toBe(1);
    const shape = made[0];
    const a = board(100, 100);
    const b = board(300, 220);
    expect(shape.x).toBeCloseTo(Math.min(a.x, b.x), 6);
    expect(shape.y).toBeCloseTo(Math.min(a.y, b.y), 6);
    expect(shape.width).toBeCloseTo(200, 6);
    expect(shape.height).toBeCloseTo(120, 6);
    expect(shape.kind).toBe('rect');
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');

    expect(pressed('Select (V)')).toBe(true);
    expect(shapeEl(shape.id).dataset.selected).toBe('true');
  });

  it('TC-15 makes a shape of the default size, centred on a click', () => {
    pressKey('s');
    const at = board(400, 300);
    pressOn(surface, 400, 300);
    releaseOn(surface, 400, 300);
    flushFrame();

    const made = shapes();
    expect(made.length).toBe(1);
    const shape = made[0];
    expect(shape.width).toBeCloseTo(160, 6);
    expect(shape.height).toBeCloseTo(160, 6);
    expect(shape.x + shape.width / 2).toBeCloseTo(at.x, 6);
    expect(shape.y + shape.height / 2).toBeCloseTo(at.y, 6);
    expect(pressed('Select (V)')).toBe(true);
  });

  it('TC-28 takes the drag for itself, so a shape is drawn over a note that never moved', () => {
    const note = createNote(doc, 200, 100);
    const before = { ...noteData(doc, note)! };
    pressKey('s');

    // The drag starts on the note, which is where a person who wants a shape next
    // to a note would put their pointer. The note is the element the pointer is
    // over, so it is the element that gets the events — and it does not move,
    // because the tool took the gesture before it did.
    const corner = screenOf({ x: before.x, y: before.y });
    dragBy(noteEl(note), 180, 140, { x: corner.x + 30, y: corner.y + 30 });
    flushFrame();

    const after = noteData(doc, note)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(shapes().length).toBe(1);
  });

  it('TC-16 opens a label that stops at the limit, in the box it was drawn with', () => {
    const id = addShape({ x: 300, y: 200, width: 200, height: 120 });
    const el = shapeEl(id);

    pressOn(el, 400, 260);
    releaseOn(el, 400, 260);
    fireEvent.doubleClick(el, { clientX: 400, clientY: 260 });
    flushFrame();

    const editor = el.querySelector<HTMLTextAreaElement>('textarea');
    expect(editor).not.toBeNull();
    expect(editor).toHaveAttribute('data-testid', 'shape-label-editor');

    fireEvent.input(editor!, { target: { value: 'x'.repeat(600) } });
    flushFrame();

    expect(getShapeLabel(doc, id)?.toString() ?? '').toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(el.querySelector<HTMLElement>('[data-testid="shape-label"]')!.dataset.labelLength).toBe('500');

    // A label is not a size: the shape kept the box it was drawn with.
    const shape = shapeData(id)!;
    expect(shape.width).toBeCloseTo(200, 6);
    expect(shape.height).toBeCloseTo(120, 6);
  });

  it('TC-17 paints the selected shape from its own toolbar, and nothing else', () => {
    const id = addShape({ x: 300, y: 200, width: 200, height: 120 });
    const el = shapeEl(id);
    pressOn(el, 400, 260);
    releaseOn(el, 400, 260);
    flushFrame();

    const bar = document.querySelector<HTMLElement>('[data-testid="shape-toolbar"]');
    expect(bar).not.toBeNull();

    fireEvent.click(swatch(bar!, 'shape-fill-blue'));
    fireEvent.click(swatch(bar!, 'shape-stroke-red'));
    flushFrame();

    const shape = shapeData(id)!;
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    // Two swatches, and nothing else about the shape or the board changed: no word
    // lost, no box moved, and the shape is still the one being held.
    expect(shape.label).toBe('');
    expect(shape.width).toBeCloseTo(200, 6);
    expect(shape.height).toBeCloseTo(120, 6);
    expect(el.dataset.selected).toBe('true');
    expect(selectedArrowIds().length).toBe(0);
  });

  it('TC-22 is back in Select after a shape, and out of the tool on Escape without one', () => {
    pressKey('s');
    expect(pressed('Shape (S)')).toBe(true);
    pressOn(surface, 500, 150);
    moveTo(surface, 620, 260);
    releaseOn(surface, 620, 260);
    flushFrame();
    expect(pressed('Select (V)')).toBe(true);
    expect(shapes().length).toBe(1);

    // Escape is the way out that makes nothing.
    const before = shapes().length;
    pressKey('s');
    expect(pressed('Shape (S)')).toBe(true);
    pressKey('Escape');
    expect(pressed('Select (V)')).toBe(true);
    expect(shapes().length).toBe(before);

    // A drag begun and never finished is the same way out.
    pressKey('s');
    pressOn(surface, 700, 500);
    moveTo(surface, 760, 560);
    fireEvent.pointerCancel(surface, { pointerId: 1, isPrimary: true, pointerType: 'mouse' });
    flushFrame();
    expect(shapes().length).toBe(before);
  });
});

/* ── TC-18 to TC-21, TC-22: arrows ───────────────────────────────────── */

describe('drawing arrows between shapes', () => {
  it('TC-18 offers a shape four points, one at the middle of each of its sides', () => {
    addShape({ x: 400, y: 200, width: 240, height: 160 });
    pressKey('l');
    expect(pressed('Connector (L)')).toBe(true);

    // A pointer that is only looking, with no button held down.
    moveTo(surface, 520, 280);
    flushFrame();

    const cornerTopLeft = screenOf(board(400, 200));
    const cornerTopRight = screenOf(board(640, 200));
    const cornerBottomRight = screenOf(board(640, 360));
    const cornerBottomLeft = screenOf(board(400, 360));
    const middleX = (cornerTopLeft.x + cornerBottomRight.x) / 2;
    const middleY = (cornerTopLeft.y + cornerBottomRight.y) / 2;

    const expected: Record<string, Point> = {
      top: { x: middleX, y: cornerTopLeft.y },
      right: { x: cornerTopRight.x, y: middleY },
      bottom: { x: middleX, y: cornerBottomRight.y },
      left: { x: cornerBottomLeft.x, y: middleY },
    };
    expect(document.querySelectorAll('[data-testid^="attach-dot-"]').length).toBe(4);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const el = dot(side);
      expect(el).not.toBeNull();
      // The dot is drawn centred on the point, so its centre is what is compared.
      expect(Number.parseFloat(el!.style.left) + 4).toBeCloseTo(expected[side].x, 0);
      expect(Number.parseFloat(el!.style.top) + 4).toBeCloseTo(expected[side].y, 0);
      // Nothing is aimed yet, so no side is chosen: four points, all equally offered.
      expect(el!.dataset.lit).toBe('false');
    }
  });

  it('TC-18 takes the points away again when the pointer leaves the shape', () => {
    addShape({ x: 400, y: 200, width: 240, height: 160 });
    pressKey('l');
    moveTo(surface, 520, 280);
    flushFrame();
    expect(dot('top')).not.toBeNull();

    moveTo(surface, 100, 600);
    flushFrame();
    expect(dot('top')).toBeNull();
  });

  it('TC-19 lights the side the far end is aimed at, and lets go of an attached arrow', () => {
    const a = addShape({ x: 200, y: 300, width: 160, height: 160 });
    const b = addShape({ x: 700, y: 300, width: 160, height: 160 });
    pressKey('l');

    // From the middle of A, dragged onto B.
    pressOn(surface, 280, 380);
    moveTo(surface, 705, 380);
    flushFrame();

    // B's four points are out, and the one nearest is lit: the side an arrow aimed
    // this way would take, which is the same answer the model gives.
    expect(dot('left')!.dataset.lit).toBe('true');
    expect(dot('right')!.dataset.lit).toBe('false');
    expect(document.querySelector('[data-testid="connector-preview"]')).not.toBeNull();

    releaseOn(surface, 705, 380);
    flushFrame();

    const made = arrows();
    expect(made.length).toBe(1);
    const arrow = made[0];
    expect(arrow.from.kind).toBe('attached');
    expect(arrow.to.kind).toBe('attached');
    if (arrow.from.kind === 'attached' && arrow.to.kind === 'attached') {
      expect(arrow.from.objectId).toBe(a);
      expect(arrow.to.objectId).toBe(b);
      // The point kept beside the reference is the anchor of the side it took, so
      // the arrow is drawn where it was drawn and not elsewhere.
      expect(arrow.to.fallback).toEqual(arrow.resolved.to);
    }
    expect(pressed('Select (V)')).toBe(true);
    expect(arrowEl(arrow.id).dataset.selected).toBe('true');
  });

  it('TC-19 lets go of nothing when the drag ends in the shape it started in', () => {
    const a = addShape({ x: 200, y: 300, width: 160, height: 160 });
    pressKey('l');

    // A drag of a hundred pixels that never leaves A: one shape is not two to join.
    pressOn(surface, 240, 340);
    moveTo(surface, 320, 420);
    releaseOn(surface, 320, 420);
    flushFrame();

    expect(arrows().length).toBe(0);
    // The tool did not run off after the attempt that made nothing.
    expect(pressed('Connector (L)')).toBe(true);
    expect(shapeData(a)).toBeDefined();
  });

  it('TC-19 lets go of nothing when the pointer moved less than an arrow is long', () => {
    addShape({ x: 200, y: 300, width: 160, height: 160 });
    addShape({ x: 700, y: 300, width: 160, height: 160 });
    pressKey('l');

    // A drag over nothing at all, seven board units from one point to the next:
    // shorter than an arrow, so it is a click that wobbled and not an arrow.
    pressOn(surface, 500, 620);
    moveTo(surface, 500 + CONNECTOR_MIN_LENGTH_WORLD - 1, 620);
    releaseOn(surface, 500 + CONNECTOR_MIN_LENGTH_WORLD - 1, 620);
    flushFrame();
    expect(arrows().length).toBe(0);

    // One unit more, and it is an arrow: the setting means what it says, at the
    // tool as well as in the model.
    pressOn(surface, 500, 660);
    moveTo(surface, 500 + CONNECTOR_MIN_LENGTH_WORLD, 660);
    releaseOn(surface, 500 + CONNECTOR_MIN_LENGTH_WORLD, 660);
    flushFrame();
    expect(arrows().length).toBe(1);
    // And the board is back in Select holding the arrow, as it is after every arrow.
    expect(pressed('Select (V)')).toBe(true);
  });

  it('TC-19 leaves an end free at the point it was let go over nothing', () => {
    const a = addShape({ x: 200, y: 300, width: 160, height: 160 });
    pressKey('l');
    pressOn(surface, 280, 380);
    moveTo(surface, 600, 380);
    releaseOn(surface, 600, 380);
    flushFrame();

    const arrow = arrows()[0];
    expect(arrow).toBeDefined();
    expect(arrow.from.kind).toBe('attached');
    expect(arrow.from.kind === 'attached' ? arrow.from.objectId === a : false).toBe(true);
    expect(arrow.to.kind).toBe('free');
    if (arrow.to.kind === 'free') {
      const where = board(600, 380);
      expect(arrow.to.x).toBeCloseTo(where.x, 6);
      expect(arrow.to.y).toBeCloseTo(where.y, 6);
    }
  });

  it('TC-20 keeps a corridor of six screen pixels to click an arrow in, at every zoom', () => {
    for (const zoom of [0.5, 2]) {
      lookThrough({ x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom });
      const id = addArrow(board(400, 400), board(900, 400));

      // The drawn corridor is the model's tolerance turned into board units, so it
      // is the same six pixels each side on the screen at half size as at double —
      // which is the half of TC-20 that is about the drawing rather than the answer.
      const hit = arrowEl(id).querySelector<HTMLElement>('[data-testid="connector-hit"]')!;
      expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo((CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom, 6);

      // Five pixels off the line is inside the corridor: the pointer lands on the
      // arrow, and the arrow is selected.
      clickAt(650, 405);
      expect(selectedArrowIds()).toEqual([id]);

      // Seven pixels is outside it: the pointer lands on the board underneath, and
      // the board does what a board does with a click on nothing.
      clickAt(650, 393);
      expect(selectedArrowIds()).toEqual([]);

      cleanup();
      doc = renderBoard();
      view = document.querySelector<HTMLElement>('.app')!;
      surface = surfaceOf(view);
    }
  });

  it('TC-20 writes nothing for an arrow too short to be one, and something for exactly it', () => {
    const from = board(400, 400);
    const short = board(400 + CONNECTOR_MIN_LENGTH_WORLD - 0.1, 400);
    const exact = board(400 + CONNECTOR_MIN_LENGTH_WORLD, 400);

    let rejected: string | null = 'written';
    act(() => {
      rejected = createConnector(doc, { from: { kind: 'free', x: from.x, y: from.y }, to: { kind: 'free', x: short.x, y: short.y } });
    });
    expect(rejected).toBeNull();

    let accepted: string | null = null;
    act(() => {
      accepted = createConnector(doc, { from: { kind: 'free', x: from.x, y: from.y }, to: { kind: 'free', x: exact.x, y: exact.y } });
    });
    expect(typeof accepted).toBe('string');
  });

  it('TC-21 drags an arrow end onto a third shape, and off into the air', () => {
    const a = addShape({ x: 150, y: 200, width: 160, height: 160 });
    const b = addShape({ x: 600, y: 200, width: 160, height: 160 });
    const c = addShape({ x: 600, y: 520, width: 160, height: 160 });

    // An arrow from A to B, drawn at the two sides that face one another.
    const id = attachArrow(a, board(310, 280), b, board(600, 280));

    // Select it, which is what puts its two ends under the pointer.
    clickAt(450, 280);
    expect(selectedArrowIds()).toEqual([id]);
    expect(document.querySelector('[data-testid="connector-end-from"]')).not.toBeNull();
    expect(headHandle()).not.toBeNull();

    // Drag the arrowhead down onto C.
    const head = screenOf(arrowData(id)!.resolved.to);
    dragBy(headHandle(), 680 - head.x, 600 - head.y, { x: head.x, y: head.y });
    flushFrame();

    const moved = readConnector(doc, id)!;
    expect(moved.to.kind === 'attached' ? moved.to.objectId === c : false).toBe(true);

    // And drag the same end off everything, into the empty corner of the board:
    // an end let go over nothing stays where it was let go, which is the other
    // half of what an end is.
    const now = screenOf(arrowData(id)!.resolved.to);
    dragBy(headHandle(), -200, 160, { x: now.x, y: now.y });
    flushFrame();

    const freed = readConnector(doc, id)!;
    expect(freed.to.kind).toBe('free');
    if (freed.to.kind === 'free') {
      const where = board(now.x - 200, now.y + 160);
      expect(freed.to.x).toBeCloseTo(where.x, 4);
      expect(freed.to.y).toBeCloseTo(where.y, 4);
    }
    // The end that was never touched is where it was fastened.
    expect(freed.from.kind === 'attached' ? freed.from.objectId === a : false).toBe(true);
  });

  it('TC-21 snaps an end back when it is dragged onto the shape the other end holds', () => {
    const a = addShape({ x: 150, y: 200, width: 160, height: 160 });
    const b = addShape({ x: 600, y: 200, width: 160, height: 160 });
    const id = attachArrow(a, board(310, 280), b, board(600, 280));
    clickAt(450, 280);

    const before = JSON.stringify(readConnector(doc, id));
    const head = screenOf(arrowData(id)!.resolved.to);
    const over = screenOf(board(240, 280));
    // The arrowhead dragged back over A. An arrow between one shape and itself is
    // nothing to draw, so the model writes nothing and the end is where it was.
    dragBy(headHandle(), over.x - head.x, over.y - head.y, { x: head.x, y: head.y });
    flushFrame();

    expect(JSON.stringify(readConnector(doc, id))).toBe(before);
  });

  it('TC-22 is back in Select after an arrow, and out of the tool on Escape without one', () => {
    addShape({ x: 200, y: 300, width: 160, height: 160 });
    addShape({ x: 700, y: 300, width: 160, height: 160 });

    pressKey('l');
    pressOn(surface, 280, 380);
    moveTo(surface, 705, 380);
    releaseOn(surface, 705, 380);
    flushFrame();
    expect(pressed('Select (V)')).toBe(true);
    expect(arrows().length).toBe(1);

    const before = arrows().length;
    pressKey('l');
    expect(pressed('Connector (L)')).toBe(true);
    pressKey('Escape');
    expect(pressed('Select (V)')).toBe(true);
    expect(arrows().length).toBe(before);

    // Escape out of the Shape tool makes nothing either, which is the same promise
    // made to the other tool.
    pressKey('s');
    pressKey('Escape');
    expect(pressed('Select (V)')).toBe(true);
    expect(shapes().length).toBe(2);
  });
});
