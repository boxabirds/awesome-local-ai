import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  setShapeStyle
} from '../../src/shared/objects/shape';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function trackUpdates(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    stop: () => doc.off('update', listener)
  };
}

describe('shape.model', () => {
  test('TC-01 createShape with a rect creates a styled shape with an empty label', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 } },
      'g_test'
    );
    expect(id).not.toBeNull();
    expect(objectsOf(doc).size).toBe(1);

    const obj = objectsOf(doc).get(id!);
    expect(obj!.get('type')).toBe('shape');
    expect(obj!.get('kind')).toBe('rect');
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
    expect(obj!.get('width')).toBe(200);
    expect(obj!.get('height')).toBe(120);
    expect(obj!.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj!.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(obj!.get('label')).toBeInstanceOf(Y.Text);
    expect((obj!.get('label') as Y.Text).toString()).toBe('');
    expect(obj!.get('createdBy')).toBe('g_test');
    expect(typeof obj!.get('createdAt')).toBe('number');
  });

  test('TC-02 sub-minimum rect or rect null creates a standard shape centred on the point', () => {
    const doc = newDoc();
    const at = { x: 100, y: 100 };
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;

    const fromTiny = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 90, y: 0, width: 19, height: 200 }, at },
      'g_test'
    );
    const tiny = objectsOf(doc).get(fromTiny!)!;
    expect(tiny.get('x')).toBe(at.x - half);
    expect(tiny.get('y')).toBe(at.y - half);
    expect(tiny.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(tiny.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    const fromClick = createShape(doc, { kind: 'diamond', rect: null, at }, 'g_test');
    const click = objectsOf(doc).get(fromClick!)!;
    expect(click.get('x')).toBe(at.x - half);
    expect(click.get('y')).toBe(at.y - half);
    expect(click.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(click.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  test('TC-03 a drag of exactly the minimum size is kept as drawn', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: 20, height: 20 }, at: { x: 10, y: 20 } },
      'g_test'
    );
    const obj = objectsOf(doc).get(id!)!;
    expect(obj.get('x')).toBe(10);
    expect(obj.get('y')).toBe(20);
    expect(obj.get('width')).toBe(20);
    expect(obj.get('height')).toBe(20);
  });

  test('TC-04 square constraint sets both dimensions to the larger dragged one', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: true },
      'g_test'
    );
    const obj = objectsOf(doc).get(id!)!;
    // Anchored at the drag origin corner (the rect's x/y).
    expect(obj.get('x')).toBe(0);
    expect(obj.get('y')).toBe(0);
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(200);
  });

  test('TC-05 setShapeStyle validates colours against the palettes', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      'g_test'
    )!;
    getShapeLabel(doc, id)!.insert(0, 'keep me');

    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(objectsOf(doc).get(id)!.get('fill')).toBe('blue');

    const tracker = trackUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'neon' })).toBe(false);
    expect(setShapeStyle(doc, 'no-such-id', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false); // no-op re-set
    tracker.stop();
    expect(tracker.count()).toBe(0);

    // Style writes never touch the label.
    expect(getShapeLabel(doc, id)!.toString()).toBe('keep me');
  });

  test('TC-06 unknown kind and non-finite inputs return null with no transaction', () => {
    const doc = newDoc();
    const tracker = trackUpdates(doc);

    expect(
      createShape(
        doc,
        { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'g_test'
      )
    ).toBeNull();
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'g_test'
      )
    ).toBeNull();
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 }, at: { x: 0, y: 0 } },
        'g_test'
      )
    ).toBeNull();
    // Tiny rect with a non-finite fallback point: nothing sensible to create.
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: 0, y: 0, width: 5, height: 5 }, at: { x: Number.NaN, y: 0 } },
        'g_test'
      )
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.NaN } }, 'g_test')
    ).toBeNull();

    expect(objectsOf(doc).size).toBe(0);
    tracker.stop();
    expect(tracker.count()).toBe(0);
  });
});
