/**
 * Arrows between things (`connector.ui`).
 *
 * The interesting part of an arrow is that it is not where it was: it is where the things at its
 * ends are now. Most of what follows is therefore asked twice — once about the drag that made it,
 * and once about what happens to it afterwards, including to a second person who never touched it.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, deleteObjects, moveObjects, objectBounds, type ObjectSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';
import { worldToScreen } from '../../src/client/canvas/camera';
import type { ConnectorSnap } from '../../src/shared/objects/connector';
import { createShape } from '../../src/shared/objects/shape';
import {
  fireKey,
  firePointer,
  flushCameraFrame,
  flushFrames,
  setTestCamera,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  toolButton,
  toolPressed,
  viewportElement
} from './harness';

const connection: { current: string } = { current: 'connected' };

vi.mock('../../src/client/board/useBoardDoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/board/useBoardDoc')>();
  return {
    ...actual,
    useBoardDoc: (options: Parameters<typeof actual.useBoardDoc>[0]) => ({
      ...actual.useBoardDoc(options),
      connection: connection.current
    })
  };
});

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  connection.current = 'connected';
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
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** A board point as the screen sees it right now, at whatever zoom the board is at. */
function screen(world: Point): Point {
  return worldToScreen(testCamera(), world);
}

function connectors(board: BoardFixture): ConnectorSnap[] {
  return board.objects().filter((object) => object.type === 'connector') as ConnectorSnap[];
}

function connectorElement(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (!element) throw new Error(`connector ${id} is not on screen`);
  return element;
}

/** Put a shape on the board the way the model does. */
function addShape(board: BoardFixture, x: number, y: number, size = 200): string {
  let id = '';
  act(() => {
    id = createShape(board.doc, { kind: 'rect', rect: { x, y, width: size, height: size }, at: { x, y } }, '') ?? '';
  });
  if (!id) throw new Error('the shape was not created');
  return id;
}

/** The Connector tool's surface: in a browser, the only thing under the pointer. */
function connectorSurface(board: BoardFixture): HTMLElement {
  const element = board.root.querySelector<HTMLElement>('[data-vidi6="connector-tool"]');
  if (!element) throw new Error('the Connector tool is not being held');
  return element;
}

function holdConnectorTool(board: BoardFixture): void {
  fireKey('l');
  expect(viewportElement(board.root).dataset.tool).toBe('connector');
  expect(toolPressed(toolButton(board.root, 'connector'))).toBe(true);
}

function dots(board: BoardFixture): HTMLElement[] {
  return [...board.root.querySelectorAll<HTMLElement>('[data-vidi6="connector-dot"]')];
}

/** Press, move in steps, release. */
async function drag(target: Element, from: Point, to: Point, steps = 3): Promise<void> {
  firePointer(target, 'pointerdown', from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      target,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
    await flushFrames();
  }
  firePointer(target, 'pointerup', to.x, to.y);
  await flushFrames();
}

/** Two shapes 300 units apart, A on the left and B on the right, both centred on y = 0. */
function pair(board: BoardFixture): { a: string; b: string } {
  const a = addShape(board, -400, -100);
  const b = addShape(board, 100, -100);
  return { a, b };
}

/** An arrow from A's right side to B's left side, drawn by hand. */
async function drawArrow(board: BoardFixture): Promise<ConnectorSnap> {
  holdConnectorTool(board);
  await drag(connectorSurface(board), screen({ x: -200, y: 0 }), screen({ x: 100, y: 0 }));
  const [arrow] = connectors(board);
  if (!arrow) throw new Error('the arrow was not created');
  return arrow;
}

describe('the Connector tool', () => {
  it('TC-18: shows the four sides an arrow could leave from', async () => {
    const board = await renderBoard();
    const { b } = pair(board);
    await flushFrames();
    holdConnectorTool(board);
    expect(dots(board)).toHaveLength(0);

    // The pointer is over B, so B grows dots — one per side, at the middle of that side.
    firePointer(connectorSurface(board), 'pointermove', screen({ x: 200, y: -20 }).x, screen({ x: 200, y: -20 }).y);
    await flushFrames();
    const shown = dots(board);
    expect(shown).toHaveLength(4);
    expect(shown.map((dot) => dot.dataset.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    for (const dot of shown) {
      expect(dot.dataset.objectId).toBe(b);
      expect(dot.dataset.highlighted).toBe('false');
      const side = dot.dataset.side;
      const at = {
        left: { x: 100, y: 0 },
        right: { x: 300, y: 0 },
        top: { x: 200, y: -100 },
        bottom: { x: 200, y: 100 }
      }[side as 'left' | 'right' | 'top' | 'bottom']!;
      expect([Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]).toEqual([
        screen(at).x,
        screen(at).y
      ]);
    }

    // Move onto nothing, and they go away.
    firePointer(connectorSurface(board), 'pointermove', screen({ x: 0, y: 400 }).x, screen({ x: 0, y: 400 }).y);
    await flushFrames();
    expect(dots(board)).toHaveLength(0);
  });

  it('TC-19: drags from one shape to another, saying which side it will land on', async () => {
    const board = await renderBoard();
    const { a, b } = pair(board);
    await flushFrames();

    holdConnectorTool(board);
    const surface = connectorSurface(board);
    firePointer(surface, 'pointerdown', screen({ x: -200, y: 0 }).x, screen({ x: -200, y: 0 }).y);
    await flushFrames();
    expect(connectors(board)).toHaveLength(0);

    const over = screen({ x: 100, y: 0 });
    firePointer(surface, 'pointermove', over.x, over.y);
    await flushFrames();

    // The side facing where the arrow comes from is the one that lights up.
    const lit = dots(board).filter((dot) => dot.dataset.highlighted === 'true');
    expect(lit).toHaveLength(1);
    expect(lit[0].dataset.objectId).toBe(b);
    expect(lit[0].dataset.side).toBe('left');
    expect(board.root.querySelector('[data-testid="connector-preview"]')).not.toBeNull();

    firePointer(surface, 'pointerup', over.x, over.y);
    await flushFrames();

    const [arrow] = connectors(board);
    expect(arrow).toBeDefined();
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(arrow.points).toEqual({ from: { x: -200, y: 0 }, to: { x: 100, y: 0 } });
    // The pen is put down and the arrow is what is selected (`tools.pen`).
    expect(viewportElement(board.root).dataset.tool).toBe('select');
    expect(connectorElement(board, arrow.id).dataset.selected).toBe('true');
  });

  it('ties an end to nothing when it is let go over empty board', async () => {
    const board = await renderBoard();
    pair(board);
    await flushFrames();
    holdConnectorTool(board);
    await drag(connectorSurface(board), screen({ x: -200, y: 0 }), screen({ x: 250, y: 250 }));
    const [arrow] = connectors(board);
    expect(arrow.from.kind).toBe('attached');
    // A free end is stored where it was let go, and stays there however the shapes move.
    expect(arrow.to).toEqual({ kind: 'free', x: 250, y: 250 });
    expect(arrow.points.to).toEqual({ x: 250, y: 250 });
  });

  it('writes nothing for an arrow that points at itself, or too short to point anywhere', async () => {
    const board = await renderBoard();
    pair(board);
    await flushFrames();

    holdConnectorTool(board);
    // From A back onto A: refused, and the tool stays in the hand to try again.
    await drag(connectorSurface(board), screen({ x: -200, y: 0 }), screen({ x: -300, y: 0 }));
    expect(connectors(board)).toHaveLength(0);
    expect(viewportElement(board.root).dataset.tool).toBe('connector');

    // A flick shorter than the smallest arrow: also nothing (`connector.create_short`).
    await drag(connectorSurface(board), screen({ x: 0, y: 300 }), screen({ x: 5, y: 305 }));
    expect(connectors(board)).toHaveLength(0);

    // Escape puts the tool down without making one (TC-22's promise, at the screen level).
    fireKey('Escape');
    await flushFrames();
    expect(viewportElement(board.root).dataset.tool).toBe('select');
    expect(connectors(board)).toHaveLength(0);
  });

  it('TC-20: is picked up by how near its line the click was, at 50% and at 200%', async () => {
    const board = await renderBoard();
    pair(board);
    await flushFrames();
    const arrow = await drawArrow(board);

    for (const zoom of [0.5, 2]) {
      await setTestCamera({ x: -640, y: -400, zoom });
      // Put the selection down first: this click has to be the thing that picks the arrow up.
      fireKey('Escape');
      await flushFrames();
      const element = connectorElement(board, arrow.id);
      const onTheLine = screen({ x: -50, y: 0 });

      // 7 screen pixels away is still a click on the board, not on the arrow.
      firePointer(element, 'pointerdown', onTheLine.x, onTheLine.y + 7);
      firePointer(element, 'pointerup', onTheLine.x, onTheLine.y + 7);
      await flushFrames();
      expect(element.dataset.selected).toBe('false');

      // 5 screen pixels away is the arrow, and the arrow alone.
      firePointer(element, 'pointerdown', onTheLine.x, onTheLine.y + 5);
      firePointer(element, 'pointerup', onTheLine.x, onTheLine.y + 5);
      await flushFrames();
      expect(connectorElement(board, arrow.id).dataset.selected).toBe('true');
    }
  });

  it('TC-21: drags an end of a selected arrow onto something else, or into space', async () => {
    const board = await renderBoard();
    const { a } = pair(board);
    const c = addShape(board, 100, 250);
    await flushFrames();
    const arrow = await drawArrow(board);
    expect(connectors(board)[0].to).toMatchObject({ kind: 'attached' });

    const element = connectorElement(board, arrow.id);
    expect(element.dataset.selected).toBe('true');
    const handles = () => board.root.querySelectorAll('[data-vidi6="connector-end"]');
    expect(handles()).toHaveLength(2);

    // Drag the arrowhead onto C.
    const handle = board.root.querySelector('[data-vidi6="connector-end"][data-end="to"]')!;
    const onto = screen({ x: 200, y: 350 });
    firePointer(handle, 'pointerdown', onto.x, onto.y);
    await flushFrames();
    firePointer(window as unknown as Element, 'pointermove', onto.x, onto.y);
    await flushFrames();
    // While it is in the air the end follows the pointer, and says what it would tie itself to.
    const pending = board.root.querySelector('[data-vidi6="connector-reattach"]') as HTMLElement;
    expect(pending).not.toBeNull();
    expect(pending.dataset.end).toBe('to');
    expect(pending.dataset.target).toBe(c);
    firePointer(window as unknown as Element, 'pointerup', onto.x, onto.y);
    await flushFrames();
    expect(connectors(board)[0].to).toMatchObject({ kind: 'attached', objectId: c });

    // Drag it back out to empty board: the end is fixed where the pointer let go.
    const toHandle = board.root.querySelector('[data-vidi6="connector-end"][data-end="to"]')!;
    const empty = screen({ x: 500, y: -300 });
    firePointer(toHandle, 'pointerdown', empty.x, empty.y);
    firePointer(window as unknown as Element, 'pointermove', empty.x, empty.y);
    firePointer(window as unknown as Element, 'pointerup', empty.x, empty.y);
    await flushFrames();
    expect(connectors(board)[0].to).toEqual({ kind: 'free', x: 500, y: -300 });

    // Drag the *other* end onto the object this end is not attached to but used to be: B is gone
    // from the arrow, so A is the object at the other end and the release is refused — the handle
    // goes back where it was, and the arrow is unchanged.
    // Drag the other end back onto A. A is the object at *this* arrow's other end, so the model
    // refuses the release: the handle goes back where it was and nothing is written (`connector.reattach`).
    const fromHandle = board.root.querySelector('[data-vidi6="connector-end"][data-end="from"]')!;
    const fromBefore = JSON.stringify(connectors(board)[0].from);
    const ontoA = screen({ x: -300, y: 0 });
    firePointer(fromHandle, 'pointerdown', ontoA.x, ontoA.y);
    firePointer(window as unknown as Element, 'pointermove', ontoA.x, ontoA.y);
    firePointer(window as unknown as Element, 'pointerup', ontoA.x, ontoA.y);
    await flushFrames();
    expect(JSON.stringify(connectors(board)[0].from)).toBe(fromBefore);
    expect(connectors(board)[0].from).toMatchObject({ kind: 'attached', objectId: a });
  });

  it('lets go of a dragged end on a cancelled pointer without re-tying it', async () => {
    const board = await renderBoard();
    pair(board);
    await flushFrames();
    await drawArrow(board);
    const before = JSON.stringify(connectors(board)[0].to);

    const handle = board.root.querySelector('[data-vidi6="connector-end"][data-end="to"]')!;
    const elsewhere = screen({ x: 400, y: 400 });
    firePointer(handle, 'pointerdown', elsewhere.x, elsewhere.y);
    firePointer(window as unknown as Element, 'pointercancel', elsewhere.x, elsewhere.y);
    await flushFrames();
    expect(JSON.stringify(connectors(board)[0].to)).toBe(before);
    expect(board.root.querySelector('[data-vidi6="connector-reattach"]')).toBeNull();
    // Still selected, so the handles come back and the gesture can be tried again.
    expect(board.root.querySelectorAll('[data-vidi6="connector-end"]')).toHaveLength(2);
  });

  it('follows a shape that moved, sides and all, without a word about it', async () => {
    const board = await renderBoard();
    const { a, b } = pair(board);
    await flushFrames();
    const arrow = await drawArrow(board);
    expect(connectorElement(board, arrow.id).dataset.x).toBe('-200');

    // Somebody else drags B right past A. Only the document changes; nothing here is told.
    act(() => {
      moveObjects(board.doc, new Map([[b, { x: -800, y: -100 }]]));
    });
    await flushCameraFrame();

    const moved = connectors(board)[0];
    // A now faces left towards B, and B faces right towards A: both ends switched side at the
    // diagonal, on this screen, without a write (`connector.follow`).
    expect(moved.points).toEqual({ from: { x: -400, y: 0 }, to: { x: -600, y: 0 } });
    expect(objectBounds(moved)).toEqual({ x: -600, y: 0, width: 200, height: 0 });
    expect(connectorElement(board, arrow.id).dataset.x).toBe('-600');
    // The arrow is still tied to both of them.
    expect(moved.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(moved.to).toMatchObject({ kind: 'attached', objectId: b });
  });

  it('goes on being drawn, at the side a deleted shape last was', async () => {
    const board = await renderBoard();
    const { b } = pair(board);
    await flushFrames();
    const arrow = await drawArrow(board);

    // Delete the shape at one end (`connector.detach`, and the model's TC-13): the arrow stays.
    act(() => {
      deleteObjects(board.doc, [b]);
    });
    await flushCameraFrame();

    const after = connectors(board)[0];
    expect(after.to.kind).toBe('free');
    // Its end is fixed at the side that shape was tied to, so the arrow still says what it meant.
    expect(after.points.to).toEqual({ x: 100, y: 0 });
    const element = connectorElement(board, arrow.id);
    expect(element.dataset.to).toBe('free');
    expect(board.objects().some((object) => object.id === b)).toBe(false);
  });
});
