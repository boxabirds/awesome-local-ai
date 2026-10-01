import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
} from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('shape.model — createShape', () => {
  it('TC-01 creates rect 200x120: 1 object, correct width/height/fill/stroke, empty label, z = maxZ+1, createdBy set', () => {
    const doc = makeDoc();
    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 10, y: 20 } },
      'user1',
    );
    expect(id).toBeTruthy();
    expect(updateCount).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!);
    expect(obj).toBeDefined();
    expect(obj!.get('type')).toBe('shape');
    expect(obj!.get('kind')).toBe('rect');
    expect(obj!.get('x')).toBe(10);
    expect(obj!.get('y')).toBe(20);
    expect(obj!.get('width')).toBe(200);
    expect(obj!.get('height')).toBe(120);
    expect(obj!.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj!.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(obj!.get('createdBy')).toBe('user1');
    const label = obj!.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect((label as Y.Text).toString()).toBe('');
    expect(typeof obj!.get('z')).toBe('number');
    expect((obj!.get('z') as number)).toBeGreaterThan(0);
  });

  it('TC-02 rect 19x200 and rect null → default 160x160 centred at at (click behaviour)', () => {
    const doc = makeDoc();
    const at = { x: 500, y: 300 };

    // rect with width 19 < SHAPE_MIN_SIZE_WORLD
    const id1 = createShape(
      doc,
      { kind: 'rect', rect: { x: 400, y: 200, width: 19, height: 200 }, at },
      'user1',
    );
    expect(id1).toBeTruthy();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj1 = objects.get(id1!);
    expect(obj1!.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj1!.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj1!.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj1!.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // rect null
    const id2 = createShape(
      doc,
      { kind: 'ellipse', rect: null, at },
      'user1',
    );
    expect(id2).toBeTruthy();
    const obj2 = objects.get(id2!);
    expect(obj2!.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2!.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(obj2!.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(obj2!.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03 rect exactly SHAPE_MIN_SIZE_WORLD square → kept (boundary)', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 50, y: 50, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 60, y: 60 } },
      'user1',
    );
    expect(id).toBeTruthy();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!);
    expect(obj!.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj!.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(obj!.get('x')).toBe(50);
    expect(obj!.get('y')).toBe(50);
  });

  it('TC-04 square: true on 200x120 → 200x200 anchored at drag origin', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 }, square: true },
      'user1',
    );
    expect(id).toBeTruthy();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!);
    expect(obj!.get('width')).toBe(200);
    expect(obj!.get('height')).toBe(200);
    expect(obj!.get('x')).toBe(100);
    expect(obj!.get('y')).toBe(50);
  });

  it('TC-06 kind "triangle" and non-finite rect → null, 0 updates (error path)', () => {
    const doc = makeDoc();
    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    const r1 = createShape(
      doc,
      { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
      'user1',
    );
    expect(r1).toBeNull();

    const r2 = createShape(
      doc,
      { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
      'user1',
    );
    expect(r2).toBeNull();

    expect(updateCount).toBe(0);
  });
});

describe('shape.model — setShapeStyle', () => {
  it('TC-05 setShapeStyle fill blue → applied, 1 update, label/size unchanged; fill "teal" → false, 0 updates', () => {
    const doc = makeDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 10, width: 100, height: 80 }, at: { x: 60, y: 50 } },
      'user1',
    );
    expect(id).toBeTruthy();

    // Set a label to verify it's unchanged
    const yText = getShapeLabel(doc, id!);
    expect(yText).toBeDefined();
    yText!.insert(0, 'hello');

    let updateCount = 0;
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) updateCount++;
    });

    // Valid colour
    const ok = setShapeStyle(doc, id!, { fill: 'blue' });
    expect(ok).toBe(true);
    expect(updateCount).toBe(1);

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const obj = objects.get(id!);
    expect(obj!.get('fill')).toBe('blue');
    // Label unchanged
    expect((obj!.get('label') as Y.Text).toString()).toBe('hello');
    // Size unchanged
    expect(obj!.get('width')).toBe(100);
    expect(obj!.get('height')).toBe(80);

    // Invalid colour
    const fail = setShapeStyle(doc, id!, { fill: 'teal' });
    expect(fail).toBe(false);
    expect(updateCount).toBe(1); // no new update
  });
});
