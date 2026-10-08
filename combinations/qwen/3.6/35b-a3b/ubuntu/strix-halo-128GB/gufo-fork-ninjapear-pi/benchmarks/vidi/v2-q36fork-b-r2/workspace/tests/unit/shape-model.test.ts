import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { Map as YJSMap } from 'yjs';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import { initDoc } from '../../src/shared/board-model';

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let updates = 0;
  doc.on('update', () => { updates++; });
  fn();
  return updates;
}

function getObjMap(doc: Y.Doc): YJSMap {
  return doc.getMap('objects') as unknown as YJSMap;
}

describe('TC-01: createShape drag', () => {
  it('creates rect 200x120 with default fill/stroke/label z=1 createdBy', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    doc.on('update', () => { updates++; });

    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } },
      'user1',
    );
    expect(id).toBeTruthy();
    expect(updates).toBe(1);

    const snap = getObjMap(doc);
    const map = snap.get(id!) as YJSMap;
    expect(map.get('type')).toBe('shape');
    expect(map.get('kind')).toBe('rect');
    expect(map.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(map.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(map.get('x')).toBe(0);
    expect(map.get('y')).toBe(0);
    expect(map.get('width')).toBe(200);
    expect(map.get('height')).toBe(120);
    expect(map.get('z')).toBe(1);
    expect(map.get('createdBy')).toBe('user1');
    const label = map.get('label');
    expect(label instanceof Y.Text).toBe(true);
    expect((label as Y.Text).toString()).toBe('');
  });
});

describe('TC-02: createShape click and tiny-drag', () => {
  it('null rect creates SHAPE_DEFAULT_SIZE_WORLD centred at at', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: null, at: { x: 200, y: 300 } },
      'user1',
    );
    expect(id).toBeTruthy();
    const snap = getObjMap(doc);
    const map = snap.get(id!) as YJSMap;
    expect(map.get('x')).toBe(200 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(map.get('y')).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(map.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(map.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('tiny drag < min size creates default size centred at at', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 200, width: 19, height: 200 }, at: { x: 100, y: 200 } },
      'user1',
    );
    expect(id).toBeTruthy();
    const snap = getObjMap(doc);
    const map = snap.get(id!) as YJSMap;
    expect(map.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(map.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });
});

describe('TC-03: createShape boundary exactly min size', () => {
  it('exactly 20x20 is kept', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 20, height: 20 }, at: { x: 0, y: 0 } },
      'user1',
    );
    expect(id).toBeTruthy();
    const snap = getObjMap(doc);
    const map = snap.get(id!) as YJSMap;
    expect(map.get('width')).toBe(20);
    expect(map.get('height')).toBe(20);
  });
});

describe('TC-04: createShape square constrain', () => {
  it('200x120 with square=true becomes 200x200 anchored at origin', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 50, y: 50, width: 200, height: 120 }, at: { x: 50, y: 50 }, square: true },
      'user1',
    );
    expect(id).toBeTruthy();
    const snap = getObjMap(doc);
    const map = snap.get(id!) as YJSMap;
    expect(map.get('width')).toBe(200);
    expect(map.get('height')).toBe(200);
    expect(map.get('x')).toBe(50);
    expect(map.get('y')).toBe(50);
  });
});

describe('TC-05: setShapeStyle validation', () => {
  it('valid fill blue applied (hex), 1 update; label/size unchanged', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } },
      'user1',
    );
    if (!id) throw new Error('expected id');
    const initialLabel = getShapeLabel(doc, id)?.toString();
    const objects = getObjMap(doc);
    const initialZ = (objects.get(id) as YJSMap)?.get('z');

    let updates = 0;
    doc.on('update', () => { updates++; });
    const ok = setShapeStyle(doc, id, { fill: 'blue' });
    expect(ok).toBe(true);
    expect(updates).toBe(1);

    const map = objects.get(id) as YJSMap;
    expect(map.get('fill')).toBe('#BBDEFB');
    expect(map.get('label')?.toString()).toBe(initialLabel);
    expect(map.get('width')).toBe(100);
    expect(map.get('height')).toBe(80);
    expect(map.get('z')).toBe(initialZ);
  });

  it('invalid fill "teal" returns false, 0 updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 0, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } },
      'user1',
    );
    if (!id) throw new Error('expected id');
    let updates = 0;
    doc.on('update', () => { updates++; });
    const ok = setShapeStyle(doc, id, { fill: 'teal' });
    expect(ok).toBe(false);
    expect(updates).toBe(0);
    const map = getObjMap(doc).get(id) as YJSMap;
    expect(map.get('fill')).toBe(DEFAULT_SHAPE_FILL);
  });
});

describe('TC-06: createShape error paths', () => {
  it('unknown kind returns null, 0 updates', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    doc.on('update', () => { updates++; });
    const result = createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } }, 'user1');
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('non-finite rect coordinates rejected → null', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } }, 'user1');
    expect(result).toBeNull();
  });

  it('non-finite point at coordinates returns null', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const result = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 50, height: 50 }, at: { x: Infinity, y: 0 } }, 'user1');
    expect(result).toBeNull();
  });
});
