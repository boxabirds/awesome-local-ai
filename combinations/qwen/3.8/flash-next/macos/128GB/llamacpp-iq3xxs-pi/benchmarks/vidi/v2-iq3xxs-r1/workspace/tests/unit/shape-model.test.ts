import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeSnapshots,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

/**
 * Story 10 — the shape model (shape.model).
 *
 * A real `Y.Doc`, no UI: sizing (drag, click, Shift), the palette validation and the
 * label `Y.Text` are all decided here, so every level above can be trusted to just
 * draw and gesture. Every case counts document updates, because a rejected request
 * must not touch the document — nor anybody else's board (design "Errors").
 */

/** Count the updates a body of work produces on this document. */
function countUpdates(doc: Y.Doc, body: () => void): number {
  let updates = 0;
  const onUpdate = (): void => {
    updates += 1;
  };
  doc.on('update', onUpdate);
  try {
    doc.transact(body, LOCAL_ORIGIN);
  } finally {
    doc.off('update', onUpdate);
  }
  return updates;
}

function fixture(): { doc: Y.Doc; updates: (body: () => void) => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let seen = 0;
  doc.on('update', () => {
    seen += 1;
  });
  return {
    doc,
    updates(body: () => void): number {
      seen = 0;
      // Model functions open their own transaction; this wrapper only runs the body.
      body();
      return seen;
    },
  };
}

const AT = { x: 500, y: 400 };

describe('shape model (shape.model)', () => {
  // TC-01: a dragged rectangle is stored exactly as it was drawn.
  it('TC-01 createShape rect 200x120 stores one shape, styled and empty-labelled, in one update', () => {
    const { doc, updates } = fixture();
    const rect: Rect = { x: 100, y: 120, width: 200, height: 120 };
    let id: string | null = null;
    const count = updates(() => {
      id = createShape(doc, { kind: 'rect', rect, at: { x: 200, y: 180 } }, 'me');
    });

    expect(id).not.toBeNull();
    expect(count).toBe(1);

    const shapes = shapeSnapshots(doc);
    expect(shapes).toHaveLength(1);
    const shape = shapes[0]!;
    expect(shape.id).toBe(id);
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(120);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe('');
    // z above everything already on the board, and attributable (design "Implementation").
    expect(shape.z).toBeGreaterThanOrEqual(1);
    expect(shape.createdBy).toBe('me');

    // The label is a shared Y.Text so two people can edit it with minimal diffs.
    const label = getShapeLabel(doc, shape.id);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  // TC-02: a too-small drag, and a click, both drop a standard shape centred on the point.
  it('TC-02 a 19x200 drag and a click (rect null) both create a 160x160 shape centred at the point', () => {
    const { doc, updates } = fixture();
    const at = AT;
    let tinyId: string | null = null;
    let clickId: string | null = null;
    const count = updates(() => {
      tinyId = createShape(
        doc,
        { kind: 'ellipse', rect: { x: 40, y: 10, width: 19, height: 200 }, at },
        'me',
      );
      clickId = createShape(doc, { kind: 'diamond', rect: null, at }, 'me');
    });
    expect(count).toBe(2);

    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    const shapes = shapeSnapshots(doc);
    expect(shapes).toHaveLength(2);
    for (const [index, id] of [tinyId, clickId].entries()) {
      const shape = shapes.find((s) => s.id === id);
      expect(shape, `shape ${index}`).toBeDefined();
      expect(shape!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape!.x).toBe(at.x - half);
      expect(shape!.y).toBe(at.y - half);
    }
    // A shape keeps the kind it was asked for; the kind never changes afterwards.
    expect(shapes.find((s) => s.id === tinyId)!.kind).toBe('ellipse');
    expect(shapes.find((s) => s.id === clickId)!.kind).toBe('diamond');
  });

  // TC-03: the boundary — a drag of exactly the minimum size is kept as drawn.
  it('TC-03 a drag of exactly SHAPE_MIN_SIZE_WORLD is kept, not replaced by the default', () => {
    const { doc, updates } = fixture();
    const rect: Rect = { x: 300, y: 300, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    let id: string | null = null;
    const count = updates(() => {
      id = createShape(doc, { kind: 'rect', rect, at: { x: 310, y: 310 } }, 'me');
    });
    expect(count).toBe(1);
    const shape = shapeSnapshots(doc).find((s) => s.id === id)!;
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(300);
    expect(shape.y).toBe(300);
  });

  // TC-04: Shift squares the drag with the larger dimension, anchored at the drag origin.
  it('TC-04 square: true turns a 200x120 drag into a 200x200 shape at the same origin', () => {
    const { doc, updates } = fixture();
    const rect: Rect = { x: 60, y: 40, width: 200, height: 120 };
    let id: string | null = null;
    const count = updates(() => {
      id = createShape(doc, { kind: 'rect', rect, at: { x: 60, y: 40 }, square: true }, 'me');
    });
    expect(count).toBe(1);
    const shape = shapeSnapshots(doc).find((s) => s.id === id)!;
    expect(shape.x).toBe(60);
    expect(shape.y).toBe(40);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
  });

  // TC-05: restyling writes one update and touches nothing else; an unknown colour writes nothing.
  it('TC-05 setShapeStyle applies a palette colour and refuses one that is not in it', () => {
    const { doc, updates } = fixture();
    let id = '';
    updates(() => {
      id = createShape(
        doc,
        { kind: 'rect', rect: { x: 10, y: 10, width: 200, height: 120 }, at: AT },
        'me',
      )!;
    });
    getShapeLabel(doc, id)?.insert(0, 'Checkout');

    let applied = false;
    const appliedUpdates = updates(() => {
      applied = setShapeStyle(doc, id, { fill: 'blue' });
    });
    expect(applied).toBe(true);
    expect(appliedUpdates).toBe(1);

    let shape = shapeSnapshots(doc).find((s) => s.id === id)!;
    expect(shape.fill).toBe('blue');
    // Only the colour key moved: label, size and position are as they were (PRD shape.style).
    expect(shape.label).toBe('Checkout');
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(10);

    let rejected = true;
    const rejectedUpdates = updates(() => {
      rejected = setShapeStyle(doc, id, { fill: 'teal' });
    });
    expect(rejected).toBe(false);
    expect(rejectedUpdates).toBe(0);
    shape = shapeSnapshots(doc).find((s) => s.id === id)!;
    expect(shape.fill).toBe('blue');

    // An outline is picked the same way, and a stale id is refused without a write.
    let outlined = false;
    const outlineUpdates = updates(() => {
      outlined = setShapeStyle(doc, id, { stroke: 'red' });
    });
    expect(outlined).toBe(true);
    expect(outlineUpdates).toBe(1);
    expect(shapeSnapshots(doc).find((s) => s.id === id)!.stroke).toBe('red');

    let stale = true;
    const staleUpdates = updates(() => {
      stale = setShapeStyle(doc, 'no-such-shape', { fill: 'green' });
    });
    expect(stale).toBe(false);
    expect(staleUpdates).toBe(0);
  });

  // TC-06: an unknown kind or a non-finite rect creates nothing at all.
  it('TC-06 an unknown kind and a non-finite rect both return null with zero updates', () => {
    const { doc, updates } = fixture();
    let unknownKind: string | null = 'x';
    let NaNRect: string | null = 'x';
    let NaNAt: string | null = 'x';
    let wrongType: string | null = 'x';
    const count = updates(() => {
      unknownKind = createShape(doc, { kind: 'triangle' as ShapeKind, rect: { x: 0, y: 0, width: 100, height: 100 }, at: AT }, 'me');
      NaNRect = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: AT }, 'me');
      NaNAt = createShape(doc, { kind: 'rect', rect: null, at: { x: Number.POSITIVE_INFINITY, y: 0 } }, 'me');
      wrongType = createShape(doc, { kind: 'rect', rect: { x: 0, y: Number.NaN, width: 100, height: 100 }, at: AT }, 'me');
    });
    expect(unknownKind).toBeNull();
    expect(NaNRect).toBeNull();
    expect(NaNAt).toBeNull();
    expect(wrongType).toBeNull();
    expect(count).toBe(0);
    expect(shapeSnapshots(doc)).toHaveLength(0);
    // Nothing was written under another id either.
    expect(doc.getMap('objects').size).toBe(0);
  });

  // Shapes stack above whatever is already on the board (design: z = maxZ + 1).
  it('z is one above the highest object already on the board', () => {
    const { doc, updates } = fixture();
    let firstZ = 0;
    let secondZ = 0;
    updates(() => {
      const a = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 40, height: 40 }, at: AT }, 'me')!;
      firstZ = shapeSnapshots(doc).find((s) => s.id === a)!.z;
      const b = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 40, height: 40 }, at: AT }, 'me')!;
      secondZ = shapeSnapshots(doc).find((s) => s.id === b)!.z;
    });
    expect(secondZ).toBe(firstZ + 1);
  });

  // The whole suite's own guard: `countUpdates` proves a rejected write is not an update.
  it('counts one update per model transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    expect(countUpdates(doc, () => undefined)).toBe(0);
    expect(
      countUpdates(doc, () => {
        doc.getMap('objects').set('x', new Y.Map());
      }),
    ).toBe(1);
  });
});
