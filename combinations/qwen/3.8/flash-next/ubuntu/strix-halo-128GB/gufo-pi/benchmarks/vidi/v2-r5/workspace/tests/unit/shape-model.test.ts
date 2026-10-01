import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  readShapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../../src/shared/config';

/** Count the `update` events a call emits on the document. */
const withUpdateCount = <T>(doc: Y.Doc, run: () => T): { result: T; updates: number } => {
  let updates = 0;
  const observer = () => { updates += 1; };
  doc.on('update', observer);
  try {
    return { result: run(), updates };
  } finally {
    doc.off('update', observer);
  }
};

describe('shape model', () => {
  it('TC-01: createShape rect 200x120 → 1 object, correct size, defaults, z=maxZ+1, createdBy', () => {
    const doc = new Y.Doc();
    const { result: id, updates } = withUpdateCount(doc, () =>
      createShape(doc, {
        kind: 'rect',
        rect: { x: 100, y: 200, width: 200, height: 120 },
        at: { x: 200, y: 260 },
      }, 'user-1'),
    );
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    const snap = readShapeSnapshot(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.type).toBe('shape');
    expect(snap!.kind).toBe('rect');
    expect(snap!.x).toBe(100);
    expect(snap!.y).toBe(200);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(120);
    expect(snap!.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap!.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap!.label).toBe('');
    expect(snap!.z).toBe(1); // maxZ(0) + 1
  });

  it('TC-02: rect 19x200 (below min width) → default 160x160 centred at `at`', () => {
    const doc = new Y.Doc();
    const { result: id, updates } = withUpdateCount(doc, () =>
      createShape(doc, {
        kind: 'rect',
        rect: { x: 50, y: 50, width: 19, height: 200 },
        at: { x: 300, y: 400 },
      }, 'user-1'),
    );
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    const snap = readShapeSnapshot(doc, id!);
    expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // Centred on `at`
    expect(snap!.x).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap!.y).toBe(400 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-02b: rect null (click) → default 160x160 centred at `at`', () => {
    const doc = new Y.Doc();
    const { result: id, updates } = withUpdateCount(doc, () =>
      createShape(doc, {
        kind: 'ellipse',
        rect: null,
        at: { x: 100, y: 100 },
      }, 'user-1'),
    );
    expect(id).toBeTruthy();
    expect(updates).toBe(1);
    const snap = readShapeSnapshot(doc, id!);
    expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.x).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap!.y).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: rect exactly 20x20 (min size) → kept as drawn', () => {
    const doc = new Y.Doc();
    const { result: id } = withUpdateCount(doc, () =>
      createShape(doc, {
        kind: 'rect',
        rect: { x: 10, y: 10, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 20, y: 20 },
      }, 'user-1'),
    );
    expect(id).toBeTruthy();
    const snap = readShapeSnapshot(doc, id!);
    expect(snap!.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04: square=true on 200x120 → 200x200 anchored at drag origin', () => {
    const doc = new Y.Doc();
    const { result: id } = withUpdateCount(doc, () =>
      createShape(doc, {
        kind: 'rect',
        rect: { x: 50, y: 50, width: 200, height: 120 },
        at: { x: 250, y: 170 },
        square: true,
      }, 'user-1'),
    );
    expect(id).toBeTruthy();
    const snap = readShapeSnapshot(doc, id!);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(200);
    // Anchored at drag origin (rect.x, rect.y)
    expect(snap!.x).toBe(50);
    expect(snap!.y).toBe(50);
  });

  it('TC-05: setShapeStyle fill blue → applied, 1 update, label unchanged', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user-1')!;
    // Set a label first
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'Hello');
    const { result, updates } = withUpdateCount(doc, () => setShapeStyle(doc, id, { fill: 'blue' }));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    const snap = readShapeSnapshot(doc, id);
    expect(snap!.fill).toBe('blue');
    expect(snap!.label).toBe('Hello');
  });

  it('TC-05b: setShapeStyle fill "teal" (invalid) → false, 0 updates', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user-1')!;
    const { result, updates } = withUpdateCount(doc, () => setShapeStyle(doc, id, { fill: 'teal' }));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-06: kind "triangle" (invalid) → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'triangle' as any, rect: null, at: { x: 0, y: 0 } }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-06b: non-finite rect → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('TC-06c: non-finite at point → null, 0 updates', () => {
    const doc = new Y.Doc();
    const { result, updates } = withUpdateCount(doc, () =>
      createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } }, 'user-1'),
    );
    expect(result).toBeNull();
    expect(updates).toBe(0);
  });

  it('z increments from existing objects', () => {
    const doc = new Y.Doc();
    const id1 = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'user-1')!;
    const id2 = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 } }, 'user-1')!;
    const snap1 = readShapeSnapshot(doc, id1);
    const snap2 = readShapeSnapshot(doc, id2);
    expect(snap1!.z).toBe(1);
    expect(snap2!.z).toBe(2);
  });

  it('getShapeLabel returns Y.Text for a valid shape', () => {
    const doc = new Y.Doc();
    const id = createShape(doc, { kind: 'diamond', rect: null, at: { x: 0, y: 0 } }, 'user-1')!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  it('getShapeLabel returns undefined for stale id', () => {
    const doc = new Y.Doc();
    expect(getShapeLabel(doc, 'nonexistent')).toBeUndefined();
  });
});
