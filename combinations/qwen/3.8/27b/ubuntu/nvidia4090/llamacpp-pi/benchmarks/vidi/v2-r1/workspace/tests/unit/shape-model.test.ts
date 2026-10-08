// TC-01..TC-06: shape model (create/resize/constrain/style/label + error
// paths). Tests the model directly against a Y.Doc, like the existing
// model tests.

import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  objectsSnapshot,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
} from '../../src/shared/objects/shape';

registerKnownObjectType('shape');

const BY = 'tester';

function countingDoc(): { doc: Y.Doc; counter: { n: number } } {
  const doc = new Y.Doc();
  const counter = { n: 0 };
  doc.on('update', () => {
    counter.n += 1;
  });
  return { doc, counter };
}

let doc: Y.Doc;
let counter: { n: number };

beforeEach(() => {
  ({ doc, counter } = countingDoc());
});

function lastSnap(): ObjectSnapshot {
  const snaps = objectsSnapshot(doc);
  const snap = snaps[snaps.length - 1];
  if (!snap) throw new Error('no snapshot');
  return snap;
}

describe('shape.model', () => {
  it('TC-01: createShape saves kind/box/label at the drag rect, z = maxZ+1, in one update', () => {
    // Give the board an existing object so maxZ is non-trivial.
    createSticky(doc, { x: 500, y: 500 });
    expect(counter.n).toBe(1);

    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 10, y: 20 } },
      BY,
    );
    expect(id).not.toBeNull();
    expect(counter.n).toBe(2); // exactly one update for the create

    const obj = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(obj.get('type')).toBe('shape');
    expect(obj.get('kind')).toBe('rect');
    expect(obj.get('x')).toBe(10);
    expect(obj.get('y')).toBe(20);
    expect(obj.get('width')).toBe(200);
    expect(obj.get('height')).toBe(120);
    expect(obj.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(obj.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(obj.get('z')).toBe(2); // maxZ(1) + 1
    expect(obj.get('createdBy')).toBe(BY);
    expect(obj.get('label')).toBeInstanceOf(Y.Text);
    expect((obj.get('label') as Y.Text).toString()).toBe('');

    // The snapshot carries the shape fields (the client renders from this).
    const snap = lastSnap();
    expect(snap.type).toBe('shape');
    expect(snap.x).toBe(10);
    expect(snap.y).toBe(20);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(120);
    expect(snap.kind).toBe('rect');
    expect(snap.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap.text).toBe('');
    expect(snap.label).toBe('');

    // getShapeLabel returns the live Y.Text.
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
    expect(getShapeLabel(doc, 'missing')).toBeUndefined();
  });

  it('TC-02: a click or a sub-minimum drag becomes a default square centred on the point', () => {
    const at = { x: 100, y: 100 };
    const cases = [
      // A click: no drag rect at all.
      { rect: null },
      // A drag 19 world units wide: below SHAPE_MIN_SIZE_WORLD.
      { rect: { x: 100, y: 100, width: 19, height: 200 } },
    ];
    for (const { rect } of cases) {
      const id = createShape(doc, { kind: 'ellipse', rect, at }, BY);
      expect(id).not.toBeNull();
      const snap = lastSnap();
      expect(snap.kind).toBe('ellipse');
      expect(snap.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(snap.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    }
  });

  it('TC-03: a drag at exactly the minimum size is kept as drawn', () => {
    const id = createShape(
      doc,
      {
        kind: 'diamond',
        rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 0, y: 0 },
      },
      BY,
    );
    expect(id).not.toBeNull();
    const snap = lastSnap();
    expect(snap.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap.x).toBe(0);
    expect(snap.y).toBe(0);
  });

  it('TC-04: a Shift drag becomes a square of the larger dimension, anchored at the drag origin', () => {
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 30, y: 40, width: 200, height: 120 },
        at: { x: 30, y: 40 },
        square: true,
      },
      BY,
    );
    expect(id).not.toBeNull();
    const snap = lastSnap();
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    // Anchored at the drag origin (the start corner of the drag).
    expect(snap.x).toBe(30);
    expect(snap.y).toBe(40);
  });

  it('TC-05: setShapeStyle changes only the colour fields, in one update each', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } },
      BY,
    )!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'hello');

    const before = objectsSnapshot(doc)[0];

    expect(counter.n).toBe(2); // create + label insert
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(counter.n).toBe(3); // one update
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(counter.n).toBe(4); // one update

    const after = lastSnap();
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // Everything else is untouched.
    expect(after.kind).toBe(before!.kind);
    expect(after.x).toBe(before!.x);
    expect(after.y).toBe(before!.y);
    expect(after.width).toBe(before!.width);
    expect(after.height).toBe(before!.height);
    expect(after.text).toBe('hello');
    expect(getShapeLabel(doc, id)!.toString()).toBe('hello');

    // Unknown colour: no change, no update.
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: 'nope' })).toBe(false);
    expect(counter.n).toBe(4);
  });

  it('TC-06: unknown kind or non-finite rect returns null without a transaction', () => {
    const a = createShape(
      doc,
      { kind: 'triangle' as never, rect: { x: 0, y: 0, width: 10, height: 10 }, at: { x: 0, y: 0 } },
      BY,
    );
    const b = createShape(
      doc,
      { kind: 'rect', rect: { x: NaN, y: 0, width: 10, height: 10 }, at: { x: 0, y: 0 } },
      BY,
    );
    const c = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 10, height: Infinity }, at: { x: 0, y: 0 } },
      BY,
    );
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(c).toBeNull();
    expect(counter.n).toBe(0);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  it('the label accepts SHAPE_LABEL_MAX_CHARS characters (shape.label boundary)', () => {
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 300, height: 200 }, at: { x: 0, y: 0 } },
      BY,
    )!;
    const label = getShapeLabel(doc, id)!;
    label.insert(0, 'x'.repeat(SHAPE_LABEL_MAX_CHARS));
    expect(label.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // Deleting the shape removes it from the snapshot too.
    expect(deleteObject(doc, id)).toBe(true);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });
});
