/**
 * TC-18 to TC-22 — drawing an arrow, an arrow that follows, and the two handles that re-aim it.
 *
 * An arrow is the first object on this board that has no position of its own. Everything these tests check
 * comes from that: the line, the box around it, the dots on the sides of the shapes and the place a released
 * handle lands are all worked out from the shapes on the board, so a test cannot read an arrow out of the
 * document and check it against the screen — it has to ask the same question the drawing asks, and then
 * check that the document holds only what the drawing is allowed to be told.
 *
 * What that means case by case:
 * — the four dots (TC-18) are the four places an end can go, shown while the pointer is only moving over a
 *   shape, and they are computed by the same function the arrow is drawn with;
 * — the drag (TC-19) writes one arrow, attached at both ends, and the side it attaches to is the side that
 *   faces wherever the other end came from — which is why lighting a dot and drawing the arrow cannot
 *   disagree, and why an arrow drawn from a shape to itself is refused rather than drawn;
 * — the click (TC-20) is measured in screen pixels at every zoom, so an arrow is exactly as easy to catch at
 *   50 % as at 200 %, and the air beside the line stays air;
 * — a moved shape (TC-21) moves the arrow with it and writes nothing: the arrow's two ends still name the
 *   same two shapes, which is the only thing that was ever written about this arrow;
 * — and the handles (TC-22) are the only way an arrow can honestly be moved: onto a shape, onto nothing, or
 *   refused when the shape being aimed at is the one the other end is already on.
 *
 * The world point of a screen point here is `screen + (640, 400)` at the board's starting camera, and the
 * tests say so in world units wherever the number matters.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { worldToScreen } from '../../src/client/canvas/camera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { CONNECTOR_HIT_TOLERANCE_PX, CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config';
import { isConnectorSnapshot } from '../../src/shared/board-model';
import { createShape, isShapeSnapshot } from '../../src/shared/objects/shape';
import { connectorEnds, createConnector, type ConnectorSnapshot } from '../../src/shared/objects/connector';
import { hitTestObject } from '../../src/client/objects/registry';
import type { Rect } from '../../src/shared/geometry';
import { FakeProvider } from './helpers/fake-provider';
import {
  VIEWPORT,
  act as actOn,
  board,
  nextFrame,
  pointer,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';

/** The id of a board these tests can make unreadable on purpose. */
const BOARD_ID = 'boardboardboardboard01';

/* The three shapes, in world units. A and B are side by side; C is below A. */
const A = { x: -500, y: -100, width: 160, height: 120 };
const B = { x: -200, y: -100, width: 160, height: 120 };
const C = { x: -500, y: 150, width: 160, height: 120 };

const centreOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** Presses a key where the board listens. */
async function key(k: string, modifiers: Record<string, boolean> = {}): Promise<void> {
  await actOn(async () => {
    fireEvent.keyDown(window, { key: k, ...modifiers });
    await nextFrame();
  });
}

/** The tool the board says the pointer is in, read off the board itself. */
const toolOnScreen = (): string | undefined => board().dataset['tool'];

/** A world point as the point on the screen it is drawn at, as the board's own camera says. */
const screenOfWorld = (point: { x: number; y: number }) => worldToScreen(renderedCamera(), point);

/** Puts a shape on the board through the model, which is what a finished drag of the Shape tool does. */
async function addShape(fixture: BoardFixture, rect: Rect): Promise<string> {
  let id = '';
  await actOn(async () => {
    const created = createShape(fixture.doc(), { kind: 'rect', rect: { ...rect } });
    if (typeof created !== 'string') throw new Error('createShape was rejected');
    id = created;
    await nextFrame();
  });
  return id;
}

/** The one arrow on the board, of which there must be exactly one. */
function onlyConnector(fixture: BoardFixture): ConnectorSnapshot {
  const arrows = fixture.objects().filter(isConnectorSnapshot);
  if (arrows.length !== 1) throw new Error(`expected one connector, found ${arrows.length}`);
  return arrows[0] as ConnectorSnapshot;
}

/** The arrow's element, or a complaint that it was never drawn. */
function connectorEl(fixture: BoardFixture, id: string): HTMLElement {
  const el = fixture.objectEl(id);
  if (el === null) throw new Error('the connector is not rendered');
  return el;
}

/** Moves the pointer to a point on the board, without pressing anything. */
async function moveTo(point: { x: number; y: number }): Promise<void> {
  pointer('pointerMove', board(), point);
  await actOn(nextFrame);
}

/** Presses at one point, moves to another, and lets go: the whole of an arrow's drawing. */
async function dragArrow(
  from: { x: number; y: number },
  to: { x: number; y: number },
  via: { x: number; y: number } | null = null,
): Promise<void> {
  pointer('pointerDown', board(), from);
  await actOn(nextFrame);
  const mid = via ?? to;
  pointer('pointerMove', board(), mid);
  await actOn(nextFrame);
  if (via !== null) {
    pointer('pointerMove', board(), to);
    await actOn(nextFrame);
  }
  pointer('pointerUp', board(), to);
  await actOn(nextFrame);
}

/** Enters the Connector tool with its key. */
const enterConnector = (): Promise<void> => key('l');

/** A board with three shapes on it, the shapes' ids, and their centres on the screen. */
async function threeShapes(): Promise<{
  fixture: BoardFixture;
  a: string;
  b: string;
  c: string;
  at: Record<'a' | 'b' | 'c', { x: number; y: number }>;
}> {
  const fixture = renderBoard();
  const a = await addShape(fixture, A);
  const b = await addShape(fixture, B);
  const c = await addShape(fixture, C);
  return {
    fixture,
    a,
    b,
    c,
    at: { a: screenOfWorld(centreOf(A)), b: screenOfWorld(centreOf(B)), c: screenOfWorld(centreOf(C)) },
  };
}

describe('the Connector tool', () => {
  it('TC-18 shows the four places an end can go, and only while the pointer is over a shape', async () => {
    const { fixture, a, at } = await threeShapes();
    await enterConnector();
    expect(toolOnScreen()).toBe('connector');

    // Nothing is shown over empty board: the board is not a shape and has no sides to attach to.
    expect(screen.queryByTestId('connector-dots')).toBeNull();
    await moveTo({ x: 60, y: 700 });
    expect(screen.queryByTestId('connector-dots')).toBeNull();

    // Over a shape: four dots, one per side, on the shape the pointer is over.
    await moveTo(at.a);
    const dots = screen.getByTestId('connector-dots');
    expect(dots.dataset['hoverObjectId']).toBe(a);
    expect(screen.getByTestId('connector-dot-top')).toBeTruthy();
    expect(screen.getByTestId('connector-dot-right')).toBeTruthy();
    expect(screen.getByTestId('connector-dot-bottom')).toBeTruthy();
    expect(screen.getByTestId('connector-dot-left')).toBeTruthy();
    // Nothing is lit while the pointer is only hovering: which side it would attach to is not known until
    // there is another end to face.
    expect(dots.querySelectorAll('[data-active="true"]')).toHaveLength(0);

    // …and the dots are where the sides are, not somewhere near them.
    const rect = fixture.boundsOf(a);
    const top = screen.getByTestId('connector-dot-top');
    expect(Number(top.style.left.replace('px', ''))).toBeCloseTo(
      screenOfWorld({ x: rect.x + rect.width / 2, y: rect.y }).x - 4,
      6,
    );

    // Away from the shape, and they are gone: the tool draws nothing over nothing.
    await moveTo({ x: 60, y: 700 });
    expect(screen.queryByTestId('connector-dots')).toBeNull();
  });

  it('TC-18 offers the topmost shape under the pointer, not the one behind it', async () => {
    const fixture = renderBoard();
    const a = await addShape(fixture, A);
    // A shape laid over the right half of the first one.
    const overlapping = await addShape(fixture, { x: -420, y: -140, width: 120, height: 200 });
    const point = screenOfWorld({ x: -380, y: -60 });

    await enterConnector();
    await moveTo(point);
    expect(screen.getByTestId('connector-dots').dataset['hoverObjectId']).toBe(overlapping);
    expect(a).not.toBe(overlapping);
  });

  it('TC-19 draws an arrow between two shapes, at both of them, and hands the pointer back', async () => {
    const { fixture, a, b } = await threeShapes();
    await enterConnector();

    const aScreen = screenOfWorld(centreOf(A));
    const bScreen = screenOfWorld(centreOf(B));
    pointer('pointerDown', board(), aScreen);
    await actOn(nextFrame);
    pointer('pointerMove', board(), bScreen);
    await actOn(nextFrame);

    // The preview runs from the side of A that faces B — not from the middle of A, and not from the point
    // the pointer went down at, which is only where the end would go if A were not a shape.
    const preview = screen.getByTestId('connector-preview').firstElementChild;
    expect(Number(preview?.getAttribute('x1'))).toBeCloseTo(screenOfWorld({ x: A.x + A.width, y: A.y + A.height / 2 }).x, 6);

    // The far end is over B, and the dot that is lit is the side of B the arrow will be drawn to: the one
    // that faces A, which is the only reason it is that one.
    const dots = screen.getByTestId('connector-dots');
    expect(dots.dataset['hoverObjectId']).toBe(b);
    expect(screen.getByTestId('connector-dot-left').dataset['active']).toBe('true');
    expect(screen.getByTestId('connector-dot-right').dataset['active']).toBeUndefined();

    pointer('pointerUp', board(), bScreen);
    await actOn(nextFrame);

    const arrow = onlyConnector(fixture);
    expect(arrow.from.kind).toBe('attached');
    expect(arrow.to.kind).toBe('attached');
    if (arrow.from.kind !== 'attached' || arrow.to.kind !== 'attached') return;
    expect(arrow.from.objectId).toBe(a);
    expect(arrow.to.objectId).toBe(b);

    // One arrow, drawn: the preview is gone, the pointer is back to Select, and the arrow it made is the
    // thing that is selected — which is what makes the next thing a person does (move an end, delete it)
    // something they can do without looking for it.
    expect(screen.queryByTestId('connector-preview')).toBeNull();
    expect(toolOnScreen()).toBe('select');
    expect(fixture.selection().selectedId).toBe(arrow.id);
  });

  it('TC-19 attaches the end that was let go over nothing to nothing, at that point', async () => {
    const { fixture, a } = await threeShapes();
    await enterConnector();

    const intoTheAir = { x: -100, y: 120 };
    await dragArrow(screenOfWorld(centreOf(A)), screenOfWorld(intoTheAir));

    const arrow = onlyConnector(fixture);
    expect(arrow.from.kind).toBe('attached');
    // The end that went down on A is on A: which side of it, and where on that side, is the drawing's
    // business and is asked of the model below.
    if (arrow.from.kind !== 'attached') return;
    expect(arrow.from.objectId).toBe(a);
    expect(arrow.to.kind).toBe('free');
    if (arrow.to.kind !== 'free') return;
    // Fixed where the pointer was let go, which is the only place it could be fixed.
    expect(arrow.to.x).toBeCloseTo(intoTheAir.x, 6);
    expect(arrow.to.y).toBeCloseTo(intoTheAir.y, 6);
    expect(connectorEl(fixture, arrow.id).dataset['to']).toBe('free');
  });

  it('TC-19 refuses an arrow from a shape to itself, and stays where it was', async () => {
    const { fixture, at } = await threeShapes();
    await enterConnector();

    await dragArrow({ x: at.a.x - 40, y: at.a.y }, { x: at.a.x + 40, y: at.a.y });

    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(0);
    // The tool is still the tool: a refusal that also dropped the tool would be a person having to start
    // again for a mistake they did not mean to make.
    expect(toolOnScreen()).toBe('connector');
    expect(screen.queryByTestId('connector-preview')).toBeNull();
  });

  it(`TC-19 refuses an arrow of less than ${CONNECTOR_MIN_LENGTH_WORLD} units`, async () => {
    const fixture = renderBoard();
    await enterConnector();

    // Two points in the air, four units apart: not an arrow.
    await dragArrow(screenOfWorld({ x: -300, y: 0 }), screenOfWorld({ x: -296, y: 0 }));

    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(0);
    expect(toolOnScreen()).toBe('connector');
  });

  it('TC-19 writes nothing for a pointer the system took back', async () => {
    const { fixture, at } = await threeShapes();
    await enterConnector();

    pointer('pointerDown', board(), at.a);
    await actOn(nextFrame);
    pointer('pointerMove', board(), at.b);
    await actOn(nextFrame);
    pointer('pointerCancel', board(), at.b);
    await actOn(nextFrame);

    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(0);
    expect(toolOnScreen()).toBe('connector');
  });

  it('TC-22 keeps the tool until an arrow is made, and leaves it with the Escape key', async () => {
    const { fixture, at } = await threeShapes();
    await enterConnector();

    // Half-dragged, then the pointer let go over nothing at all: an arrow was made and the tool is done.
    await dragArrow(at.a, { x: at.a.x + 300, y: at.a.y + 200 });
    expect(onlyConnector(fixture).to.kind).toBe('free');
    expect(toolOnScreen()).toBe('select');

    // Back in, and out again with the keyboard, nothing written on the way.
    await enterConnector();
    await key('Escape');
    expect(toolOnScreen()).toBe('select');
    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(1);
  });

  it('TC-22 gives the shapes underneath it no press at all', async () => {
    const { fixture, a, at } = await threeShapes();
    const before = fixture.boundsOf(a);

    await enterConnector();
    // A drag that starts on A and ends on B: A does not move, because the press that began the arrow was
    // never a press on A as a thing to be moved.
    await dragArrow(at.a, at.b);

    const after = fixture.boundsOf(a);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(fixture.selection().size).toBe(1);
    expect(fixture.selection().selectedId).toBe(onlyConnector(fixture).id);
  });
});

describe('a shape that has been moved', () => {
  it('TC-21 moves the arrow that is attached to it, and writes nothing about the arrow', async () => {
    const { fixture, a, at } = await threeShapes();
    await enterConnector();
    await dragArrow(at.a, at.b);
    const arrow = onlyConnector(fixture);

    // Where the arrow is drawn now: the side of A that faces B, to the side of B that faces A.
    const before = connectorEnds(fixture.doc(), arrow.id);
    expect(before?.from.x).toBeCloseTo(A.x + A.width, 6);
    expect(before?.from.y).toBeCloseTo(A.y + A.height / 2, 6);
    expect(before?.to.x).toBeCloseTo(B.x, 6);

    // A is dragged 100 to the right and 40 down, by the board's own gesture, on the board's own surface.
    await fixture.dragObject(a, at.a, { x: at.a.x + 100, y: at.a.y + 40 });

    const ends = connectorEnds(fixture.doc(), arrow.id);
    expect(ends?.from.x).toBeCloseTo(A.x + A.width + 100, 6);
    expect(ends?.from.y).toBeCloseTo(A.y + A.height / 2 + 40, 6);
    // The other end did not move: B is where it was, so the arrow is longer and slanted, and that is all.
    expect(ends?.to.x).toBeCloseTo(B.x, 6);
    expect(ends?.to.y).toBeCloseTo(B.y + B.height / 2, 6);

    // Nothing was written about the arrow: the two ends still name the same two shapes. This is the whole
    // of why an arrow can follow a shape at all — there is no number of the arrow's own to be stale.
    const after = onlyConnector(fixture);
    expect(after.id).toBe(arrow.id);
    expect(after.from).toEqual(arrow.from);
    expect(after.to).toEqual(arrow.to);

    // …and the drawing agrees with the arithmetic: the box the arrow is drawn in is the box its two ends
    // are in, wherever the drag took them.
    const box = fixture.boundsOf(arrow.id);
    expect(box.x).toBeCloseTo(Math.min(ends?.from.x ?? 0, ends?.to.x ?? 0), 6);
    expect(box.width).toBeCloseTo(Math.abs((ends?.to.x ?? 0) - (ends?.from.x ?? 0)), 6);
  });

  it('TC-21 follows a shape moved by somebody else on the board', async () => {
    const { fixture, b, at } = await threeShapes();
    await enterConnector();
    await dragArrow(at.a, at.b);
    const arrow = onlyConnector(fixture);
    const before = connectorEnds(fixture.doc(), arrow.id);

    // B moved in the document with no gesture on this screen: another person, or another tab.
    await actOn(async () => {
      const objects = fixture.doc().getMap<unknown>('objects');
      const shape = objects.get(b) as unknown as { set(key: string, value: unknown): void };
      fixture.doc().transact(() => {
        shape.set('x', B.x + 300);
      });
      await nextFrame();
    });

    const ends = connectorEnds(fixture.doc(), arrow.id);
    expect(ends?.to.x).toBeCloseTo(B.x + 300, 6);
    expect((ends?.to.x ?? 0) > (before?.to.x ?? 0)).toBe(true);
    // The element's box followed it.
    expect(Number(connectorEl(fixture, arrow.id).dataset['x'])).toBeCloseTo(
      Math.min(ends?.from.x ?? 0, ends?.to.x ?? 0),
      6,
    );
  });

  it('TC-21 follows a shape that was resized, and keeps the side it was on', async () => {
    const { fixture, b, at } = await threeShapes();
    await enterConnector();
    await dragArrow(at.a, at.b);
    const arrow = onlyConnector(fixture);

    const before = connectorEnds(fixture.doc(), arrow.id);
    expect(before?.to.x).toBeCloseTo(B.x, 6);

    // B is made wider by dragging its west handle: the side the arrow is attached to moves, and the end of
    // the arrow moves with it. The end moved because the *side* moved — nobody wrote this arrow.
    await tap(fixture.objectEl(b) as HTMLElement, at.b);
    expect(fixture.selection().selectedId).toBe(b);
    const west = screenOfWorld({ x: B.x, y: B.y + B.height / 2 });
    await fixture.dragHandle('w', west, { x: west.x + 60, y: west.y });

    const ends = connectorEnds(fixture.doc(), arrow.id);
    expect((fixture.boundsOf(b).width as number) < B.width).toBe(true);
    expect(ends?.to.x).toBeCloseTo((before?.to.x ?? 0) + 60, 6);
    expect(onlyConnector(fixture).to.kind).toBe('attached');
  });
});

describe('clicking an arrow', () => {
  /** An arrow from A to B, with the board and the three shapes. */
  async function arrow(): Promise<{ fixture: BoardFixture; id: string; at: Record<'a' | 'b' | 'c', { x: number; y: number }> }> {
    const { fixture, at } = await threeShapes();
    await enterConnector();
    await dragArrow(at.a, at.b);
    return { fixture, id: onlyConnector(fixture).id, at };
  }

  it('TC-20 catches the line in a band of screen pixels that does not change with the zoom', async () => {
    const { fixture, id } = await arrow();
    const snapshot = onlyConnector(fixture);
    const rects = new Map(fixture.objects().map((object) => [object.id, fixture.boundsOf(object.id)] as const));
    const middle = { x: (A.x + A.width + B.x) / 2, y: A.y + A.height / 2 };

    // Five screen pixels from the line at this zoom, and seven: the first is on the arrow and the second is
    // on the board. The distances are asked in world units at the zoom the board is drawn at, which is the
    // same question the click path asks.
    const asks = (zoom: number, screenPixels: number): boolean => {
      const world = screenPixels / zoom;
      return hitTestObject(snapshot, { x: middle.x, y: middle.y + world }, { zoom, rects });
    };
    expect(asks(1, 5)).toBe(true);
    expect(asks(1, 7)).toBe(false);
    expect(asks(0.5, 5)).toBe(true);
    expect(asks(0.5, 7)).toBe(false);
    expect(asks(2, 5)).toBe(true);
    expect(asks(2, 7)).toBe(false);

    // The drawn band is the same number of screen pixels at every zoom, which is what the element says out
    // loud: twice the tolerance, in world units, divided by however big the board is being drawn.
    const widthAt = async (zoom: number): Promise<number> => {
      await actOn(async () => {
        window.__vidi6?.setCamera({ zoom });
        await nextFrame();
      });
      return Number(screen.getByTestId('connector-hit').dataset['strokeWidth']);
    };
    expect(await widthAt(1)).toBeCloseTo(2 * CONNECTOR_HIT_TOLERANCE_PX, 6);
    expect(await widthAt(0.5)).toBeCloseTo(2 * CONNECTOR_HIT_TOLERANCE_PX / 0.5, 6);
    expect(await widthAt(2)).toBeCloseTo(2 * CONNECTOR_HIT_TOLERANCE_PX / 2, 6);
    expect(fixture.objectEl(id)).not.toBeNull();
  });

  it('TC-20 leaves the air beside the line to the board', async () => {
    const { fixture, id } = await arrow();
    const snapshot = onlyConnector(fixture);
    const rects = new Map(fixture.objects().map((object) => [object.id, fixture.boundsOf(object.id)] as const));

    // The middle of an arrow's box, a long way from its line: the box of an arrow from A to B covers half
    // the board, and a click in the middle of it that selected the arrow would be a click on nothing that
    // selected something.
    const far = { x: (A.x + B.x + B.width) / 2, y: A.y - 80 };
    expect(hitTestObject(snapshot, far, { zoom: 1, rects })).toBe(false);
    expect(id).toBeTruthy();
  });

  it('TC-20 selects the arrow and nothing else, without moving it', async () => {
    const { fixture, id } = await arrow();
    await actOn(async () => {
      // The only part of an arrow a pointer can catch: the invisible stroke over the line.
      pointer('pointerDown', screen.getByTestId('connector-hit'), { x: 0, y: 0 });
      pointer('pointerUp', screen.getByTestId('connector-hit'), { x: 0, y: 0 });
      await nextFrame();
    });

    expect(fixture.selection().selectedId).toBe(id);
    // An arrow has no position to move, so a press on it is not the start of a drag: its ends are exactly
    // what the tool wrote, and there is nothing in the history for a press that only selected it.
    const made = onlyConnector(fixture);
    expect(made.from.kind).toBe('attached');
    expect(made.to.kind).toBe('attached');
  });
});

describe('the two handles of an arrow', () => {
  it('TC-22 grows a handle at each end when it is selected, and puts a handle back where it came from when the drop is refused', async () => {
    const { fixture, id, at } = await arrowOnBoard();

    // The arrow came out of the tool selected, and an arrow that is selected shows the two things it can
    // be re-aimed by. Nothing else on the board is: an arrow is not resized, so the selection's own box
    // offers no handles of its own here.
    expect(fixture.selection().selectedId).toBe(id);
    expect(fixture.handles().sort()).toEqual(['connector-from', 'connector-to']);

    // Let go over the shape the other end is already on: an arrow that begins and ends on one shape is
    // not an arrow, and the model says so. The handle goes back where it came from.
    const before = onlyConnector(fixture);
    await dragHandle('to', at.b, at.a);
    const after = onlyConnector(fixture);
    expect(after.to).toEqual(before.to);
    expect(after.from).toEqual(before.from);
    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(1);
  });

  it('TC-22 re-aims an end at a third shape, and the arrow turns round it', async () => {
    const { fixture, id, at } = await arrowOnBoard();
    await selectArrow(fixture, id);

    await dragHandle('to', at.b, at.c);

    const arrow = onlyConnector(fixture);
    expect(arrow.to.kind).toBe('attached');
    if (arrow.to.kind !== 'attached') return;
    expect(arrow.to.objectId).toBe(await shapeAt(fixture, C));
    // The end is drawn on the side of C that faces A, which is the side the model chose and the only side
    // this test can name without duplicating the arithmetic.
    const ends = connectorEnds(fixture.doc(), id);
    expect(ends?.to.x).toBeCloseTo(C.x + C.width / 2, 6);
    expect(ends?.to.y).toBeCloseTo(C.y, 6);
    expect(arrow.from.kind).toBe('attached');
  });

  it('TC-22 lets an end go over nothing, and fixes it to that point', async () => {
    const { fixture, id, at } = await arrowOnBoard();
    await selectArrow(fixture, id);

    const intoTheAir = { x: 100, y: 20 };
    await dragHandle('to', at.b, screenOfWorld(intoTheAir));

    const arrow = onlyConnector(fixture);
    expect(arrow.to.kind).toBe('free');
    if (arrow.to.kind !== 'free') return;
    expect(arrow.to.x).toBeCloseTo(intoTheAir.x, 6);
    expect(arrow.to.y).toBeCloseTo(intoTheAir.y, 6);
    expect(connectorEl(fixture, id).dataset['to']).toBe('free');
    // The end that was not touched stayed on its shape.
    expect(arrow.from.kind).toBe('attached');
  });

  it('TC-22 moves one end and not the other, and the arrow stays one object', async () => {
    const { fixture, id, at } = await arrowOnBoard();
    await selectArrow(fixture, id);

    const intoTheAir = { x: 120, y: -220 };
    await dragHandle('from', at.a, screenOfWorld(intoTheAir));

    const arrow = onlyConnector(fixture);
    expect(arrow.from.kind).toBe('free');
    expect(arrow.to.kind).toBe('attached');
    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(1);
    expect(fixture.objects().filter(isShapeSnapshot)).toHaveLength(3);
  });

  it('TC-22 shows the arrow following the handle while it is being dragged, and only then', async () => {
    const { fixture, id, at } = await arrowOnBoard();
    await selectArrow(fixture, id);

    const intoTheAir = { x: 60, y: 240 };
    pointer('pointerDown', screen.getByTestId('connector-handle-to'), at.b);
    await actOn(nextFrame);
    pointer('pointerMove', screen.getByTestId('connector-handle-to'), screenOfWorld(intoTheAir));
    await actOn(nextFrame);

    // The point of the arrow is at the pointer, not at where the end is in the document: a handle that
    // stays put while it is being dragged is a handle that is not being dragged. The line stops short of
    // the point to make room for the head, so the head is what says where the pointer is.
    const head = screen.getByTestId('connector-head');
    const tip = Number(String(head.getAttribute('points') ?? '').split(' ')[0]?.split(',')[0]);
    expect(tip + Number(connectorEl(fixture, id).dataset['x'])).toBeCloseTo(intoTheAir.x, 6);
    // Nothing has been written yet: the end goes where the pointer leaves it, and until then the document
    // says nothing about it.
    expect(onlyConnector(fixture).to.kind).toBe('attached');

    pointer('pointerUp', screen.getByTestId('connector-handle-to'), screenOfWorld(intoTheAir));
    await actOn(nextFrame);
    expect(onlyConnector(fixture).to.kind).toBe('free');
  });

  it('TC-22 puts nothing at the end of a pointer the system took back', async () => {
    const { fixture, id, at } = await arrowOnBoard();
    await selectArrow(fixture, id);
    const before = onlyConnector(fixture);

    pointer('pointerDown', screen.getByTestId('connector-handle-to'), at.b);
    await actOn(nextFrame);
    pointer('pointerMove', screen.getByTestId('connector-handle-to'), screenOfWorld({ x: 200, y: 200 }));
    await actOn(nextFrame);
    pointer('pointerCancel', screen.getByTestId('connector-handle-to'), screenOfWorld({ x: 200, y: 200 }));
    await actOn(nextFrame);

    expect(onlyConnector(fixture).to).toEqual(before.to);
    expect(screen.queryByTestId('connector-line')).not.toBeNull();
  });

  it('TC-22 is a handle on a board that cannot be written to, and does nothing', async () => {
    // A board that cannot be written to still draws the handles — they say what an arrow is made of — but
    // the press that would drag one does nothing at all, because a handle that moves an end on a board
    // where nobody may write is an invitation to write.
    const provider = new FakeProvider();
    const fixture = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
    const a = await addShape(fixture, A);
    const b = await addShape(fixture, B);
    await actOn(async () => {
      createConnector(
        fixture.doc(),
        { kind: 'attached', objectId: a, fallback: centreOf(A) },
        { kind: 'attached', objectId: b, fallback: centreOf(B) },
      );
      await nextFrame();
    });
    const arrow = onlyConnector(fixture);

    // The board stops being writable while the arrow is on screen.
    await actOn(async () => {
      provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
      await nextFrame();
    });

    await selectArrow(fixture, arrow.id);
    const before = onlyConnector(fixture);

    pointer('pointerDown', screen.getByTestId('connector-handle-to'), screenOfWorld(centreOf(B)));
    await actOn(nextFrame);
    pointer('pointerMove', screen.getByTestId('connector-handle-to'), screenOfWorld({ x: 300, y: 300 }));
    await actOn(nextFrame);
    pointer('pointerUp', screen.getByTestId('connector-handle-to'), screenOfWorld({ x: 300, y: 300 }));
    await actOn(nextFrame);

    expect(onlyConnector(fixture).to).toEqual(before.to);
    expect(fixture.objects().filter(isConnectorSnapshot)).toHaveLength(1);
  });

  /** An arrow from A to B on a fresh board, with the shapes' screen points. */
  async function arrowOnBoard(): Promise<{ fixture: BoardFixture; id: string; at: Record<'a' | 'b' | 'c', { x: number; y: number }> }> {
    const { fixture, at } = await threeShapes();
    await enterConnector();
    await dragArrow(screenOfWorld(centreOf(A)), screenOfWorld(centreOf(B)));
    return { fixture, id: onlyConnector(fixture).id, at };
  }

  /** Selects an arrow by pressing the only part of it a pointer can catch. */
  async function selectArrow(fixture: BoardFixture, id: string): Promise<void> {
    await actOn(async () => {
      const el = fixture.objectEl(id);
      const hit = el?.querySelector('[data-testid="connector-hit"]');
      if (!(hit instanceof Element)) throw new Error('the arrow offers nothing to press');
      pointer('pointerDown', hit as unknown as HTMLElement, { x: 0, y: 0 });
      pointer('pointerUp', hit as unknown as HTMLElement, { x: 0, y: 0 });
      await nextFrame();
    });
  }

  /** Drags one end's handle from one point on the screen to another, and lets go. */
  async function dragHandle(
    which: 'from' | 'to',
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    const handleName = `connector-${which}`;
    await actOn(async () => {
      const el = document.querySelector<HTMLElement>(`[data-handle="${handleName}"]`);
      if (el === null) throw new Error('the arrow offers no such handle');
      pointer('pointerDown', el, from);
      await nextFrame();
      pointer('pointerMove', el, to);
      await nextFrame();
      pointer('pointerUp', el, to);
      await nextFrame();
    });
  }

  /** Which shape the board holds at a world point. */
  async function shapeAt(fixture: BoardFixture, rect: Rect): Promise<string> {
    const found = fixture.objects().filter(isShapeSnapshot).find((shape) => shape.x === rect.x && shape.y === rect.y);
    if (found === undefined) throw new Error('no shape at that place');
    return found.id;
  }
});

/** Presses, releases and clicks, which is what a browser makes of a click. */
async function tap(target: HTMLElement, point: { x: number; y: number }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await actOn(async () => {
    fireEvent.click(target, { clientX: point.x, clientY: point.y });
    await nextFrame();
  });
}
