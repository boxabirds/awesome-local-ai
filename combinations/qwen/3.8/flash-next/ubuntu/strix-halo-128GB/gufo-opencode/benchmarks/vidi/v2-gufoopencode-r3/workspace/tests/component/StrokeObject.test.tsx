import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  initDoc,
  snapshotAll
} from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke } from '../../src/shared/objects/stroke';
import { initialCamera } from './helpers';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

let doc: Y.Doc;

function mount(): Y.Doc {
  doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

const cam = initialCamera();

function toScreen(world: { x: number; y: number }) {
  return { x: world.x - cam.x, y: world.y - cam.y };
}

function addStroke(points: Array<{ x: number; y: number }>): string {
  let id = '';
  act(() => {
    const created = createStroke(doc, { points, color: 'black', thickness: 'medium' }, 'g_test');
    if (created !== null) id = created;
  });
  return id;
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stroke.object', () => {
  it('TC-15 hit test is line-distance based at 50% and 200% zoom (5 px hit, 7 px miss)', () => {
    mount();
    const id = addStroke([
      { x: 100, y: 100 },
      { x: 400, y: 100 }
    ]);
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    const obj = snapshotAll(doc).find((o) => o.id === id);
    expect(obj).toBeDefined();
    const ctxZooms = [0.5, 2];
    for (const zoom of ctxZooms) {
      const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      expect(tolerance).toBeGreaterThan(5 / zoom);
      expect(tolerance).toBeLessThan(7 / zoom);
      expect(spec!.hitTest(obj!, { x: 250, y: 100 + 5 / zoom }, { doc, zoom })).toBe(true);
      expect(spec!.hitTest(obj!, { x: 250, y: 100 - 5 / zoom }, { doc, zoom })).toBe(true);
      expect(spec!.hitTest(obj!, { x: 250, y: 100 + 7 / zoom }, { doc, zoom })).toBe(false);
      expect(spec!.hitTest(obj!, { x: 250, y: 100 }, { doc, zoom })).toBe(true);
    }
  });

  it('TC-16 a click inside the stroke bbox but far from its line selects the sticky below', () => {
    mount();
    act(() => {
      createSticky(doc, { x: 100, y: 100 });
    });
    addStroke([
      { x: 120, y: 120 },
      { x: 280, y: 280 }
    ]);
    // Inside both the stroke bbox and the sticky, but ~100 units from the line.
    const screenPt = toScreen({ x: 270, y: 130 });
    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, {
      clientX: screenPt.x,
      clientY: screenPt.y,
      pointerId: 1,
      button: 0
    });
    fireEvent.pointerUp(note, { clientX: screenPt.x, clientY: screenPt.y, pointerId: 1 });

    expect(screen.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('stroke-object')).toHaveAttribute('data-selected', 'false');
  });

  it('TC-21 a click near the line selects the stroke; a remote delete removes it without error', () => {
    mount();
    const id = addStroke([
      { x: 120, y: 120 },
      { x: 280, y: 280 }
    ]);
    const screenPt = toScreen({ x: 200, y: 200 }); // on the line
    fireEvent.pointerDown(screen.getByTestId('stroke-hit'), {
      clientX: screenPt.x,
      clientY: screenPt.y,
      pointerId: 1,
      button: 0
    });
    expect(screen.getByTestId('stroke-object')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();

    expect(() => {
      act(() => {
        deleteObjects(doc, [id]);
      });
    }).not.toThrow();
    expect(screen.queryByTestId('stroke-object')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });
});
