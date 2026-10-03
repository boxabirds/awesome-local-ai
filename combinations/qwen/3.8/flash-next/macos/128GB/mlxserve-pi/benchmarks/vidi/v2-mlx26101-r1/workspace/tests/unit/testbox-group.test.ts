// Story 7 — the generic transform machinery is proven on a test-only object type.
//
// The testbed's `testbox` is deliberately NOT a sticky note: it is resizable but not
// aspect-locked, and has its own minimum size. Driving it through the SAME
// board-model operations, geometry and selection reducer the board uses proves the
// machinery is generic and not sticky-note-specific (AC "不硬编码便利贴").

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  bringObjectsToFront,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  resizeObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { clampScale, resizeRect, scaleWithin } from '../../src/shared/geometry';
import { MAX_OBJECT_SIZE_WORLD } from '../../src/shared/config';
import { selectionReducer } from '../../src/client/board/useSelection';
import {
  TESTBOX_DEFAULT_SIZE,
  TESTBOX_MIN_SIZE_WORLD,
  TESTBOX_TYPE,
} from '../fixtures/testbox';
// Importing the fixture registers the test-only `testbox` type at module load.

/** A testbox object, written straight into the shared map (a type the board never ships). */
function addTestbox(doc: Y.Doc, id: string, x: number, y: number, z: number): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', TESTBOX_TYPE);
    m.set('x', x);
    m.set('y', y);
    m.set('width', TESTBOX_DEFAULT_SIZE.width);
    m.set('height', TESTBOX_DEFAULT_SIZE.height);
    m.set('z', z);
    doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).set(id, m);
  });
}

/** Read an object back out as a plain snapshot the shared helpers understand. */
function snap(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  const m = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP).get(id);
  if (!m) return undefined;
  const o: Record<string, unknown> = { id };
  m.forEach((v, k) => (o[k] = v));
  return o as unknown as ObjectSnapshot;
}

function bounds(doc: Y.Doc, id: string) {
  const s = snap(doc, id);
  if (!s) throw new Error(`object ${id} missing`);
  return objectBounds(s);
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const START = { ids: new Set<string>(), editingId: null } as const;

/** The shared objects map, named exactly as the board model stores it. */
const OBJECTS_MAP = 'objects';

describe('generic transform machinery on a test-only type', () => {
  it('reads a non-sticky object through the same bounds helper', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 100, 50, 1);
    expect(bounds(doc, 'b1')).toEqual({
      x: 100,
      y: 50,
      width: TESTBOX_DEFAULT_SIZE.width,
      height: TESTBOX_DEFAULT_SIZE.height,
    });
  });

  it('moves a subset of testboxes without touching the rest or their size', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 0, 0, 1);
    addTestbox(doc, 'b2', 300, 0, 2);
    expect(moveObjects(doc, new Map([['b1', { x: 40, y: -25 }]]))).toBe(1);
    expect(bounds(doc, 'b1')).toMatchObject({ x: 40, y: -25 });
    expect(bounds(doc, 'b2').x).toBe(300); // untouched
    expect(bounds(doc, 'b1').width).toBe(TESTBOX_DEFAULT_SIZE.width); // move never resizes
  });

  it('resizes non-proportionally because testbox is not aspect-locked', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 0, 0, 1);
    const start = bounds(doc, 'b1');
    // The registry says testbox is NOT aspect-locked, so width and height move free.
    const rect = resizeRect(start, 'se', { x: 320, y: 260 }, false);
    resizeObjects(doc, new Map([['b1', rect]]));
    const b = bounds(doc, 'b1');
    expect(b.width).toBe(440);
    expect(b.height).toBe(340);
    expect(b.width / b.height).not.toBeCloseTo(start.width / start.height, 3);
  });

  it('keeps an aspect-locked resize square (a sticky) — the knob is the registry, not the type name', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 0, 0, 1);
    const start = bounds(doc, 'b1');
    const rect = resizeRect(start, 'se', { x: 320, y: 260 }, true);
    // Aspect-locked: the 120:80 start ratio is preserved even though x moved further.
    expect(rect.width / rect.height).toBeCloseTo(start.width / start.height, 3);
  });

  it('clamps a testbox at ITS OWN minimum (10), not the sticky minimum', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 0, 0, 1);
    const start = bounds(doc, 'b1');
    const scale = clampScale(
      { x: 0.01, y: 0.01 },
      [start],
      [TESTBOX_MIN_SIZE_WORLD],
      MAX_OBJECT_SIZE_WORLD,
    );
    const to = scaleWithin(
      start,
      start,
      { x: start.x, y: start.y, width: start.width * scale.x, height: start.height * scale.y },
    );
    resizeObjects(doc, new Map([['b1', to]]));
    const b = bounds(doc, 'b1');
    // Each axis stops at its own minimum (10): 120 and 80 both clamp up to >= 10.
    expect(b.width).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE_WORLD);
    expect(b.height).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE_WORLD);
    expect(b.width).toBeLessThan(TESTBOX_DEFAULT_SIZE.width); // it really shrank
  });

  it('deletes a subset and raises the rest, ignoring sticky specifics', () => {
    const doc = makeDoc();
    addTestbox(doc, 'b1', 0, 0, 1);
    addTestbox(doc, 'b2', 0, 0, 5);
    addTestbox(doc, 'b3', 0, 0, 3);
    expect(deleteObjects(doc, ['b1', 'b3'])).toBe(2);
    expect(snap(doc, 'b1')).toBeUndefined();
    expect(snap(doc, 'b3')).toBeUndefined();
    expect(bringObjectsToFront(doc, ['b2'])).toBe(1);
    expect((snap(doc, 'b2') as unknown as { z: number }).z).toBeGreaterThan(0);
  });

  it('drives a testbox selection through the same id-based reducer', () => {
    let s = selectionReducer(START, { type: 'setMany', ids: ['b1', 'b2'], additive: false });
    s = selectionReducer(s, { type: 'toggle', id: 'b2' }); // the reducer never sees the type
    expect([...s.ids].sort()).toEqual(['b1']);
    s = selectionReducer(s, { type: 'prune', presentIds: new Set(['b1']) }); // b2 deleted remotely
    expect([...s.ids]).toEqual(['b1']);
  });
});
