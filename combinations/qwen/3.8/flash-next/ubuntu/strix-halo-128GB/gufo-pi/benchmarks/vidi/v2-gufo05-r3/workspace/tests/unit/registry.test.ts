import { describe, expect, it } from 'vitest';
import {
  getObjectType,
  hitTestBounds,
  registerObjectType,
  registeredTypes,
} from '../../src/client/objects/registry';
import { stickyObjectType } from '../../src/client/objects/sticky';
import { isKnownObjectType } from '../../src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { TESTBOX_TYPE, testboxObjectType } from '../fixtures/testbox';

// The client registers its own types in `objects/index.ts`; a unit test starts
// from an empty registry and registers what it needs.
registerObjectType('sticky', stickyObjectType);

describe('object type registry (sel.registry)', () => {
  it('TC-11 knows the sticky note: resizable, square, min size, editable text', () => {
    const spec = getObjectType('sticky');
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.editableText).toBe(true);
    expect(spec?.minSize).toBe(STICKY_MIN_SIZE_WORLD);
  });

  it('TC-11 a sticky hit test covers its bounds and stops one unit outside', () => {
    const hit = getObjectType('sticky')!.hitTest;
    const note = { id: 'a', type: 'sticky', x: 100, y: 50, z: 1, createdAt: 0 };
    // No stored size: the default note size applies (story 2 notes).
    expect(hit(note, { x: 100, y: 50 })).toBe(true);
    expect(hit(note, { x: 199.5, y: 149.5 })).toBe(true);
    expect(hit(note, { x: 99, y: 100 })).toBe(false);
    expect(hit(note, { x: 100, y: 251 })).toBe(false);
    // With an explicit size the box follows it.
    const big = { ...note, width: 400, height: 300 };
    expect(hit(big, { x: 499, y: 349 })).toBe(true);
    expect(hit(big, { x: 501, y: 349 })).toBe(false);
  });

  it('TC-12 an unknown type has no spec', () => {
    expect(getObjectType('unknown')).toBeUndefined();
    expect(getObjectType('')).toBeUndefined();
  });

  it('registering the same type twice throws (a programming error, not data)', () => {
    expect(() => registerObjectType('sticky', stickyObjectType)).toThrow(/sticky/);
  });

  it('a test-only type is retrievable with its own answers', () => {
    registerObjectType(TESTBOX_TYPE, testboxObjectType);
    const spec = getObjectType(TESTBOX_TYPE);
    expect(spec).toBe(testboxObjectType);
    expect(spec?.resizable).toBe(true);
    // Different from the sticky note on purpose: that is what proves the
    // selection code is generic rather than sticky-shaped.
    expect(spec?.aspectLocked).toBe(false);
    expect(spec?.editableText).toBe(false);
    expect(spec?.minSize).toBe(10);
    expect(registeredTypes()).toContain(TESTBOX_TYPE);
  });

  it('registering a type makes it known to the board model too', () => {
    // Otherwise "select all" and the marquee would offer objects this build
    // cannot draw, and move or delete them by accident.
    expect(isKnownObjectType('sticky')).toBe(true);
    registerObjectType('widget', { ...testboxObjectType });
    expect(isKnownObjectType('widget')).toBe(true);
    expect(isKnownObjectType('future-thing')).toBe(false);
  });

  it('the default hit test treats the rectangle edges as inside', () => {
    const box = { id: 'b', type: 'testbox', x: 0, y: 0, z: 1, createdAt: 0, width: 20, height: 10 };
    expect(hitTestBounds(box, { x: 0, y: 0 })).toBe(true);
    expect(hitTestBounds(box, { x: 20, y: 10 })).toBe(true);
    expect(hitTestBounds(box, { x: 20.0001, y: 5 })).toBe(false);
  });
});
