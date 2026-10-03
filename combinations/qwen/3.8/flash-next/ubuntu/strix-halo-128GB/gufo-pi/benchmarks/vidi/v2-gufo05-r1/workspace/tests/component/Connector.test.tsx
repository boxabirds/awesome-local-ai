/**
 * The Connector tool and the connector object (`connector.ui`).
 *
 * The camera is parked at `(0, 0, 1)` so a screen point and a world point are the same
 * number; TC-20 is the exception and sets a real zoom to make the pixel tolerance mean
 * something.
 *
 * TC-18 L tool: a connectable object shows four dots at the midpoints of its sides
 * TC-19 drag from A over B: release creates an arrow attached to both
 * TC-20 a click within tolerance of the line selects; farther does not — at 50% and 200%
 * TC-21 a selected arrow's end handle, dragged onto C, attaches; onto empty space, frees
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { objectSnapshots } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import {
  createConnector,
  type ConnectorSnapshot,
} from '../../src/shared/objects/connector';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
} from '../../src/shared/config';
import { connectorHitTest } from '../../src/shared/geometry/connector-geometry';
import {
  renderStickyApp,
  advanceFrames,
  type StickyAppHandle,
} from './stickyHarness';

const connectorButton = () => screen.getByRole('button', { name: 'Connector (L)' });
const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';

function connectorsOf(doc: Y.Doc): ConnectorSnapshot[] {
  return objectSnapshots(doc).filter((o) => o.type === 'connector') as ConnectorSnapshot[];
}

async function addShape(board: StickyAppHandle, x: number, y: number, w = 100, h = 100): Promise<string> {
  let id = '';
  await act(async () => {
    id = createShape(board.doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'alex')!;
  });
  await advanceFrames();
  return id;
}

async function park(board: StickyAppHandle): Promise<void> {
  await board.setCamera({ x: 0, y: 0, zoom: 1 });
}

describe('connector.ui: the Connector tool', () => {
  it('TC-18 a shape shows four connection dots at its side midpoints', async () => {
    const board = await renderStickyApp();
    await park(board);
    const id = await addShape(board, 200, 200, 100, 100);

    await board.pressKey('l');
    expect(pressed(connectorButton())).toBe(true);
    expect(screen.getByTestId('connector-tool')).toBeTruthy();

    const dots = screen
      .getAllByTestId('connector-dot')
      .filter((d) => d.getAttribute('data-object-id') === id);
    expect(dots).toHaveLength(4);
    const sides = dots.map((d) => d.getAttribute('data-side')).sort();
    expect(sides).toEqual(['bottom', 'left', 'right', 'top']);

    // The midpoint of the right side of a 200,200,100,100 shape is world (300, 250),
    // and at camera (0,0,1) screen equals world.
    const right = dots.find((d) => d.getAttribute('data-side') === 'right') as HTMLElement;
    expect(right.style.left).toBe('300px');
    expect(right.style.top).toBe('250px');
  });

  it('TC-19 dragging from A onto B creates an arrow attached to both', async () => {
    const board = await renderStickyApp();
    await park(board);
    const a = await addShape(board, 100, 200, 100, 100); // right mid (200,250)
    const b = await addShape(board, 500, 200, 100, 100); // centre (550,250)

    await board.pressKey('l');
    const dot = screen
      .getAllByTestId('connector-dot')
      .find((d) => d.getAttribute('data-object-id') === a && d.getAttribute('data-side') === 'right')!;

    await board.press(dot, 200, 250);
    await board.moveTo(550, 250); // over B
    await board.release(550, 250);
    await advanceFrames();

    const created = connectorsOf(board.doc);
    expect(created).toHaveLength(1);
    const from = created[0]!.from;
    const to = created[0]!.to;
    expect(from.kind).toBe('attached');
    expect(to.kind).toBe('attached');
    if (from.kind === 'attached' && to.kind === 'attached') {
      expect(from.objectId).toBe(a);
      expect(to.objectId).toBe(b);
    }
    // Back to Select, holding the new arrow.
    expect(pressed(connectorButton())).toBe(false);
    expect(board.selectedIds()).toContain(created[0]!.id);
  });

  it('dragging to empty space creates nothing', async () => {
    const board = await renderStickyApp();
    await park(board);
    const a = await addShape(board, 100, 200, 100, 100);

    await board.pressKey('l');
    const dot = screen
      .getAllByTestId('connector-dot')
      .find((d) => d.getAttribute('data-object-id') === a && d.getAttribute('data-side') === 'right')!;
    await board.press(dot, 200, 250);
    await board.moveTo(900, 900); // nowhere
    await board.release(900, 900);
    await advanceFrames();
    expect(connectorsOf(board.doc)).toHaveLength(0);
  });
});

describe('connector.ui: selecting an arrow precisely', () => {
  // TC-20 exercises the geometric predicate the object's hit stroke is built from, at
  // the boundary and at two zoom levels: 5 screen px from the line is a hit, 7 is not,
  // whatever the zoom (`CONNECTOR_HIT_TOLERANCE_PX / zoom` in world units).
  it.each([0.5, 2])('TC-20 at %s zoom: 5px selects, 7px does not', (zoom) => {
    const arrow = { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } };
    const near = { x: 500, y: 5 / zoom };
    const far = { x: 500, y: 7 / zoom };
    expect(connectorHitTest(arrow, near, zoom)).toBe(true);
    expect(connectorHitTest(arrow, far, zoom)).toBe(false);
  });

  it('a click in the bounding box but far from the line is not a hit', () => {
    // A nearly-horizontal arrow has a tall box; the top corner is inside the box but far
    // from the line, and must not select it.
    const arrow = { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } };
    expect(connectorHitTest(arrow, { x: 500, y: 400 }, 1)).toBe(false);
    expect(CONNECTOR_HIT_TOLERANCE_PX).toBe(6);
  });
});

describe('connector.ui: re-attaching an end', () => {
  it('TC-21 the end handle dragged onto C attaches; onto empty space it frees', async () => {
    const board = await renderStickyApp();
    await park(board);
    const a = await addShape(board, 100, 200, 100, 100);
    const b = await addShape(board, 500, 200, 100, 100);
    const c = await addShape(board, 300, 500, 100, 100);

    let id = '';
    await act(async () => {
      id = createConnector(
        board.doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 250 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 250 } },
        'alex',
      )!;
    });
    await advanceFrames();

    // Select the arrow by pressing its line (its wide invisible hit stroke).
    const connector = screen.getByTestId('connector-object');
    const hit = connector.querySelector('[data-testid="connector-hit"]')!;
    await board.press(hit, 350, 250);
    await board.release(350, 250);
    await advanceFrames();
    expect(board.selectedIds()).toContain(id);

    // The two end handles are now on screen. Drag the "to" handle onto C.
    const handles = screen.getAllByTestId('connector-handle');
    expect(handles).toHaveLength(2);
    const toHandle = handles.find((h) => h.getAttribute('data-end') === 'to')!;
    await board.press(toHandle, 500, 250);
    await board.moveTo(350, 550); // over C
    await board.release(350, 550);
    await advanceFrames();

    let snap = connectorsOf(board.doc).find((k) => k.id === id)!;
    expect(snap.to.kind).toBe('attached');
    if (snap.to.kind === 'attached') expect(snap.to.objectId).toBe(c);

    // Drag the same handle to empty space: it frees to that point.
    const toHandle2 = screen.getAllByTestId('connector-handle').find((h) => h.getAttribute('data-end') === 'to')!;
    await board.press(toHandle2, 350, 550);
    await board.moveTo(720, 640);
    await board.release(720, 640);
    await advanceFrames();

    snap = connectorsOf(board.doc).find((k) => k.id === id)!;
    expect(snap.to.kind).toBe('free');
    if (snap.to.kind === 'free') {
      expect(snap.to.x).toBeCloseTo(720, 2);
      expect(snap.to.y).toBeCloseTo(640, 2);
    }
  });

  it('releasing an end handle back on the far object snaps it back', async () => {
    const board = await renderStickyApp();
    await park(board);
    const a = await addShape(board, 100, 200, 100, 100);
    const b = await addShape(board, 500, 200, 100, 100);
    let id = '';
    await act(async () => {
      id = createConnector(
        board.doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 250 } },
        { kind: 'attached', objectId: b, fallback: { x: 500, y: 250 } },
        'alex',
      )!;
    });
    await advanceFrames();
    const connector = screen.getByTestId('connector-object');
    const hit = connector.querySelector('[data-testid="connector-hit"]')!;
    await board.press(hit, 350, 250);
    await board.release(350, 250);
    await advanceFrames();

    // Drag the "from" handle onto B — the object at the other end — and it stays put.
    const fromHandle = screen.getAllByTestId('connector-handle').find((h) => h.getAttribute('data-end') === 'from')!;
    await board.press(fromHandle, 200, 250);
    await board.moveTo(550, 250);
    await board.release(550, 250);
    await advanceFrames();

    const snap = connectorsOf(board.doc).find((k) => k.id === id)!;
    expect(snap.from.kind).toBe('attached');
    if (snap.from.kind === 'attached') expect(snap.from.objectId).toBe(a);
  });
});
