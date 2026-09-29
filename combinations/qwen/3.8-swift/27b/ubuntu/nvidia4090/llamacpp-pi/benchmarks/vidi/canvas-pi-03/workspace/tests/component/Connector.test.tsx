/**
 * Story 10 component tests — connector.ui (TC-18 to TC-21):
 * hover dots, drag creation, the 5/7 px hit tolerance at two zooms and
 * end-handle re-attach (attached / free).
 *
 * Fixture (world units, zoom 1, world (0,0) at screen (512,384)):
 *   A: rect  (100,100,100,100) centre screen (662,534)
 *   B: rect  (400,100,100,100) centre screen (962,534)
 *   C: rect  (400,300,100,100) centre screen (962,734)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects, objectsOf } from 'src/shared/board-model';
import { createShape } from 'src/shared/objects/shape';
import { createConnector } from 'src/shared/objects/connector';
import {
  sideAnchor,
  nearestSide,
  type Endpoint,
} from 'src/shared/geometry/connector-geometry';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc; setCamera(c: { x: number; y: number; zoom: number }): void } };
  return w.__vidi6.doc;
}

function getSetCamera(): (c: { x: number; y: number; zoom: number }) => void {
  const w = window as unknown as { __vidi6: { setCamera(c: { x: number; y: number; zoom: number }): void } };
  return w.__vidi6.setCamera;
}

const A = { x: 100, y: 100, width: 100, height: 100 };
const B = { x: 400, y: 100, width: 100, height: 100 };
const C = { x: 400, y: 300, width: 100, height: 100 };
const A_S = { x: 662, y: 534 };
const B_S = { x: 962, y: 534 };
const C_S = { x: 962, y: 734 };

function centre(r: { x: number; y: number; width: number; height: number }) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function seedRects() {
  const doc = getDoc();
  const a = createShape(doc, { kind: 'rect', rect: A, at: { x: A.x, y: A.y } }, 'test')!;
  const b = createShape(doc, { kind: 'rect', rect: B, at: { x: B.x, y: B.y } }, 'test')!;
  const c = createShape(doc, { kind: 'rect', rect: C, at: { x: C.x, y: C.y } }, 'test')!;
  await screen.findAllByTestId('shape-object');
  return { a, b, c };
}

function attachedTo(id: string, rect: { x: number; y: number; width: number; height: number }, toward: { x: number; y: number }): Endpoint {
  return { kind: 'attached', objectId: id, fallback: sideAnchor(rect, nearestSide(rect, toward)) };
}

function connectorRaw(doc: Y.Doc, id: string): Y.Map<unknown> {
  const obj = objectsOf(doc).get(id);
  if (!(obj instanceof Y.Map)) throw new Error(`connector ${id} missing`);
  return obj;
}

describe('connector.ui (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-18: hovering a shape with the L tool shows four dots at the side midpoints', async () => {
    await seedRects();
    const user = userEvent.setup();
    await user.keyboard('l');
    const layer = screen.getByTestId('connector-tool-layer');
    expect(layer).toBeTruthy();

    // No hover: no dots.
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
    // Hover over A's centre: four dots appear.
    fireEvent.pointerMove(layer, { clientX: A_S.x, clientY: A_S.y });
    expect(screen.getAllByTestId('connector-dot')).toHaveLength(4);
  });

  it('TC-19: drag from A over B shows the preview and creates an attached A→B connector on release', async () => {
    const { a, b } = await seedRects();
    const user = userEvent.setup();
    await user.keyboard('l');
    const layer = screen.getByTestId('connector-tool-layer');

    fireEvent.pointerDown(layer, { button: 0, clientX: A_S.x, clientY: A_S.y });
    fireEvent.pointerMove(layer, { clientX: B_S.x, clientY: B_S.y });
    // The dashed preview line is visible while dragging.
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    fireEvent.pointerUp(layer, { button: 0, clientX: B_S.x, clientY: B_S.y });

    const doc = getDoc();
    const connectors = allObjects(doc).filter((o) => o.type === 'connector');
    expect(connectors).toHaveLength(1);
    const raw = connectorRaw(doc, connectors[0].id);
    const from = raw.get('from') as Endpoint;
    const to = raw.get('to') as Endpoint;
    expect(from).toMatchObject({ kind: 'attached', objectId: a });
    expect(to).toMatchObject({ kind: 'attached', objectId: b });
    // Return to Select.
    expect(screen.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-20: a click 5 px (screen) from an arrow selects it, 7 px does not — at 50% and 200% zoom (boundary, negative)', async () => {
    const doc = getDoc();
    const { a, b } = await seedRects();
    // A→B connector: a horizontal line world (200,150) → (400,150).
    createConnector(
      doc,
      attachedTo(a, A, centre(B)),
      attachedTo(b, B, centre(A)),
      'test',
    );
    await screen.findByTestId('connector-object');

    const setCamera = getSetCamera();
    const viewport = screen.getByTestId('board-viewport');
    const el = () => screen.getByTestId('connector-object');

    for (const zoom of [0.5, 2] as const) {
      // Keep the line centre (world 300,150) at the screen centre.
      setCamera({ x: 300 - 512 / zoom, y: 150 - 384 / zoom, zoom });
      // Unselect first (click far away — world far off the line).
      fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(viewport, { button: 0, clientX: 100, clientY: 100 });
      expect(el().hasAttribute('data-selected')).toBe(false);

      // 5 px below the line (screen) → within the 6 px tolerance → selected.
      fireEvent.pointerDown(viewport, { button: 0, clientX: 512, clientY: 389 });
      fireEvent.pointerUp(viewport, { button: 0, clientX: 512, clientY: 389 });
      await waitFor(() => expect(el().hasAttribute('data-selected')).toBe(true));

      // 7 px below the line → outside the tolerance → not selected.
      fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(viewport, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerDown(viewport, { button: 0, clientX: 512, clientY: 391 });
      fireEvent.pointerUp(viewport, { button: 0, clientX: 512, clientY: 391 });
      await waitFor(() => expect(el().hasAttribute('data-selected')).toBe(false));
    }
  });

  it('TC-21: dragging the selected arrow end handle onto C attaches it; onto empty space it becomes free at the release point', async () => {
    const doc = getDoc();
    const { a, b, c } = await seedRects();
    const conn = createConnector(
      doc,
      attachedTo(a, A, centre(B)),
      attachedTo(b, B, centre(A)),
      'test',
    )!;
    await screen.findByTestId('connector-object');

    // Select the arrow (click within its tolerance at the line's mid point).
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { button: 0, clientX: 812, clientY: 534 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 812, clientY: 534 });
    await waitFor(() => expect(screen.getByTestId('connector-object')).toHaveAttribute('data-selected'));

    const handle = screen.getByTestId('connector-handle-to');

    // Drag the `to` end onto C's centre → attached to C.
    fireEvent.pointerDown(handle, { button: 0, clientX: 912, clientY: 534 });
    fireEvent.pointerUp(handle, { button: 0, clientX: C_S.x, clientY: C_S.y });
    let raw = connectorRaw(doc, conn);
    expect(raw.get('to')).toMatchObject({ kind: 'attached', objectId: c });
    // The `from` end is unchanged.
    expect(raw.get('from')).toMatchObject({ kind: 'attached', objectId: a });

    // Drag the same end onto empty space → free at the release point
    // (screen (962,300) = world (450,-84)).
    fireEvent.pointerDown(handle, { button: 0, clientX: 962, clientY: 634 });
    fireEvent.pointerUp(handle, { button: 0, clientX: 962, clientY: 300 });
    raw = connectorRaw(doc, conn);
    expect(raw.get('to')).toEqual({ kind: 'free', x: 450, y: -84 });
  });

  it('releasing over the drag-start object never attaches to it (no self-connection)', async () => {
    const doc = getDoc();
    const { a } = await seedRects();
    const user = userEvent.setup();
    await user.keyboard('l');
    const layer = screen.getByTestId('connector-tool-layer');
    // Start on A, wiggle around, release still on A: the `to` end becomes
    // FREE (a self-connection is impossible), and the dot stays hidden.
    fireEvent.pointerDown(layer, { button: 0, clientX: A_S.x, clientY: A_S.y });
    fireEvent.pointerMove(layer, { clientX: A_S.x + 20, clientY: A_S.y + 20 });
    expect(screen.queryAllByTestId('connector-dot')).toHaveLength(0);
    fireEvent.pointerUp(layer, { button: 0, clientX: A_S.x + 10, clientY: A_S.y });

    const raw = connectorRaw(doc, allObjects(doc).find((o) => o.type === 'connector')!.id);
    expect(raw.get('from')).toMatchObject({ kind: 'attached', objectId: a });
    expect(raw.get('to')).toMatchObject({ kind: 'free' });
  });
});
