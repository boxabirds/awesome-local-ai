// Story 7 — the object type registry (sel.registry).
// TC-11 (per-type capabilities) and TC-12 (unknown types are never selectable).

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  boundsHitTest,
  declareObjectTypes,
  declareObjectType,
  getObjectType,
  registeredTypes,
} from '../../src/client/objects/registry';
import {
  initDoc,
  createSticky,
  snapshot,
  objectBounds,
  allObjectIds,
  isKnownObjectType,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_TYPE, TESTBOX_MIN_SIZE, createTestbox } from '../fixtures/testbox';

// The App calls this at module load; a unit test has to ask for it.
declareObjectTypes();

describe('per-type capabilities (TC-11)', () => {
  it('sticky notes are resizable, aspect-locked, min 50 world units, and hold text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
    expect(typeof spec!.render).toBe('function');
  });

  it('the test box is resizable, NOT aspect-locked, min 10, and has no text', () => {
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(false);
    expect(spec!.minSize).toBe(TESTBOX_MIN_SIZE);
    expect(spec!.editableText).toBe(false);
  });

  it('every registered type declares the full capability set, not a partial one', () => {
    expect(registeredTypes()).toContain('sticky');
    for (const type of registeredTypes()) {
      const spec = getObjectType(type)!;
      expect(typeof spec.resizable).toBe('boolean');
      expect(typeof spec.aspectLocked).toBe('boolean');
      expect(typeof spec.editableText).toBe('boolean');
      expect(spec.minSize).toBeGreaterThan(0);
      expect(typeof spec.render).toBe('function');
    }
  });

  it('boundsHitTest returns the topmost object under a point and nothing outside', () => {
    const rows = [
      { id: 'a', type: 'sticky', x: 100, y: 100, width: 200, height: 200, z: 1, createdAt: 1 },
      { id: 'b', type: 'sticky', x: 120, y: 120, width: 40, height: 40, z: 2, createdAt: 1 },
    ];
    expect(boundsHitTest(rows, { x: 150, y: 150 })?.id).toBe('b'); // higher z wins
    expect(boundsHitTest(rows, { x: 100, y: 100 })?.id).toBe('a'); // the edge counts
    expect(boundsHitTest(rows, { x: 300, y: 300 })?.id).toBe('a');
    expect(boundsHitTest(rows, { x: 99.9, y: 150 })).toBeUndefined();
    expect(boundsHitTest(rows, { x: 300.1, y: 150 })).toBeUndefined();
  });

  it('declaring the types twice is idempotent (the sticky spec survives)', () => {
    const before = getObjectType('sticky');
    declareObjectTypes();
    expect(getObjectType('sticky')).toBe(before);
    expect(registeredTypes().filter((t) => t === 'sticky')).toHaveLength(1);
  });

  it('a type can be re-declared on purpose (last declaration wins)', () => {
    declareObjectType('temporary-type', { minSize: 1, render: () => null });
    expect(getObjectType('temporary-type')!.minSize).toBe(1);
    declareObjectType('temporary-type', { minSize: 2, render: () => null });
    expect(getObjectType('temporary-type')!.minSize).toBe(2);
  });
});

describe('unknown object types (TC-12)', () => {
  let doc: Y.Doc;
  let knownId: string;

  const plant = (id: string, type: string): void => {
    const ymap = new Y.Map<unknown>();
    ymap.set('type', type);
    ymap.set('x', 0);
    ymap.set('y', 0);
    ymap.set('z', 5);
    ymap.set('createdAt', 1);
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('objects').set(id, ymap);
    }, LOCAL_ORIGIN);
  };

  const setup = (): void => {
    doc = new Y.Doc();
    initDoc(doc);
    knownId = createSticky(doc, { x: 0, y: 0 });
  };

  it('a type this build does not know is not in the snapshot and not selectable', () => {
    setup();
    plant('mystery', 'not-a-type');
    expect(isKnownObjectType('not-a-type')).toBe(false);
    expect(snapshot(doc).map((o) => o.id)).toEqual([knownId]);
    expect(allObjectIds(snapshot(doc))).toEqual([knownId]);
  });

  it('registering a type makes its objects appear in the snapshot (the TC-12 complement)', () => {
    setup();
    expect(isKnownObjectType(TESTBOX_TYPE)).toBe(true);
    const boxId = createTestbox(doc, { x: 0, y: 0, width: 120, height: 60 });
    expect(snapshot(doc).map((o) => o.id).sort()).toEqual([boxId, knownId].sort());
    expect(allObjectIds(snapshot(doc)).sort()).toEqual([boxId, knownId].sort());
  });

  it('objectBounds of an unknown shape falls back to the sticky size (no NaN)', () => {
    const bounds = objectBounds({ id: 'x', type: 'mystery', x: 5, y: 5, z: 1, createdAt: 1 });
    expect(Number.isFinite(bounds.width)).toBe(true);
    expect(bounds.width).toBeGreaterThan(0);
  });
});
