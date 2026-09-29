/**
 * Story 10, shape.model (tasks 7/8) — unit tests for `createShape`,
 * `setShapeStyle` and `getShapeLabel` on a real Y.Doc.
 *
 * TC-01..TC-06: creation sizing (drag / click / min-size boundary / Shift),
 * style validation (known + unknown colour) and error paths (unknown kind,
 * non-finite rect). Every case asserts the `update` event count.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, allObjects } from 'src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  type ShapeKind,
} from 'src/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_KINDS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from 'src/shared/config';

/** Counts `update` events emitted on the doc. */
function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  doc.on('update', () => {
    n += 1;
  });
  return () => n;
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function shapeOf(doc: Y.Doc, id: string) {
  return allObjects(doc).find((o) => o.id === id);
}

function rawOf(doc: Y.Doc, id: string): Y.Map<unknown> {
  const raw = doc.getMap('objects').get(id);
  if (!(raw instanceof Y.Map)) throw new Error(`object ${id} missing`);
  return raw;
}

describe('shape.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = newDoc();
  });

  it('TC-01: createShape rect 200x120 creates one shape with the drag rect, defaults, z = maxZ+1, createdBy', () => {
    const updates = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } },
      'identity-1',
    );
    expect(id).toBeTruthy();
    expect(updates()).toBe(1);

    const shape = shapeOf(doc, id!)!;
    expect(shape.type).toBe('shape');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.z).toBe(1); // first object: maxZ (0) + 1

    const raw = rawOf(doc, id!);
    expect(raw.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(raw!.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(raw!.get('createdBy')).toBe('identity-1');
    const label = raw!.get('label');
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  it('TC-02: a 19x200 drag and a plain click (rect null) both create the default 160x160 centred on the point', () => {
    const updates = countUpdates(doc);
    const at = { x: 50, y: 60 };

    const tiny = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 19, height: 200 }, at },
      'identity-1',
    );
    const click = createShape(doc, { kind: 'ellipse', rect: null, at }, 'identity-1');
    expect(tiny).toBeTruthy();
    expect(click).toBeTruthy();
    expect(updates()).toBe(2);

    for (const id of [tiny!, click!]) {
      const shape = shapeOf(doc, id)!;
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      // centred on the click/drag-start point
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    }
  });

  it('TC-03: a drag of exactly SHAPE_MIN_SIZE_WORLD square is kept (boundary)', () => {
    const at = { x: 0, y: 0 };
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at },
      'identity-1',
    );
    expect(id).toBeTruthy();
    const shape = shapeOf(doc, id!)!;
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04: square (Shift) makes width = height = larger dragged dimension, anchored at the drag origin', () => {
    const at = { x: 10, y: 20 };
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at, square: true },
      'identity-1',
    );
    expect(id).toBeTruthy();
    const shape = shapeOf(doc, id!)!;
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(at.x);
    expect(shape.y).toBe(at.y);
  });

  it('TC-05: setShapeStyle applies a known fill (one update, label/size unchanged); an unknown colour is rejected with zero updates', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } },
      'identity-1',
    )!;
    const before = shapeOf(doc, id)!;

    let updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates()).toBe(1);
    let raw = rawOf(doc, id);
    expect(raw.get('fill')).toBe('blue');
    expect(raw.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    const after = shapeOf(doc, id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect((raw.get('label') as Y.Text).toString()).toBe('');

    // Unknown colour: rejected, zero updates, no partial write.
    updates = countUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(updates()).toBe(0);
    raw = rawOf(doc, id);
    expect(raw.get('fill')).toBe('blue');
  });

  it('TC-06: unknown kind and non-finite rect return null with zero updates (error path)', () => {
    let updates = countUpdates(doc);
    expect(
      createShape(
        doc,
        { kind: 'triangle' as ShapeKind, rect: { x: 0, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } },
        'identity-1',
      ),
    ).toBeNull();
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: NaN, y: 0, width: 50, height: 50 }, at: { x: 0, y: 0 } },
        'identity-1',
      ),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Infinity } }, 'identity-1'),
    ).toBeNull();
    expect(updates()).toBe(0);
    expect(allObjects(doc)).toHaveLength(0);
  });

  it('getShapeLabel returns the label Y.Text; all kinds are accepted', () => {
    for (const kind of SHAPE_KINDS) {
      const id = createShape(
        doc,
        { kind, rect: { x: 0, y: 0, width: 80, height: 80 }, at: { x: 0, y: 0 } },
        'identity-1',
      )!;
      const label = getShapeLabel(doc, id);
      expect(label).toBeInstanceOf(Y.Text);
      label!.insert(0, 'hello');
      expect((rawOf(doc, id).get('label') as Y.Text).toString()).toBe('hello');
    }
    expect(getShapeLabel(doc, 'no-such-id')).toBeUndefined();
  });
});
