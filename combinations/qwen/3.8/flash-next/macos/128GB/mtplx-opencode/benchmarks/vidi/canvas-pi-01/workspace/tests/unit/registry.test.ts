/**
 * Story 7 · task 7 — registry unit tests (TC-11, TC-12, duplicate registration).
 *
 * Pure lookups against the module-level registry: no DOM, no React. The
 * registry only carries per-type *behaviour* (resize rules + a pure hit test),
 * which is the seam stories 9–12 plug new shapes into without touching the
 * transform code (`sel.all_types`).
 */
import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  registerObjectType,
} from '../../src/client/objects/registry';
import { SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_MIN_SIZE, ensureTestboxRegistered } from '../fixtures/testbox';

describe('sticky spec (TC-11)', () => {
  it('declares a square, aspect-locked, resizable, editable note', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(true);
  });

  it('hit-tests true inside its bounds and false one unit outside (boundary)', () => {
    const spec = getObjectType('sticky')!;
    const note = { id: 'n', type: 'sticky', x: 0, y: 0, z: 1, width: 200, height: 200, createdAt: 0 };
    // The centre is a hit; a point just beyond the right edge is not.
    expect(spec.hitTest(note, { x: 100, y: 100 })).toBe(true);
    expect(spec.hitTest(note, { x: 201, y: 100 })).toBe(false);
  });
});

describe('unknown type (TC-12)', () => {
  it('resolves to undefined so it is neither selectable nor resizable', () => {
    // Story 10 added `shape` and `connector`, so the "a type this client does
    // not know" stand-in is now a made-up one: forward compatibility is about
    // types from a *newer* client, not about the ones shipped here.
    expect(getObjectType('widget-from-the-future')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('knows the two story-10 types', () => {
    // Shapes resize freely from the corner handles; arrows do not resize at all
    // and are picked by proximity to their line (PRD shape.connector_precise).
    expect(getObjectType('shape')).toMatchObject({
      resizable: true,
      aspectLocked: false,
      minSize: SHAPE_MIN_SIZE_WORLD,
      editableText: true,
    });
    expect(getObjectType('connector')).toMatchObject({
      resizable: false,
      aspectLocked: false,
      editableText: false,
    });
  });
});

describe('connector hit test (shape.arrow_select)', () => {
  /** A horizontal arrow from (0,0) to (200,0), plus a box that only contains it. */
  const arrow = {
    id: 'c',
    type: 'connector',
    x: 0,
    y: 0,
    width: 200,
    height: 0,
    z: 1,
    createdAt: 0,
    ends: { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } },
  };

  it('selects on the line and not inside the empty half of its box', () => {
    const spec = getObjectType('connector')!;
    // On the line, 3 units away from it.
    expect(spec.hitTest(arrow, { x: 100, y: 3 })).toBe(true);
    // Inside the bounding box but 40 units from the line: not the arrow.
    expect(spec.hitTest(arrow, { x: 100, y: 40 })).toBe(false);
    // And outside the box entirely.
    expect(spec.hitTest(arrow, { x: 300, y: 0 })).toBe(false);
  });

  it('keeps the tolerance in screen pixels as the camera zooms', () => {
    const spec = getObjectType('connector')!;
    // The band is 6 *screen* pixels wide, so what counts as "on the line"
    // shrinks in world units as the board is zoomed in (PRD
    // `shape.connector_precise`): 3 units at 1× is 3 px and hits, the same 3
    // units at 10× is 30 px and misses, while 0.3 units at 10× is 3 px again.
    expect(spec.hitTest(arrow, { x: 100, y: 3 }, 1)).toBe(true);
    expect(spec.hitTest(arrow, { x: 100, y: 3 }, 10)).toBe(false);
    expect(spec.hitTest(arrow, { x: 100, y: 0.3 }, 10)).toBe(true);
    // Zoomed out, the same 3 units are under a pixel: still a hit.
    expect(spec.hitTest(arrow, { x: 100, y: 3 }, 0.1)).toBe(true);
  });

  it('degrades safely when there is no geometry, or no zoom', () => {
    const spec = getObjectType('connector')!;
    // A malformed record (no resolved ends) selects nothing rather than throwing.
    expect(
      spec.hitTest({ id: 'x', type: 'connector', x: 0, y: 0, width: 10, height: 10, z: 1, createdAt: 0 }, { x: 0, y: 0 }),
    ).toBe(false);
    // A degenerate (zero-length) arrow is still hit-able at its point.
    const dot = { ...arrow, ends: { from: { x: 10, y: 10 }, to: { x: 10, y: 10 } } };
    expect(spec.hitTest(dot, { x: 10, y: 10 })).toBe(true);
    expect(spec.hitTest(dot, { x: 40, y: 40 })).toBe(false);
  });
});

describe('duplicate registration (error path)', () => {
  it('throws when a type is registered twice (a programming error)', () => {
    registerObjectType('widget-unique', {
      resizable: true,
      aspectLocked: false,
      minSize: 5,
      editableText: false,
      hitTest: () => true,
    });
    expect(() =>
      registerObjectType('widget-unique', {
        resizable: false,
        aspectLocked: false,
        minSize: 5,
        editableText: false,
        hitTest: () => true,
      }),
    ).toThrow(/already registered/);
  });
});

describe('test-only type (TC-24 basis)', () => {
  it('registers a freely-resizable, non-aspect-locked rectangle', () => {
    ensureTestboxRegistered();
    const spec = getObjectType('testbox');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.minSize).toBe(TESTBOX_MIN_SIZE);
  });
});
