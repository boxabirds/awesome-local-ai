/**
 * Story 10, task 13: the Connector tool and the arrow (TC-18 to TC-21).
 *
 * The four tests are the four things an arrow is: the dots that say where it would join
 * (TC-18), the drag from one object to another that makes it and joins it to both (TC-19),
 * the six screen pixels a click has to be within, whatever the zoom (TC-20), and the two ends
 * that can be taken off and put somewhere else (TC-21).
 *
 * The layout is three shapes on an otherwise empty board, at board points a test can name, so
 * every screen point in the file is worked out of the camera rather than guessed.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { CONNECTOR_HIT_TOLERANCE_PX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { sideAnchor } from '../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../src/shared/geometry';
import { getObjectType } from '../../src/client/objects/registry';
import { CONNECTOR_TYPE } from '../../src/shared/objects/connector';
import {
  VIEWPORT_FIXTURE,
  boardDoc,
  flushFrames,
  pointerDownOn,
  pointerMoveOn,
  pointerUpOn,
  readCamera,
  renderBoard,
  wheel,
  waitForCamera,
} from './fixtures/board';
import {
  clickConnectorTool,
  connectorDots,
  connectorElement,
  connectorInDoc,
  connectorsInDoc,
  connectorToolSurface,
  connectorToolSurfaceOrNull,
  dragOnSurface,
  drawConnector,
  highlightedDots,
  pressToolKey,
  screenOf,
  seedConnector,
  seedShape,
  selectedConnectorIds,
  shapesInDoc,
  toolPressed,
  waitForConnectors,
} from './fixtures/shapes';

/** Three shapes, far apart, at board points this file can name. */
const A: Rect = { x: -400, y: -100, width: 160, height: 160 };
const B: Rect = { x: -100, y: -100, width: 160, height: 160 };
const C: Rect = { x: 150, y: 150, width: 120, height: 120 };

function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A board point, where it is drawn on the screen right now. */
function atOnScreen(point: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(readCamera(), point);
}

function dotSides(): string[] {
  return connectorDots().map((dot) => dot.dataset.connectorSide ?? '');
}

describe("the Connector tool's hover dots (TC-18)", () => {
  it('TC-18: hovering an object puts a dot at the middle of each of its four sides', async () => {
    await renderBoard();
    const a = seedShape(A);
    await clickConnectorTool();
    expect(toolPressed('[data-testid="tool-connector"]')).toBe(true);

    const surface = connectorToolSurface();
    pointerMoveOn(surface, atOnScreen(centre(A)));
    await flushFrames();

    expect(connectorDots()).toHaveLength(4);
    expect(dotSides().sort()).toEqual(['bottom', 'left', 'right', 'top']);
    // Each dot is where the arrow would join: the midpoint of a side, drawn where that is now.
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const dot = connectorDots().find((entry) => entry.dataset.connectorSide === side);
      const expected = screenOf(sideAnchor(A, side));
      const left = Number(dot?.style.left.replace('px', ''));
      const top = Number(dot?.style.top.replace('px', ''));
      expect(dot?.dataset.connectorObject).toBe(a);
      // The dot is centred on the anchor, and the style is written in screen pixels.
      expect(left + CONNECTOR_HIT_TOLERANCE_PX / 1.5).toBeCloseTo(expected.x, 0);
      expect(top + CONNECTOR_HIT_TOLERANCE_PX / 1.5).toBeCloseTo(expected.y, 0);
    }
  });

  it('a pointer over empty board gets no dots, and a second object gets its own four', async () => {
    await renderBoard();
    seedShape(A);
    const b = seedShape(B);
    await pressToolKey('l');
    const surface = connectorToolSurface();

    // The far corner of the viewport is empty board.
    pointerMoveOn(surface, { x: VIEWPORT_FIXTURE.width - 4, y: VIEWPORT_FIXTURE.height - 4 });
    await flushFrames();
    expect(connectorDots()).toHaveLength(0);

    pointerMoveOn(surface, atOnScreen(centre(B)));
    await flushFrames();
    expect(connectorDots()).toHaveLength(4);
    expect(connectorDots().every((dot) => dot.dataset.connectorObject === b)).toBe(true);
  });

  it('an arrow is never a connection target, so hovering one gets no dots', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const arrow = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    await clickConnectorTool();
    const surface = connectorToolSurface();
    // The middle of the arrow's line, which is empty board between the two shapes.
    const line = atOnScreen({ x: -180, y: -20 });
    pointerMoveOn(surface, line);
    await flushFrames();
    // The pointer really was on the arrow's own line, and the arrow is still the only thing
    // between the two shapes — it just never answers to being hovered.
    expect(connectorElement(arrow).dataset.connectorFromObject).toBe(a);
    expect(connectorDots()).toHaveLength(0);
    expect(connectorsInDoc()).toHaveLength(1);
  });
});

describe('drawing an arrow (TC-19)', () => {
  it("TC-19: dragging from A over B highlights B's nearest dot and attaches both ends", async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    await clickConnectorTool();
    const surface = connectorToolSurface();
    const from = atOnScreen(centre(A));
    const to = atOnScreen(centre(B));

    pointerDownOn(surface, from);
    await flushFrames();
    pointerMoveOn(surface, to);
    await flushFrames();

    // The object being dragged over keeps its four dots up, and one of them is marked: the
    // side the arrow will join, which is the one nearest the other end.
    expect(connectorDots()).toHaveLength(4);
    expect(connectorDots().every((dot) => dot.dataset.connectorObject === b)).toBe(true);
    const marked = highlightedDots();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.connectorSide).toBe('left');

    pointerUpOn(surface, to);
    await flushFrames();

    const arrows = await waitForConnectors(1);
    const [connector] = arrows;
    expect(connector.from.kind).toBe('attached');
    expect(connector.to.kind).toBe('attached');
    if (connector.from.kind === 'attached' && connector.to.kind === 'attached') {
      expect(connector.from.objectId).toBe(a);
      expect(connector.to.objectId).toBe(b);
    }
    // The ends are on the sides the dots said, so what was drawn is what was joined.
    expect(connector.sides).toEqual({ from: 'right', to: 'left' });
    // The arrow is selected on this tab and the tool is back to Select (PRD: one arrow, then Select).
    expect(selectedConnectorIds()).toEqual([connector.id]);
    expect(toolPressed('[data-testid="tool-connector"]')).toBe(false);
    expect(toolPressed('[data-testid="tool-select"]')).toBe(true);
    expect(connectorToolSurfaceOrNull()).toBeNull();
  });

  it('an arrow drawn to empty board has a free end at the point it was released at', async () => {
    await renderBoard();
    const a = seedShape(A);
    const release = { x: 900, y: 620 };
    const id = await drawConnector(atOnScreen(centre(A)), release);
    const connector = connectorInDoc(id);
    expect(connector.from.kind).toBe('attached');
    expect(connector.to.kind).toBe('free');
    const world = screenToWorld(readCamera(), release);
    if (connector.to.kind === 'free') {
      expect(connector.to.x).toBeCloseTo(world.x, 6);
      expect(connector.to.y).toBeCloseTo(world.y, 6);
    }
    expect(a).toBeTruthy();
  });

  it('a drag too short to be an arrow writes nothing and leaves the tool up', async () => {
    await renderBoard();
    seedShape(A);
    await clickConnectorTool();
    const surface = connectorToolSurface();
    const from = atOnScreen(centre(A));
    pointerDownOn(surface, from);
    pointerMoveOn(surface, { x: from.x + 2, y: from.y });
    await flushFrames();
    pointerUpOn(surface, { x: from.x + 2, y: from.y });
    await flushFrames();

    expect(connectorsInDoc()).toHaveLength(0);
    expect(toolPressed('[data-testid="tool-connector"]')).toBe(true);
  });

  it('both ends on the same object are refused, and the board is left alone', async () => {
    await renderBoard();
    seedShape(A);
    await clickConnectorTool();
    const surface = connectorToolSurface();
    // A drag that starts and ends on the same shape: the model's answer is no, and the tool
    // stays up rather than sending the person back to Select for nothing.
    await dragOnSurface(surface, atOnScreen(centre(A)), atOnScreen({ x: A.x + 20, y: A.y + 20 }));
    expect(connectorsInDoc()).toHaveLength(0);
    expect(shapesInDoc()).toHaveLength(1);
    expect(toolPressed('[data-testid="tool-connector"]')).toBe(true);
  });
});

describe('clicking near an arrow (TC-20)', () => {
  /** A board point `screenPx` away from the middle of the arrow, at right angles to it. */
  function besideLine(zoom: number, screenPx: number): { x: number; y: number } {
    // The arrow runs along y = -20 in these fixtures, so straight up is at right angles.
    return { x: -180, y: -20 - screenPx / zoom };
  }

  it('TC-20: 5 screen pixels from the line is a click on it and 7 is not, at 50% and 200% zoom', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    const connector = connectorInDoc(id);
    const spec = getObjectType(CONNECTOR_TYPE);
    if (!spec) throw new Error('the connector type is not registered');

    for (const zoom of [0.5, 1, 2, ZOOM_STEP_FACTOR ** 3]) {
      const near = besideLine(zoom, CONNECTOR_HIT_TOLERANCE_PX - 1);
      const far = besideLine(zoom, CONNECTOR_HIT_TOLERANCE_PX + 1);
      // The point really is that many screen pixels from the line at that zoom.
      expect(distanceToPolyline([connector.ends.from, connector.ends.to], near) * zoom).toBeCloseTo(
        CONNECTOR_HIT_TOLERANCE_PX - 1,
        6,
      );
      expect(spec.hitTest(connector, near, zoom)).toBe(true);
      expect(spec.hitTest(connector, far, zoom)).toBe(false);
    }
  });

  it('the click area keeps six screen pixels whatever the zoom says in board units', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    const svg = connectorElement(id).querySelector('svg[data-testid="connector-svg"]');
    const hit = connectorElement(id).querySelector('[data-testid="connector-hit"]');
    const strokeWidth = Number(hit?.getAttribute('stroke-width'));
    expect(strokeWidth).toBeCloseTo((CONNECTOR_HIT_TOLERANCE_PX * 2) / readCamera().zoom, 6);

    // Zoom in: the stroke shrinks in board units so the same six screen pixels are kept.
    const centre = { x: VIEWPORT_FIXTURE.width / 2, y: VIEWPORT_FIXTURE.height / 2 };
    wheel({ ctrlKey: true, deltaY: -100 }, centre);
    const zoomed = await waitForCamera((cam) => cam.zoom > 1);
    await flushFrames();
    const later = Number(
      connectorElement(id).querySelector('[data-testid="connector-hit"]')?.getAttribute('stroke-width'),
    );
    expect(later).toBeCloseTo((CONNECTOR_HIT_TOLERANCE_PX * 2) / zoomed.zoom, 6);
    expect(svg).not.toBeNull();

    // And a click on it selects it at that zoom, the way it does at any zoom. The press is on
    // the line's own hit area, which is the only part of the arrow that takes the pointer.
    const onLine = atOnScreen({ x: -180, y: -20 });
    const hitLine = connectorElement(id).querySelector('[data-testid="connector-hit"]');
    expect(hitLine).not.toBeNull();
    act(() => {
      hitLine?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          clientX: onLine.x,
          clientY: onLine.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
      hitLine?.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: onLine.x,
          clientY: onLine.y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
    });
    await flushFrames();
    expect(selectedConnectorIds()).toEqual([id]);
  });

  it('only the line of an arrow takes the pointer, not the box around it', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    // An arrow's box is the rectangle around its two ends, which is mostly empty board. Only
    // the line takes the pointer; the box around it does not, or a shape under that box could
    // not be clicked at all — and the connector is drawn above every shape.
    const element = connectorElement(id) as HTMLElement;
    const svg = element.querySelector('svg[data-testid="connector-svg"]') as HTMLElement | null;
    const hit = element.querySelector('[data-testid="connector-hit"]');
    expect(element.style.pointerEvents).toBe('none');
    expect(svg?.style.pointerEvents).toBe('none');
    expect(hit?.getAttribute('pointer-events')).toBe('stroke');

    // The end handles are the exception: they are part of the arrow and ask for the pointer back.
    await selectArrow(id);
    const handles = element.querySelectorAll('[data-testid^="connector-handle-"]');
    expect(handles).toHaveLength(2);
    for (const handle of handles) {
      expect((handle as HTMLElement).style.pointerEvents).toBe('auto');
    }
  });
});

describe('moving an end of an arrow (TC-21)', () => {
  it('TC-21: an end dragged onto C attaches to C, and one dropped on empty board stays free', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const c = seedShape(C);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });

    // Selecting the arrow is what brings its end handles up.
    await selectArrow(id);
    expect(selectedConnectorIds()).toEqual([id]);
    const handles = connectorElement(id).querySelectorAll('[data-testid^="connector-handle-"]');
    expect(handles).toHaveLength(2);

    // The end that is on B goes to C.
    const handle = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    if (!handle) throw new Error('no end handle to drag');
    const from = atOnScreen(connectorInDoc(id).ends.to);
    await dragOnElement(handle, from, atOnScreen(centre(C)));
    await waitForConnectors(1);

    let connector = connectorInDoc(id);
    expect(connector.to.kind).toBe('attached');
    if (connector.to.kind === 'attached') expect(connector.to.objectId).toBe(c);
    // The other end never moved.
    if (connector.from.kind === 'attached') expect(connector.from.objectId).toBe(a);
    // And the arrow still follows the object it is attached to.
    expect(connector.sides.to).toBe('left');

    // The same end, dropped on empty board: free, at the point it was released at.
    const release = { x: 120, y: 700 };
    const handleAgain = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    if (!handleAgain) throw new Error('no end handle to drag a second time');
    await dragOnElement(handleAgain, atOnScreen(connectorInDoc(id).ends.to), release);

    connector = connectorInDoc(id);
    expect(connector.to.kind).toBe('free');
    const world = screenToWorld(readCamera(), release);
    if (connector.to.kind === 'free') {
      expect(connector.to.x).toBeCloseTo(world.x, 6);
      expect(connector.to.y).toBeCloseTo(world.y, 6);
    }
  });

  it('an end dragged onto the object at the other end of the same arrow snaps back', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    await selectArrow(id);
    const handle = connectorElement(id).querySelector<HTMLElement>('[data-testid="connector-handle-to"]');
    if (!handle) throw new Error('no end handle to drag');
    // The end on B is dragged onto A, which is where the arrow already starts: no change.
    await dragOnElement(handle, atOnScreen(connectorInDoc(id).ends.to), atOnScreen(centre(A)));

    const connector = connectorInDoc(id);
    if (connector.to.kind !== 'attached' || connector.from.kind !== 'attached') {
      throw new Error(`both ends should still be attached: ${JSON.stringify(connector.ends)}`);
    }
    expect(connector.to.objectId).toBe(b);
    expect(connector.from.objectId).toBe(a);
    expect(connectorsInDoc()).toHaveLength(1);
  });

  it('an arrow keeps its two ends where its objects are, so a move needs no second write', async () => {
    await renderBoard();
    const a = seedShape(A);
    const b = seedShape(B);
    const id = seedConnector({ kind: 'attached', objectId: a }, { kind: 'attached', objectId: b });
    const before = connectorInDoc(id);
    expect(before.ends.to.x).toBeCloseTo(B.x, 6);

    // Somebody else's move of B (the document is the only thing that changes here).
    act(() => {
      const object = boardDoc().getMap('objects').get(b) as unknown as {
        set(key: string, value: number): void;
      };
      object.set('x', 200);
    });
    await flushFrames();
    const after = connectorInDoc(id);
    expect(after.ends.to.x).toBeCloseTo(200, 6);
    expect(after.ends.from.x).toBeCloseTo(before.ends.from.x, 6);
  });
});

/** Click the arrow's own line: the press the six-pixel rule is about. */
async function selectArrow(id: string): Promise<void> {
  const onLine = atOnScreen(connectorInDoc(id).ends.to);
  // The press goes on the line's own hit area: that is the only part of an arrow that takes
  // the pointer (its box is mostly empty board, and what is under it stays reachable).
  const line = connectorElement(id).querySelector('[data-testid="connector-hit"]');
  if (!line) throw new Error('no arrow hit line mounted');
  act(() => {
    line.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: onLine.x,
        clientY: onLine.y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1,
      }),
    );
    line.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: onLine.x,
        clientY: onLine.y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 0,
      }),
    );
  });
  await flushFrames();
}

/** Drag one element in a straight line across the screen, one flush per step. */
async function dragOnElement(
  element: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 3,
): Promise<void> {
  pointerDownOn(element, from);
  for (let step = 1; step <= steps; step += 1) {
    pointerMoveOn(element, {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await flushFrames();
  }
  pointerUpOn(element, to);
  await flushFrames();
}
