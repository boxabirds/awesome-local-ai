/**
 * Story 10 unit tests (TC-01 to TC-06): the shape model (shape.model)
 * against a real Y.Doc.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createSticky,
  initDoc,
  LOCAL_ORIGIN,
  registerKnownObjectType,
  snapshot,
} from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
} from '../../src/shared/objects/shape';

registerKnownObjectType('shape'); // as the client registry does at load

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function item(doc: Y.Doc, id: string): Y.Map<any> {
  return doc.getMap('objects').get(id) as Y.Map<any>;
}

function itemCount(doc: Y.Doc): number {
  return doc.getMap('objects').size;
}

describe('shape.model', () => {
  it('TC-01: createShape rect 200x120 → 1 object at the dragged rect, default style, empty label, z = maxZ+1', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 }); // z = 1
    let updates = 0;
    doc.on('update', () => updates++);

    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 120 }, at: { x: 100, y: 50 } },
      'dana',
    );

    expect(id).toBeTruthy();
    expect(itemCount(doc)).toBe(2); // 0 → 1 shape (plus the sticky)
    expect(updates).toBe(1); // one LOCAL_ORIGIN transaction
    const o = item(doc, id!);
    expect(o.get('type')).toBe('shape');
    expect(o.get('x')).toBe(100);
    expect(o.get('y')).toBe(50);
    expect(o.get('width')).toBe(200);
    expect(o.get('height')).toBe(120);
    expect(o.get('kind')).toBe('rect');
    expect(o.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(o.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    const label = o.get('label');
    expect(label instanceof Y.Text).toBe(true);
    expect(label.toString()).toBe('');
    expect(o.get('z')).toBe(2); // maxZ + 1
    expect(o.get('createdBy')).toBe('dana');
    expect(typeof o.get('createdAt')).toBe('number');
    const snap = snapshot(doc).find((s) => s.id === id)!;
    expect(snap).toMatchObject({ type: 'shape', kind: 'rect', fill: 'white', stroke: 'dark', label: '' });
  });

  it('TC-02: rect 19x200 (below the min) and rect null → default 160x160 centred at `at`', () => {
    const doc = newDoc();
    const at = { x: 111, y: 77 };

    let updates = 0;
    doc.on('update', () => updates++);
    const tiny = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 100, y: 100, width: 19, height: 200 }, at },
      'dana',
    );
    expect(tiny).toBeTruthy();
    const tinyItem = item(doc, tiny!);
    expect(tinyItem.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(tinyItem.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(tinyItem.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(tinyItem.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(updates).toBe(1);

    updates = 0;
    const click = createShape(doc, { kind: 'diamond', rect: null, at }, 'dana');
    expect(click).toBeTruthy();
    const clickItem = item(doc, click!);
    expect(clickItem.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickItem.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickItem.get('x')).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(clickItem.get('y')).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(updates).toBe(1);
  });

  it('TC-03: a rect exactly SHAPE_MIN_SIZE_WORLD square is kept as drawn (boundary)', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD },
        at: { x: 0, y: 0 },
      },
      'dana',
    );
    expect(id).toBeTruthy();
    const o = item(doc, id!);
    expect(o.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(o.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
  });

  it('TC-04: square: true on a 200x120 drag → 200x200 anchored at the drag origin', () => {
    const doc = newDoc();
    const origin = { x: 100, y: 100 };
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: origin,
        square: true,
      },
      'dana',
    );
    expect(id).toBeTruthy();
    const o = item(doc, id!);
    expect(o.get('width')).toBe(200);
    expect(o.get('height')).toBe(200);
    // anchored at the drag origin (the top-left corner of this drag)
    expect(o.get('x')).toBe(origin.x);
    expect(o.get('y')).toBe(origin.y);
  });

  it('TC-05: setShapeStyle fill "blue" applies (1 update, label/size unchanged); "teal" → false, 0 updates', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: null, at: { x: 0, y: 0 } },
      'dana',
    )!;
    const label = getShapeLabel(doc, id)!;
    doc.transact(() => label.insert(0, 'Keep me'), LOCAL_ORIGIN);
    const before = item(doc, id);
    const beforeX = before.get('x');
    const beforeW = before.get('width');

    let updates = 0;
    doc.on('update', () => updates++);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(item(doc, id).get('fill')).toBe('blue');
    expect(updates).toBe(1);
    // label, size and position are untouched
    expect(getShapeLabel(doc, id)!.toString()).toBe('Keep me');
    expect(item(doc, id).get('x')).toBe(beforeX);
    expect(item(doc, id).get('width')).toBe(beforeW);

    updates = 0;
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false); // unknown colour
    expect(updates).toBe(0);
    expect(item(doc, id).get('fill')).toBe('blue');
    expect(setShapeStyle(doc, 'stale', { stroke: 'red' })).toBe(false);
    expect(updates).toBe(0);
  });

  it('TC-06: unknown kind and non-finite rect → null, 0 updates (error path)', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(
      createShape(doc, { kind: 'triangle' as never, rect: null, at: { x: 0, y: 0 } }, 'dana'),
    ).toBeNull();
    expect(
      createShape(
        doc,
        { kind: 'rect', rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
        'dana',
      ),
    ).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Number.POSITIVE_INFINITY } }, 'dana'),
    ).toBeNull();
    expect(updates).toBe(0);
    expect(itemCount(doc)).toBe(0);
  });

  it('the label is a Y.Text capped at SHAPE_LABEL_MAX_CHARS by the editor helper', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'dana')!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    doc.transact(() => label!.insert(0, 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 10)), LOCAL_ORIGIN);
    expect(label!.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS + 10); // the model stores; the editor clamps
    expect(getShapeLabel(doc, 'stale')).toBeUndefined();
  });
});
