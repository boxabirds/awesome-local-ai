/**
 * Story 11 component tests (TC-15, TC-16, TC-21): the stroke object —
 * the line-distance hit test (registry), click fall-through to the object
 * below, and a remote deletion of a selected stroke.
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels.
 */
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  buildRects,
  getObjectType,
} from '../../src/client/objects/registry';
import {
  createStroke,
  type StrokeSnap,
} from '../../src/shared/objects/stroke';
import { renderBoard } from './board-harness';

// Quiet provider (same pattern as the other board component tests).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    const g = globalThis as Record<string, unknown>;
    g.__vidi6_conn_handler = onState;
    onState((g.__vidi6_conn_state as string | undefined) ?? 'connected');
    return {
      destroy() {
        if (g.__vidi6_conn_handler === onState) delete g.__vidi6_conn_handler;
      },
    };
  },
}));

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  delete (globalThis as Record<string, unknown>).__vidi6_conn_handler;
  cleanup();
});

function snap(doc: Y.Doc, id: string): StrokeSnap {
  const o = snapshot(doc).find((s) => s.id === id);
  if (!o) throw new Error(`missing stroke ${id}`);
  return o as StrokeSnap;
}

describe('stroke.object (TC-15, TC-16, TC-21)', () => {
  it('TC-15: the registry hitTest hits 5 screen px from the line and misses at 7, at 50% / 100% / 200% zoom', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
      't',
    );
    const o = snap(doc, id!);
    const spec = getObjectType('stroke')!;
    const rects = buildRects(snapshot(doc));
    for (const zoom of [0.5, 1, 2]) {
      expect(spec.hitTest(o, { x: 50, y: 5 / zoom }, zoom, rects)).toBe(true);
      expect(spec.hitTest(o, { x: 50, y: 7 / zoom }, zoom, rects)).toBe(false);
    }
  });

  it('TC-16: a click inside a stroke bbox but far from its line selects the sticky below, not the stroke', () => {
    let stickyId = '';
    let strokeId = '';
    h.seed((d) => {
      stickyId = createSticky(d, { x: 100, y: 100 });
      // A V-shaped stroke: bbox (118,118)-(282,252), but the line runs down
      // to (200,250) — (200,130) is inside the bbox, far from the line.
      strokeId =
        createStroke(
          d,
          { points: [{ x: 120, y: 120 }, { x: 200, y: 250 }, { x: 280, y: 120 }], color: 'black', thickness: 'medium' },
          'seed',
        ) ?? '';
    });
    const o = snap(h.doc, strokeId);
    const spec = getObjectType('stroke')!;
    const rects = buildRects(snapshot(h.doc));
    expect(spec.hitTest(o, { x: 200, y: 130 }, 1, rects)).toBe(false); // far from the line

    // The element a browser hit-test would reach there is the sticky below;
    // the click selects it — not the stroke.
    const stickyEl = h.container.querySelector(`[data-note-id="${stickyId}"]`) as HTMLElement;
    expect(stickyEl).not.toBeNull();
    fireEvent.pointerDown(stickyEl, { clientX: 200, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 130, pointerId: 1 });
    expect(stickyEl.getAttribute('data-selected')).toBe('true');
    const strokeEl = h.container.querySelector(`[data-stroke-id="${strokeId}"]`) as HTMLElement;
    expect(strokeEl.getAttribute('data-selected')).toBe(null);
  });

  it('TC-21: a selected stroke deleted remotely → the selection is cleared and no exception is thrown', () => {
    let strokeId = '';
    h.seed((d) => {
      strokeId =
        createStroke(
          d,
          { points: [{ x: 100, y: 100 }, { x: 200, y: 150 }], color: 'black', thickness: 'medium' },
          'remote',
        ) ?? '';
    });
    // Click the drawn line (its midpoint) to select the stroke.
    const hit = h.container.querySelector(
      `[data-stroke-id="${strokeId}"] [data-stroke-hit]`,
    ) as Element;
    expect(hit).not.toBeNull();
    fireEvent.pointerDown(hit, { clientX: 150, clientY: 125, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 125, pointerId: 1 });
    const el = h.container.querySelector(`[data-stroke-id="${strokeId}"]`) as HTMLElement;
    expect(el.getAttribute('data-selected')).toBe('true');

    // A remote peer deletes the stroke while it is selected.
    expect(() => h.seed((d) => deleteObjects(d, [strokeId]))).not.toThrow();
    expect(h.container.querySelector(`[data-stroke-id="${strokeId}"]`)).toBeNull();
    expect(h.container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
  });
});
