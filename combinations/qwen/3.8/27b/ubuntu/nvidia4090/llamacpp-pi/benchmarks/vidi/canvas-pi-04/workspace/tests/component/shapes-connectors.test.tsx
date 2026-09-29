// Story 10, task 14: component tests for the Shape tool, ShapeObject label,
// ShapeToolbar, the Connector tool (hover dots, creation), ConnectorObject
// (hit band, re-attach handles) and the active-tool behaviour (TC-15..TC-22,
// TC-28).
//
// The App is rendered against a mocked connector that seeds objects through
// the REAL model calls (same pattern as the story 9 tool tests). jsdom has no
// CSS hit-testing or layout, so geometry is asserted through the model +
// the explicit tolerance checks the components run (client px = viewport
// local px under the deterministic camera).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyAt, objectSnapshot } from '../../src/shared/board-model';
import {
  getShapeLabel,
  type ShapeSnap,
} from '../../src/shared/objects/shape';
import { type ConnectorSnap, readEndpoint } from '../../src/shared/objects/connector';
import {
  createShape,
  type ShapeCreateInput,
} from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import type { Endpoint } from '../../src/shared/objects/connector';
import {
  resetBoardForTests,
  setBoardCamera,
} from '../../src/client/canvas/useCamera';
import { makeEvent } from './helpers';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { Camera } from '../../src/client/canvas/camera';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';

// Module-scope seed config, read by the hoisted connectBoard mock.
const SEED = vi.hoisted(() => ({
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
  /** Runs once, on the first empty board, with the real model. */
  seed: (_doc: Y.Doc): void => undefined,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      queueMicrotask(() => {
        if (objectSnapshot(doc).length !== 0) return;
        SEED.seed(doc);
      });
      return { destroy: (): void => undefined };
    },
  };
});

// Deterministic camera: world (0,0) at screen (512,384), zoom 1 (jsdom's
// 1024x768 default window).
const CAM: Camera = { x: -512, y: -384, zoom: 1 };

function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}

function pressKey(key: string, init: Record<string, unknown> = {}): void {
  dis(window, 'keydown', { key, ...init });
}

function selectPressed(): boolean {
  return (
    screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed') === 'true'
  );
}

function shapePressed(): boolean {
  return (
    screen.getByRole('button', { name: 'Shape (S)' }).getAttribute('aria-pressed') === 'true'
  );
}

function connectorPressed(): boolean {
  return (
    screen.getByRole('button', { name: 'Connector (L)' }).getAttribute('aria-pressed') === 'true'
  );
}

async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  act(() => {
    setBoardCamera(CAM);
  });
}

function shapes(): ShapeSnap[] {
  return objectSnapshot(SEED.doc!).filter((o) => o.type === 'shape') as ShapeSnap[];
}

function connectors(): ConnectorSnap[] {
  return objectSnapshot(SEED.doc!).filter((o) => o.type === 'connector') as ConnectorSnap[];
}

/** Create a default-size shape centred at `at` with the real model. */
function seedShape(doc: Y.Doc, kind: 'rect' | 'ellipse' | 'diamond', at: { x: number; y: number }): string {
  const input: ShapeCreateInput = { kind, rect: null, at, square: false };
  const id = createShape(doc, input, 'tester');
  return id as string;
}

describe('story 10: shapes and connectors (TC-15..TC-22, TC-28)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.state = 'connected';
    SEED.doc = null;
    SEED.seed = () => undefined;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('TC-15: S tool drag shows the preview, creates one shape, selects it and returns to Select', async () => {
    await openBoard();
    pressKey('s');
    expect(shapePressed()).toBe(true);

    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 800, clientY: 520 });

    // The dashed preview is visible while dragging.
    expect(screen.getByTestId('shape-preview')).toBeTruthy();

    dis(window, 'pointerup', { pointerId: 1, clientX: 800, clientY: 520 });

    // Exactly one shape, the drawn rect in world units.
    const list = shapes();
    expect(list).toHaveLength(1);
    const from = screenToWorld(CAM, { x: 600, y: 400 });
    const to = screenToWorld(CAM, { x: 800, y: 520 });
    expect(list[0].x).toBeCloseTo(Math.min(from.x, to.x), 5);
    expect(list[0].y).toBeCloseTo(Math.min(from.y, to.y), 5);
    expect(list[0].width).toBeCloseTo(Math.abs(to.x - from.x), 5);
    expect(list[0].height).toBeCloseTo(Math.abs(to.y - from.y), 5);

    // Selected, and the tool returned to Select.
    expect(screen.getByTestId('shape-object').getAttribute('data-selected')).not.toBeNull();
    expect(shapePressed()).toBe(false);
    expect(selectPressed()).toBe(true);
  });

  it('TC-16: double-clicking a shape edits its label, clamped to SHAPE_LABEL_MAX_CHARS', async () => {
    let id = '';
    SEED.seed = (doc) => {
      id = seedShape(doc, 'rect', { x: 200, y: 200 });
    };
    await openBoard();

    const shape = screen.getByTestId('shape-object');
    dis(shape, 'dblclick', {});

    const ta = screen.getByLabelText('Shape label') as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 100) } });

    expect(getShapeLabel(SEED.doc!, id)!.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(ta.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17: fill/outline swatches change the style only (label and selection kept)', async () => {
    let id = '';
    SEED.seed = (doc) => {
      id = seedShape(doc, 'rect', { x: 200, y: 200 });
      getShapeLabel(doc, id)!.insert(0, 'hi');
    };
    await openBoard();

    // Select the shape (click its body).
    const shape = screen.getByTestId('shape-object');
    dis(shape, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 });
    dis(window, 'pointerup', { pointerId: 1 });

    // The shape toolbar is visible for a single selected shape.
    const fillBlue = screen.getByRole('button', { name: 'Blue colour fill' });
    const strokeRed = screen.getByRole('button', { name: 'Red colour outline' });
    fireEvent.click(fillBlue);
    fireEvent.click(strokeRed);

    const snap = shapes().find((s) => s.id === id)!;
    expect(snap.fill).toBe('blue');
    expect(snap.stroke).toBe('red');
    expect(snap.label).toBe('hi'); // label untouched
    // Selection kept: the toolbar is still shown and the shape still selected.
    expect(screen.getByRole('button', { name: 'Blue colour fill' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('shape-object').getAttribute('data-selected')).not.toBeNull();
  });

  it('TC-18: L tool hover shows four dots at the side midpoints of each shape', async () => {
    SEED.seed = (doc) => {
      seedShape(doc, 'rect', { x: 200, y: 200 }); // 160x160 at (120,120)
    };
    await openBoard();
    pressKey('l');
    expect(connectorPressed()).toBe(true);

    // Move the pointer over the shape's top-side anchor (world (200,120)).
    dis(window, 'pointermove', { pointerId: 1, clientX: 712, clientY: 504 });

    const dots = screen.getAllByTestId('connector-dot');
    // Four dots (one per side of the single shape).
    expect(dots).toHaveLength(4);

    // The top anchor is highlighted (hover within the snap radius).
    const active = dots.filter((d) => d.getAttribute('data-active') === 'true');
    expect(active).toHaveLength(1);
    expect(parseFloat(active[0].style.left)).toBeCloseTo(712, 5);
    expect(parseFloat(active[0].style.top)).toBeCloseTo(504, 5);

    // The other three dots sit at the remaining side midpoints.
    const positions = dots
      .map((d) => [parseFloat(d.style.left), parseFloat(d.style.top)])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(positions).toEqual([
      [632, 584], // left  (120,200)
      [712, 504], // top   (200,120)
      [712, 664], // bottom(200,280)
      [792, 584], // right (280,200)
    ]);
  });

  it('TC-19: dragging from A onto B highlights B and creates an attached connector', async () => {
    let aId = '';
    let bId = '';
    SEED.seed = (doc) => {
      aId = seedShape(doc, 'rect', { x: 200, y: 200 }); // right anchor (280,200)
      bId = seedShape(doc, 'rect', { x: 500, y: 200 }); // left anchor  (420,200)
    };
    await openBoard();
    pressKey('l');

    const vp = screen.getByTestId('board-viewport');
    // Start on A's right anchor (screen (792,584)).
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 792, clientY: 584 });
    // Move to B's left anchor (screen (932,584)).
    dis(window, 'pointermove', { pointerId: 1, clientX: 932, clientY: 584 });

    // B's nearest dot is highlighted as the release target.
    const active = screen.getAllByTestId('connector-dot').filter((d) => d.getAttribute('data-active') === 'true');
    expect(active).toHaveLength(1);
    expect(parseFloat(active[0].style.left)).toBeCloseTo(932, 5);

    dis(window, 'pointerup', { pointerId: 1, clientX: 932, clientY: 584 });

    const list = connectors();
    expect(list).toHaveLength(1);
    const snap = list[0];
    expect(snap.from.kind).toBe('attached');
    expect((snap.from as { objectId: string }).objectId).toBe(aId);
    expect(snap.to.kind).toBe('attached');
    expect((snap.to as { objectId: string }).objectId).toBe(bId);
    // Both ends attached: the tool returned to Select and the arrow is selected.
    expect(selectPressed()).toBe(true);
    expect(screen.getByTestId('connector-object').getAttribute('data-selected')).not.toBeNull();
  });

  it('TC-20: body selection hits within ±6 screen px and misses beyond, at 50% and 200%', async () => {
    SEED.seed = (doc) => {
      createConnector(
        doc,
        { kind: 'free', x: 0, y: 0 },
        { kind: 'free', x: 200, y: 0 },
        'tester',
      );
    };
    await openBoard();

    const clickAt = (x: number, y: number): void => {
      const hit = screen.getByTestId('connector-hit');
      dis(hit, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y });
      dis(window, 'pointerup', { pointerId: 1 });
    };
    const selected = (): boolean =>
      screen.queryByTestId('connector-handle-from') !== null;
    const clearSelection = (): void => {
      const vp = screen.getByTestId('board-viewport');
      // An empty-surface press+release (no travel) clears the selection;
      // both events land on the viewport element itself (its React
      // onPointerUp stops the pan).
      dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 700 });
      dis(vp, 'pointerup', { pointerId: 1, clientX: 100, clientY: 700 });
    };

    // 50% zoom, camera (world at the screen origin) = (-1024,-768):
    // the line y=0 is at screen y=384; 5px above the line = 10 world units,
    // 7px above = 14.
    act(() => setBoardCamera({ x: -1024, y: -768, zoom: 0.5 }));
    clickAt(562, 379); // 5 px from the line
    expect(selected()).toBe(true);
    clearSelection();
    clickAt(562, 377); // 7 px from the line
    expect(selected()).toBe(false);

    // 200% zoom, camera = (-128,-96): the line y=0 is at screen y=192;
    // 5px above = 2.5 world units, 7px above = 3.5.
    act(() => setBoardCamera({ x: -128, y: -96, zoom: 2 }));
    clickAt(456, 187); // 5 px from the line
    expect(selected()).toBe(true);
    clearSelection();
    clickAt(456, 185); // 7 px from the line
    expect(selected()).toBe(false);
  });

  it('TC-21: dragging an end handle attaches to the target object, or frees in empty space', async () => {
    let aId = '';
    let cId = '';
    let connId = '';
    SEED.seed = (doc) => {
      aId = seedShape(doc, 'rect', { x: 200, y: 200 }); // right anchor (280,200)
      cId = seedShape(doc, 'rect', { x: 620, y: 200 }); // left anchor  (540,200)
      connId = createConnector(
        doc,
        { kind: 'attached', objectId: aId, fallback: { x: 280, y: 200 } },
        { kind: 'free', x: 400, y: 200 },
        'tester',
      ) as string;
    };
    await openBoard();

    // Select the arrow by clicking its body (a point on the line).
    const hit = screen.getByTestId('connector-hit');
    dis(hit, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 812, clientY: 584 });
    dis(window, 'pointerup', { pointerId: 1 });
    expect(selected()).toBe(true);

    // Drag the `to` handle (free end at world (400,200) = screen (912,584))
    // onto C's left anchor (world (540,200) = screen (1052,584)).
    const handleTo = screen.getByTestId('connector-handle-to');
    dis(handleTo, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 912, clientY: 584 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 1052, clientY: 584 });
    dis(window, 'pointerup', { pointerId: 1, clientX: 1052, clientY: 584 });

    let snap = connectors().find((c) => c.id === connId)!;
    expect(snap.to.kind).toBe('attached');
    expect((snap.to as { objectId: string }).objectId).toBe(cId);

    // Drag the same handle into empty space (world (188,316) = screen (700,700)).
    const handleTo2 = screen.getByTestId('connector-handle-to');
    dis(handleTo2, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 1052, clientY: 584 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 700, clientY: 700 });
    dis(window, 'pointerup', { pointerId: 1, clientX: 700, clientY: 700 });

    snap = connectors().find((c) => c.id === connId)!;
    expect(snap.to.kind).toBe('free');
    const stored = readEndpoint(
      (objectSnapshot(SEED.doc!).find((o) => o.id === connId)! as unknown as { to: unknown }).to,
    );
    expect(stored).toMatchObject({ kind: 'free', x: 188, y: 316 });
  });

  it('TC-22: creates return to Select; Escape cancels the tool without creating', async () => {
    await openBoard();

    // S then create (a click).
    pressKey('s');
    expect(shapePressed()).toBe(true);
    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointerup', { pointerId: 1 });
    expect(shapes()).toHaveLength(1);
    expect(selectPressed()).toBe(true);

    // L then create (a drag between two free points).
    pressKey('l');
    expect(connectorPressed()).toBe(true);
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 600, clientY: 400 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 800, clientY: 520 });
    dis(window, 'pointerup', { pointerId: 1, clientX: 800, clientY: 520 });
    expect(connectors()).toHaveLength(1);
    expect(selectPressed()).toBe(true);

    // Fresh board: S then Escape, L then Escape — nothing is created.
    cleanup();
    await openBoard();
    pressKey('s');
    expect(shapePressed()).toBe(true);
    pressKey('Escape');
    expect(selectPressed()).toBe(true);
    pressKey('l');
    expect(connectorPressed()).toBe(true);
    pressKey('Escape');
    expect(selectPressed()).toBe(true);
    expect(shapes()).toHaveLength(0);
    expect(connectors()).toHaveLength(0);
  });

  it('TC-28: a Shape-tool drag starting over a sticky draws the shape, the sticky stays put', async () => {
    let noteId = '';
    SEED.seed = (doc) => {
      // A sticky at world (100,100): its body covers screen (612..712, 484..584).
      const id = createStickyAtId(doc, 100, 100);
      noteId = id;
    };
    await openBoard();
    pressKey('s');

    // Drag starting on top of the sticky's screen position.
    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 640, clientY: 500 });
    dis(window, 'pointermove', { pointerId: 1, clientX: 740, clientY: 580 });
    dis(window, 'pointerup', { pointerId: 1, clientX: 740, clientY: 580 });

    // A shape was created…
    expect(shapes()).toHaveLength(1);
    // …and the sticky did not move.
    const note = objectSnapshot(SEED.doc!).find((o) => o.id === noteId)!;
    expect(note.x).toBe(100);
    expect(note.y).toBe(100);
  });
});

function selected(): boolean {
  return screen.queryByTestId('connector-handle-from') !== null;
}

/** Seed a sticky at world (x,y) with the real model and return its id. */
function createStickyAtId(doc: Y.Doc, x: number, y: number): string {
  return createStickyAt(doc, x, y, 'yellow') as string;
}
