import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

// We import the registry functions and test them.
// The sticky registration happens at module load.
import { getObjectType, registerObjectType } from '../../src/client/objects/registry';

describe('registry — getObjectType', () => {
  it('TC-11: sticky spec has resizable true, aspectLocked true, minSize STICKY_MIN_SIZE_WORLD', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(true);
  });

  it('TC-11: sticky hitTest returns true inside bounds and false 1 unit outside', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 }); // top-left at 0,0 size 200
    const snap = snapshot(doc)[0];
    const spec = getObjectType('sticky')!;

    // Inside: center of the note
    expect(spec.hitTest(snap, { x: 100, y: 100 })).toBe(true);
    // At corner exactly (on boundary, counts as inside)
    expect(spec.hitTest(snap, { x: 0, y: 0 })).toBe(true);
    // Outside: 1 unit beyond right edge
    expect(spec.hitTest(snap, { x: 201, y: 100 })).toBe(false);
    // Outside: 1 unit beyond top
    expect(spec.hitTest(snap, { x: 100, y: -1 })).toBe(false);
  });

  it('TC-12: unknown type returns undefined', () => {
    expect(getObjectType('unknown-type-xyz')).toBeUndefined();
  });

  it('duplicate registration throws', () => {
    expect(() => {
      registerObjectType('sticky', {
        Component: () => null,
        resizable: false,
        aspectLocked: false,
        minSize: 0,
        editableText: false,
        hitTest: () => false,
      });
    }).toThrow();
  });
});
