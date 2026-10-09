import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD
} from '../../src/shared/config';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape';

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function entry(doc: Y.Doc, id: string): Y.Map<unknown> {
  return doc.getMap('objects').get(id) as Y.Map<unknown>;
}

describe('shape.model', () => {
  test('TC-01 createShape draws the requested rect with default style, empty label, z on top, createdBy set', () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    const stop = countUpdates(doc);
    const id = createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 200, y: 160 } }, 'g_test');
    expect(stop()).toBe(1);
    expect(typeof id).toBe('string');
    const created = entry(doc, id as string);
    expect(created.get('type')).toBe('shape');
    expect(created.get('kind')).toBe('rect');
    expect(created.get('x')).toBe(100);
    expect(created.get('y')).toBe(100);
    expect(created.get('width')).toBe(200);
    expect(created.get('height')).toBe(120);
    expect(created.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(created.get('fill')).toBe('white');
    expect(created.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(created.get('stroke')).toBe('dark');
    expect(created.get('z')).toBe(2);
    expect(created.get('createdBy')).toBe('g_test');
    const label = getShapeLabel(doc, id as string);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label?.toString()).toBe('');
  });

  test('TC-02 a sub-minimum drag or a null rect creates a default shape centred on the click point', () => {
    const doc = makeDoc();
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    const stop = countUpdates(doc);
    const byDrag = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 100, y: 100, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at: { x: 300, y: 300 } },
      'g_test'
    );
    expect(byDrag).not.toBeNull();
    const dragEntry = entry(doc, byDrag as string);
    expect(dragEntry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(dragEntry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(dragEntry.get('x')).toBe(300 - half);
    expect(dragEntry.get('y')).toBe(300 - half);

    const byClick = createShape(doc, { kind: 'diamond', rect: null, at: { x: 50, y: -40 } }, 'g_test');
    expect(byClick).not.toBeNull();
    const clickEntry = entry(doc, byClick as string);
    expect(clickEntry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickEntry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickEntry.get('x')).toBe(50 - half);
    expect(clickEntry.get('y')).toBe(-40 - half);
    expect(stop()).toBe(2);
  });

  test('TC-03 a drag of exactly SHAPE_MIN_SIZE_WORLD is kept as drawn', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 60, y: 70 } },
      'g_test'
    );
    expect(id).not.toBeNull();
    const created = entry(doc, id as string);
    expect(created.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(created.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(created.get('x')).toBe(50);
    expect(created.get('y')).toBe(60);
    expect(stop()).toBe(1);
  });

  test('TC-04 square:true sets both sides to the larger dragged dimension anchored at the origin', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 }, square: true },
      'g_test'
    );
    expect(id).not.toBeNull();
    const created = entry(doc, id as string);
    expect(created.get('width')).toBe(200);
    expect(created.get('height')).toBe(200);
    expect(created.get('x')).toBe(100);
    expect(created.get('y')).toBe(100);
    expect(stop()).toBe(1);
  });

  test('TC-05 setShapeStyle applies valid colours in one update and rejects unknown colours with none', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } }, 'g_test') as string;
    const created = entry(doc, id);
    const stop = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(stop()).toBe(1);
    expect(created.get('fill')).toBe('blue');
    // Only the fill key changed: stroke, size and label are untouched.
    expect(created.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(created.get('width')).toBe(200);
    expect(created.get('height')).toBe(120);
    expect(getShapeLabel(doc, id)?.toString()).toBe('');

    const stop2 = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    expect(stop2()).toBe(0);
    expect(created.get('fill')).toBe('blue');
  });

  test('TC-06 createShape rejects unknown kinds and non-finite rects with null and no transaction', () => {
    const doc = makeDoc();
    const stop = countUpdates(doc);
    expect(
      createShape(doc, { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')
    ).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Number.NaN, y: 0 } }, 'g_test')).toBeNull();
    expect(stop()).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });
});
