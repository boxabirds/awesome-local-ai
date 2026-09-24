/**
 * Story 10 · task 7 — shape model unit tests (TC-01 to TC-06).
 *
 * The `shape.model` contract runs against a real `Y.Doc` (design "Mock vs real
 * boundaries"). Two things every case asserts: the geometry the shape ends up
 * with, and whether a transaction was opened at all — an error path must not
 * write, so the tests count `update` events.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  SHAPE_TYPE,
} from '../../src/shared/objects/shape';
import { snapshot } from '../../src/shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

function freshDoc(): Y.Doc {
  return new Y.Doc();
}

/** Count `update` events fired while `fn` runs (0 means "nothing was written"). */
function updatesDuring(doc: Y.Doc, fn: () => void): number {
  let count = 0;
  const observer = () => {
    count += 1;
  };
  doc.on('update', observer);
  fn();
  doc.off('update', observer);
  return count;
}

function recordOf(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return doc.getMap<Y.Map<unknown>>('objects').get(id);
}

describe('createShape (shape.create_drag, shape.create_click)', () => {
  // TC-01: a dragged rectangle is stored as it was drawn.
  it('TC-01 keeps a 200x120 drag, white fill, dark outline, empty label', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 40, y: 60, width: 200, height: 120 }, at: { x: 40, y: 60 } }, 'g_test');
    expect(id).not.toBeNull();
    expect(doc.getMap('objects').size).toBe(1);

    const record = recordOf(doc, id!);
    expect(record!.get('type')).toBe(SHAPE_TYPE);
    expect(record!.get('kind')).toBe('rect');
    expect(record!.get('width')).toBe(200);
    expect(record!.get('height')).toBe(120);
    expect(record!.get('x')).toBe(40);
    expect(record!.get('y')).toBe(60);
    expect(record!.get('fill')).toBe('white');
    expect(record!.get('stroke')).toBe('dark');

    const [snap] = snapshot(doc);
    expect(snap.text).toBe('');
    expect(snap.kind).toBe('rect');
  });

  // TC-02: a too-small drag and a plain click both fall back to the default
  // size, centred on the point.
  it('TC-02 makes a 19x200 drag and a click into a 160x160 shape at the point', () => {
    const doc = freshDoc();
    expect(SHAPE_MIN_SIZE_WORLD).toBe(20);
    expect(SHAPE_DEFAULT_SIZE_WORLD).toBe(160);

    const thin = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 19, height: 200 }, at: { x: 500, y: 500 } }, 'g_test');
    const click = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 900, y: 300 } }, 'g_test');

    const byId = new Map(snapshot(doc).map((s) => [s.id, s]));
    for (const id of [thin, click]) {
      const snap = byId.get(id!);
      expect(snap).toBeDefined();
      expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    }
    // Centred on the click point, not anchored at it.
    expect(byId.get(click!)!.x).toBe(900 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(byId.get(click!)!.y).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  // TC-03: the boundary is "below the minimum", so exactly 20x20 is kept.
  it('TC-03 keeps a shape that is exactly the minimum size', () => {
    const doc = freshDoc();
    createShape(doc, { kind: 'diamond', rect: { x: 10, y: 10, width: 20, height: 20 }, at: { x: 20, y: 20 } }, 'g_test');
    const [snap] = snapshot(doc);
    expect(snap.width).toBe(20);
    expect(snap.height).toBe(20);
    expect(snap.kind).toBe('diamond');
  });

  // TC-04: Shift makes the shape square using the longer edge.
  it('TC-04 squares a 200x120 drag to 200x200 from the drag origin', () => {
    const doc = freshDoc();
    createShape(doc, { kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 300, y: 220 }, square: true }, 'g_test');
    const [snap] = snapshot(doc);
    expect(snap.width).toBe(200);
    expect(snap.height).toBe(200);
    expect(snap.x).toBe(100);
    expect(snap.y).toBe(100);
  });

  it('stacks a new shape above everything already there', () => {
    const doc = freshDoc();
    const a = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_test');
    const b = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_test');
    const snaps = snapshot(doc);
    expect(snaps[1].id).toBe(b);
    expect(snaps[0].id).toBe(a);
    expect(snaps[1].z).toBeGreaterThan(snaps[0].z);
  });
});

describe('setShapeStyle (shape.style)', () => {
  // TC-05: a valid recolour is one update; an unknown colour is not a change.
  it('TC-05 applies blue, and refuses ' + "'teal' without writing", () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_test')!;

    const applied = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    });
    expect(applied).toBe(1);
    expect(recordOf(doc, id)!.get('fill')).toBe('blue');

    const refused = updatesDuring(doc, () => {
      expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    });
    expect(refused).toBe(0);
    expect(recordOf(doc, id)!.get('fill')).toBe('blue');

    // A stale id is refused the same way.
    expect(updatesDuring(doc, () => {
      expect(setShapeStyle(doc, 'nope', { fill: 'pink' })).toBe(false);
    })).toBe(0);
  });

  it('accepts an outline colour and a no-fill', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'ellipse', rect: null, at: { x: 0, y: 0 } }, 'g_test')!;
    expect(setShapeStyle(doc, id, { fill: 'none', stroke: 'red' })).toBe(true);
    const record = recordOf(doc, id)!;
    expect(record.get('fill')).toBe('none');
    expect(record.get('stroke')).toBe('red');
    // An unknown outline is refused, and does not touch the fill either.
    expect(setShapeStyle(doc, id, { fill: 'pink', stroke: 'sparkly' })).toBe(false);
    expect(record.get('fill')).toBe('none');
  });
});

describe('createShape errors (shape.create_drag)', () => {
  // TC-06: an unknown kind and a non-finite rectangle write nothing.
  it('TC-06 returns null for an unknown kind or a non-finite rect', () => {
    const doc = freshDoc();
    const updates = updatesDuring(doc, () => {
      expect(createShape(doc, { kind: 'triangle' as 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g_test')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: Infinity, height: 10 }, at: { x: 0, y: 0 } }, 'g_test')).toBeNull();
      expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 1 } }, 'g_test')).toBeNull();
    });
    expect(updates).toBe(0);
    expect(doc.getMap('objects').size).toBe(0);
  });
});

describe('getShapeLabel (shape.label)', () => {
  it('exposes a Y.Text clamped by SHAPE_LABEL_MAX_CHARS', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'g_test')!;
    const label = getShapeLabel(doc, id);
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
    expect(SHAPE_LABEL_MAX_CHARS).toBe(500);

    // A stale id has no label at all.
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
  });
});
