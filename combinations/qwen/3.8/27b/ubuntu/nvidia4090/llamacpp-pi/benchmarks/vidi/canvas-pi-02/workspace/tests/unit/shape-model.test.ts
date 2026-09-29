/**
 * Story 10 shape model unit tests (TC-01 to TC-06).
 *
 * Tests the createShape, setShapeStyle, and getShapeLabel contracts against
 * a real Y.Doc, asserting update event counts.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let count = 0;
  doc.on('update', () => { count += 1; });
  return () => count;
}

function getObjects(doc: Y.Doc) {
  return snapshot(doc).filter((o) => o.type === 'shape');
}

describe('shape.model: createShape', () => {
  it('TC-01 createShape rect 200x120 → 1 object, width 200, height 120, fill white, stroke dark, empty label, z=1, createdBy set', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
    })

    expect(id).not.toBeNull();
    const shapes = getObjects(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      id: id!,
      type: 'shape',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      kind: 'rect',
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
      label: '',
      z: 1,
    });
    expect(updates()).toBe(1);

    // Verify createdBy is set in the doc.
    const objMap = doc.getMap('objects');
    const obj = objMap.get(id!) as Y.Map<any>;
    expect(obj.get('createdBy')).toBeDefined();
  });

  it('TC-02 rect 19x200 and rect null → default 160x160 centred at `at`', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    // rect 19x200: width < SHAPE_MIN_SIZE_WORLD → click behaviour
    const id1 = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 19, height: 200 },
      at: { x: 300, y: 400 },
    })

    expect(id1).not.toBeNull();
    const s1 = getObjects(doc).find((s) => s.id === id1)!;
    expect(s1).toMatchObject({
      x: 300 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: 400 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });

    // rect null → click behaviour
    const id2 = createShape(doc, {
      kind: 'ellipse',
      rect: null,
      at: { x: 500, y: 600 },
    })

    expect(id2).not.toBeNull();
    const s2 = getObjects(doc).find((s) => s.id === id2)!;
    expect(s2).toMatchObject({
      x: 500 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: 600 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });

    expect(updates()).toBe(2);
  });

  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
      at: { x: 10, y: 20 },
    })

    expect(id).not.toBeNull();
    const s = getObjects(doc).find((x) => x.id === id)!;
    expect(s).toMatchObject({
      x: 10,
      y: 20,
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });
    expect(updates()).toBe(1);
  });

  it('TC-04 square: true on 200x120 → 200x200 anchored at drag origin', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    })

    expect(id).not.toBeNull();
    const s = getObjects(doc).find((x) => x.id === id)!;
    expect(s).toMatchObject({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    expect(updates()).toBe(1);
  });

  it('TC-05 setShapeStyle fill blue → applied, 1 update; fill teal → false, 0 updates', () => {
    const doc = freshDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 100 },
      at: { x: 0, y: 0 },
    })

    const updates = countUpdates(doc);

    // Valid: fill blue
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(updates()).toBe(1);
    const s = getObjects(doc).find((x) => x.id === id)!;
    expect(s.fill).toBe('blue');
    // Label and size unchanged.
    expect(s.label).toBe('');
    expect(s.width).toBe(200);
    expect(s.height).toBe(100);

    // Invalid: fill teal (not in SHAPE_FILL_COLORS)
    expect(setShapeStyle(doc, id!, { fill: 'teal' })).toBe(false);
    expect(updates()).toBe(1); // no additional update
  });

  it('TC-06 kind triangle and non-finite rect → null, 0 updates', () => {
    const doc = freshDoc();
    const updates = countUpdates(doc);

    // Unknown kind
    expect(createShape(doc, {
      kind: 'triangle' as any,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    })).toBeNull();

    // Non-finite rect
    expect(createShape(doc, {
      kind: 'rect',
      rect: { x: NaN, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    })).toBeNull();

    expect(getObjects(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });
});

describe('shape.model: getShapeLabel', () => {
  it('returns the Y.Text for a valid shape id', () => {
    const doc = freshDoc();
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    })

    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');

    // Insert text and verify it's reflected.
    label!.insert(0, 'Hello');
    expect(getObjects(doc).find((s) => s.id === id)!.label).toBe('Hello');
  });

  it('returns undefined for a stale id', () => {
    const doc = freshDoc();
    expect(getShapeLabel(doc, 'nonexistent')).toBeUndefined();
  });
});
