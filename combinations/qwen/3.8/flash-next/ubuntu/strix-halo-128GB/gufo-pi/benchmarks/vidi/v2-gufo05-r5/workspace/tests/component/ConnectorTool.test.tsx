/**
 * Connector tool and connector object component tests (tasks 13, 14).
 *
 * TC-18 hovering shows the four places an arrow could leave from; TC-19 dragging from one object to
 * another highlights the side it would leave and creates one arrow attached at both ends; TC-20 a
 * click is measured against the line in screen pixels, at every zoom; TC-21 an end handle re-attaches
 * to whatever it is dropped on and is left free when dropped on nothing.
 */
import { act, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, dispatchKey, runFrames } from './helpers';
import {
  createConnector,
  createShape,
  isConnectorSnapshot,
  type ConnectorSnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function objects(): readonly ObjectSnapshot[] {
  return window.__vidi6?.getObjects() ?? [];
}

function connectors(): readonly ConnectorSnapshot[] {
  return objects().filter(isConnectorSnapshot);
}

function connectorElement(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (!el) throw new Error(`connector ${id} is not rendered`);
  return el;
}

function toolSurface(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="connector-tool-surface"]');
  if (!el) throw new Error('the Connector tool is not up');
  return el;
}

function toolSurfaceOrNone(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="connector-tool-surface"]');
}

function dots(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]'));
}

function handleOf(end: 'from' | 'to'): SVGCircleElement {
  const el = document.querySelector<SVGCircleElement>(`[data-connector-handle="${end}"]`);
  if (!el) throw new Error(`the ${end} end handle is not rendered`);
  return el;
}

function hitLine(): SVGLineElement {
  const el = document.querySelector<SVGLineElement>('[data-testid="connector-hit"]');
  if (!el) throw new Error('the connector line is not rendered');
  return el;
}

function selectButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Select (V)' });
}

async function addShape(rect: Rect): Promise<string> {
  let id = '';
  await act(() => {
    id =
      createShape(
        doc(),
        { kind: 'rect', rect, at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } },
        'local',
      ) ?? '';
  });
  await runFrames();
  return id;
}

/** One arrow between two shapes, attached at both ends, made the way the model means it. */
async function addConnector(fromId: string, toId: string): Promise<string> {
  let id = '';
  await act(() => {
    id =
      createConnector(
        doc(),
        { kind: 'attached', objectId: fromId, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: toId, fallback: { x: 0, y: 0 } },
        'local',
      ) ?? '';
  });
  await runFrames();
  return id;
}

async function openBoard(camera = { x: 0, y: 0, zoom: 1 }): Promise<void> {
  renderBoard();
  await runFrames();
  window.__vidi6!.setCamera(camera);
  await runFrames();
  await runFrames();
}

async function connectorToolUp(): Promise<void> {
  dispatchKey(window, { key: 'l' });
  await runFrames();
}

// A: 100,100 200x120 - centre (200,160), right anchor (300,160)
const A = { x: 100, y: 100, width: 200, height: 120 };
// B: 500,100 200x120 - centre (600,160), left anchor (500,160)
const B = { x: 500, y: 100, width: 200, height: 120 };
// C: 300,500 200x120 - centre (400,560), top anchor (400,500)
const C = { x: 300, y: 500, width: 200, height: 120 };

describe('the Connector tool (TC-18, TC-19)', () => {
  test('TC-18 hovering an object shows four dots, one at the middle of each side', async () => {
    await openBoard();
    const a = await addShape(A);

    await connectorToolUp();
    const surface = toolSurface();
    expect(dots().length).toBe(0);

    // the pointer is over the shape: its four attachment points appear, constant in size on screen
    fireEvent.pointerMove(surface, pointer(200, 160));
    await runFrames();

    const shown = dots();
    expect(shown.length).toBe(4);
    const radius = CONNECTOR_DOT_RADIUS_PX;
    const expected: Record<string, [number, number]> = {
      top: [200, 100],
      right: [300, 160],
      bottom: [200, 220],
      left: [100, 160],
    };
    for (const dot of shown) {
      const side = dot.getAttribute('data-connector-dot') ?? '';
      const [x, y] = expected[side]!;
      expect(dot.getAttribute('data-target-id')).toBe(a);
      expect(dot.style.left).toBe(`${x - radius}px`);
      expect(dot.style.top).toBe(`${y - radius}px`);
      expect(dot.style.width).toBe(`${radius * 2}px`);
      expect(dot.style.height).toBe(`${radius * 2}px`);
      expect(dot).not.toHaveAttribute('data-highlighted');
    }

    // off the shape again, and they are gone
    fireEvent.pointerMove(surface, pointer(900, 900));
    await runFrames();
    expect(dots().length).toBe(0);
  });

  test('TC-19 dragging from a shape to another highlights the side the arrow would leave, and makes one attached arrow', async () => {
    await openBoard();
    const a = await addShape(A);
    const b = await addShape(B);

    await connectorToolUp();
    const surface = toolSurface();

    // start on A: the drag is drawn from there, and nothing is highlighted until there is a target
    fireEvent.pointerMove(surface, pointer(200, 160));
    fireEvent.pointerDown(surface, pointer(200, 160));
    await runFrames();
    expect(document.querySelector('[data-testid="connector-preview"]')).toBeTruthy();

    // over B: the side facing A - its left - is the one that lights up, because that is where the
    // finished arrow would leave B
    fireEvent.pointerMove(surface, pointer(600, 160));
    await runFrames();
    const lit = dots().filter((dot) => dot.getAttribute('data-highlighted') === 'true');
    expect(lit.length).toBe(1);
    expect(lit[0]?.getAttribute('data-connector-dot')).toBe('left');
    expect(lit[0]?.getAttribute('data-target-id')).toBe(b);

    fireEvent.pointerUp(surface, pointer(600, 160));
    await runFrames();

    const made = connectors();
    expect(made.length).toBe(1);
    expect(made[0]?.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(made[0]?.to).toMatchObject({ kind: 'attached', objectId: b });
    // anchored on the two facing sides, not on the centres the drag happened to start and end at
    expect(made[0]?.ends).toEqual({ from: { x: 300, y: 160 }, to: { x: 500, y: 160 } });

    // the arrow is selected and Select is the tool again
    expect(connectorElement(made[0]!.id)).toHaveAttribute('data-selected', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(toolSurfaceOrNone()).toBeNull();
  });

  test('TC-19 a drop back on the object at the other end makes nothing and leaves the tool up', async () => {
    await openBoard();
    await addShape(A);

    await connectorToolUp();
    const surface = toolSurface();
    fireEvent.pointerDown(surface, pointer(200, 160));
    fireEvent.pointerMove(surface, pointer(250, 190));
    fireEvent.pointerUp(surface, pointer(250, 190));
    await runFrames();

    expect(connectors().length).toBe(0);
    expect(toolSurfaceOrNone()).not.toBeNull();
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
  });

  test('TC-19 an end released over empty space stays where it was released', async () => {
    await openBoard();
    const a = await addShape(A);

    await connectorToolUp();
    const surface = toolSurface();
    fireEvent.pointerDown(surface, pointer(200, 160));
    fireEvent.pointerMove(surface, pointer(700, 620));
    fireEvent.pointerUp(surface, pointer(700, 620));
    await runFrames();

    const made = connectors();
    expect(made.length).toBe(1);
    expect(made[0]?.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(made[0]?.to).toEqual({ kind: 'free', x: 700, y: 620 });
  });
});

describe('the connector object (TC-20, TC-21)', () => {
  test('TC-20 a click within 6 pixels of the line selects it, 7 does not, at half zoom and at double', async () => {
    // half zoom: 5 screen px is 10 world units, 7 is 14
    await openBoard({ x: 0, y: 0, zoom: 0.5 });
    const a = await addShape(A);
    const b = await addShape(B);
    const id = await addConnector(a, b);
    expect(connectorElement(id)).toBeTruthy();

    // a point on the line is world (400,160); the screen is the world times the zoom
    const click = (worldX: number, worldY: number) => {
      const line = hitLine();
      const at = { clientX: worldX * 0.5, clientY: worldY * 0.5 };
      fireEvent.pointerDown(line, pointer(at.clientX, at.clientY));
      fireEvent.pointerUp(line, pointer(at.clientX, at.clientY));
    };

    // 10 world units off the line is 5 screen pixels at this zoom
    click(400, 170);
    await runFrames();
    expect(connectorElement(id)).toHaveAttribute('data-selected', 'true');

    dispatchKey(window, { key: 'Escape' });
    await runFrames();
    expect(connectorElement(id)).not.toHaveAttribute('data-selected');

    // 14 world units is 7 screen pixels: the board's, not the arrow's
    click(400, 174);
    await runFrames();
    expect(connectorElement(id)).not.toHaveAttribute('data-selected');
  });

  test('TC-20 the same arrow is no easier to catch when the board is zoomed in', async () => {
    await openBoard({ x: 0, y: 0, zoom: 2 });
    const a = await addShape(A);
    const b = await addShape(B);
    const id = await addConnector(a, b);

    const click = (worldX: number, worldY: number) => {
      const line = hitLine();
      const at = { clientX: worldX * 2, clientY: worldY * 2 };
      fireEvent.pointerDown(line, pointer(at.clientX, at.clientY));
      fireEvent.pointerUp(line, pointer(at.clientX, at.clientY));
    };

    // 2.5 world units off the line is 5 screen pixels at this zoom
    click(400, 162.5);
    await runFrames();
    expect(connectorElement(id)).toHaveAttribute('data-selected', 'true');

    dispatchKey(window, { key: 'Escape' });
    await runFrames();
    click(400, 163.5);
    await runFrames();
    expect(connectorElement(id)).not.toHaveAttribute('data-selected');
  });

  test('TC-21 dragging an end onto a third object re-attaches it; dropping it on nothing leaves it free', async () => {
    await openBoard();
    const a = await addShape(A);
    const b = await addShape(B);
    const c = await addShape(C);
    const id = await addConnector(a, b);

    // select the arrow by clicking its line, at its middle
    clickLine();
    await runFrames();
    expect(connectorElement(id)).toHaveAttribute('data-selected', 'true');
    expect(document.querySelectorAll('[data-testid="connector-handle"]').length).toBe(2);

    // drag the arrow head from B onto C: it leaves B and joins C, drawing itself from C's top side
    const to = handleOf('to');
    fireEvent.pointerDown(to, pointer(500, 160));
    fireEvent.pointerMove(to, pointer(400, 560));
    await runFrames();
    fireEvent.pointerUp(to, pointer(400, 560));
    await runFrames();

    let made = connectors().find((obj) => obj.id === id)!;
    expect(made.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(made.ends.to).toEqual({ x: 400, y: 500 });
    expect(made.from).toMatchObject({ kind: 'attached', objectId: a });

    // dropping the same end back onto the object at the other end is refused, and the handle snaps
    // back rather than making an arrow out of nothing
    const toAgain = handleOf('to');
    fireEvent.pointerDown(toAgain, pointer(400, 500));
    fireEvent.pointerMove(toAgain, pointer(200, 160));
    fireEvent.pointerUp(toAgain, pointer(200, 160));
    await runFrames();
    made = connectors().find((obj) => obj.id === id)!;
    expect(made.to).toMatchObject({ kind: 'attached', objectId: c });

    // and an end dropped on empty board is left exactly where it was let go
    const toOnceMore = handleOf('to');
    fireEvent.pointerDown(toOnceMore, pointer(400, 500));
    fireEvent.pointerMove(toOnceMore, pointer(900, 900));
    await runFrames();
    fireEvent.pointerUp(toOnceMore, pointer(900, 900));
    await runFrames();

    made = connectors().find((obj) => obj.id === id)!;
    expect(made.to).toEqual({ kind: 'free', x: 900, y: 900 });
    expect(made.ends.to).toEqual({ x: 900, y: 900 });
  });
});

/** Click the middle of the arrow drawn between A and B, whose line runs along world y = 160. */
function clickLine(): void {
  const line = hitLine();
  fireEvent.pointerDown(line, pointer(400, 160));
  fireEvent.pointerUp(line, pointer(400, 160));
}
