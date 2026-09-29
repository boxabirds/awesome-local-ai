import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createShape, setShapeStyle, getShapeLabel, snapshotShape } from '@shared/objects/shape';
import { createSticky, deleteObjects, snapshotAll, LOCAL_ORIGIN } from '@shared/board-model';
import { initDoc } from '@shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '@shared/config';
import type { Point } from '@client/canvas/camera';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const AT: Point = { x: 100, y: 100 };

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const handler = () => n++;
  doc.on('update', handler);
  fn();
  doc.off('update', handler);
  return n;
}

describe('shape model (TC-01..TC-06)', () => {
  it('TC-01: createShape stores every required field', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: AT }, 'user');
    expect(id).toBeTruthy();
    const m = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    for (const key of ['type', 'x', 'y', 'width', 'height', 'kind', 'fill', 'stroke', 'label', 'z', 'createdAt', 'createdBy']) {
      expect(m.has(key)).toBe(true);
    }
    expect(m.get('type')).toBe('shape');
    expect(m.get('kind')).toBe('rect');
    const snap = snapshotShape(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].x).toBe(10);
    expect(snap[0].y).toBe(20);
    expect(snap[0].width).toBe(200);
    expect(snap[0].height).toBe(120);
    expect(snap[0].fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap[0].stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap[0].createdBy).toBe('user');
  });

  it('TC-02: click (rect null) creates SHAPE_DEFAULT_SIZE_WORLD centred on the click point', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: AT }, 'user');
    expect(id).toBeTruthy();
    const snap = snapshotShape(doc);
    expect(snap[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].x).toBeCloseTo(AT.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap[0].y).toBeCloseTo(AT.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-02b: a rect with one dimension below min (19x200) falls back to default', () => {
    const doc = makeDoc();
    createShape(doc, { kind: 'rect', rect: { x: 50, y: 50, width: 19, height: 200 }, at: AT }, 'user');
    const snap = snapshotShape(doc);
    expect(snap[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-03: dragged rect under SHAPE_MIN_SIZE_WORLD falls back to default size', () => {
    const doc = makeDoc();
    createShape(doc, { kind: 'rect', rect: { x: 50, y: 50, width: 10, height: 8 }, at: AT }, 'user');
    const snap = snapshotShape(doc);
    expect(snap.length).toBe(1);
    expect(snap[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-03b: rect exactly SHAPE_MIN_SIZE_WORLD is kept (boundary, no fallback)', () => {
    const doc = makeDoc();
    createShape(doc, { kind: 'rect', rect: { x: 40, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: AT }, 'user');
    const snap = snapshotShape(doc);
    expect(snap[0].width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap[0].height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap[0].x).toBe(40);
    expect(snap[0].y).toBe(60);
  });

  it('TC-04: square constraint sets both sides to the larger dragged dimension', () => {
    const doc = makeDoc();
    createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: true }, 'user');
    const snap = snapshotShape(doc);
    expect(snap[0].width).toBe(200);
    expect(snap[0].height).toBe(200);
  });

  it('TC-05: setShapeStyle applies one colour, one LOCAL_ORIGIN update, label and size untouched', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: AT }, 'user')!;
    const label = getShapeLabel(doc, id)!;
    doc.transact(() => label.insert(0, 'hello'), LOCAL_ORIGIN);
    const before = snapshotShape(doc)[0];

    const updates = countUpdates(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    });
    expect(updates).toBe(1);
    const after = snapshotShape(doc)[0];
    expect(after.fill).toBe('blue');
    expect(after.label).toBe('hello');
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it('TC-05b: setShapeStyle rejects unknown colours and stale ids with no transaction', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'user')!;
    const updates = countUpdates(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'chartreuse' as never })).toBe(false);
      expect(setShapeStyle(doc, id, { stroke: 'purple' as never })).toBe(false);
      expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false);
    });
    expect(updates).toBe(0);
  });

  it('TC-06: getShapeLabel returns the Y.Text for a shape and undefined otherwise', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'diamond', rect: null, at: AT }, 'user')!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
    // A sticky has no shape label
    const sticky = createSticky(doc, AT);
    expect(getShapeLabel(doc, sticky)).toBeUndefined();
  });

  it('snapshotAll includes shapes and stickies together', () => {
    const doc = makeDoc();
    const s = createSticky(doc, { x: 0, y: 0 });
    const sh = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'user')!;
    const all = snapshotAll(doc);
    expect(all.length).toBe(2);
    expect(all.some((o) => o.id === s && o.type === 'sticky')).toBe(true);
    expect(all.some((o) => o.id === sh && o.type === 'shape')).toBe(true);
  });

  it('createShape rejects non-finite rect values with no write', () => {
    const doc = makeDoc();
    let id!: string | null;
    const updates = countUpdates(doc, () => {
      id = createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: AT }, 'user');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);
    expect(snapshotShape(doc).length).toBe(0);
  });

  it('createShape rejects an unknown kind with no write', () => {
    const doc = makeDoc();
    let id!: string | null;
    const updates = countUpdates(doc, () => {
      id = createShape(doc, { kind: 'hexagon' as never, rect: null, at: AT }, 'user');
    });
    expect(id).toBeNull();
    expect(updates).toBe(0);
  });

  it('shapes and stickies can coexist and both be deleted (deleteObjects detaches connectors)', () => {
    const doc = makeDoc();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const shape = createShape(doc, { kind: 'rect', rect: null, at: AT }, 'user')!;
    expect(snapshotAll(doc).length).toBe(2);
    deleteObjects(doc, [sticky, shape]);
    expect(snapshotAll(doc).length).toBe(0);
  });

  it('min size default constant matches SHAPE_MIN_SIZE_WORLD for resizing', () => {
    expect(SHAPE_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });
});
