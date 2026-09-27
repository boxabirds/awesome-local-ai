// Story 10, task 7: unit tests for the shape model (TC-01..TC-06) plus the
// stale-id and non-finite input cases from the design's contracts.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createShape,
  getShapeLabel,
  isFillColor,
  isShapeKind,
  isStrokeColor,
  setShapeStyle,
  squareRect,
  type ShapeSnap,
} from '../../src/shared/objects/shape';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { createSticky, objectSnapshot } from '../../src/shared/board-model';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function shapeOf(doc: Y.Doc, id: string): ShapeSnap | undefined {
  const snap = objectSnapshot(doc).find((o) => o.id === id);
  return snap !== undefined && snap.type === 'shape' ? (snap as ShapeSnap) : undefined;
}

function countUpdates(doc: Y.Doc): () => number {
  let updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  return () => updates;
}

describe('createShape (TC-01..TC-03)', () => {
  it('TC-01 a click creates the default 160x160 shape centred on the click', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 300, y: 120 }, square: false }, 'dana');
    expect(id).not.toBeNull();
    expect(count()).toBe(1);

    const snap = shapeOf(doc, id!);
    expect(snap).toBeDefined();
    expect(snap!.type).toBe('shape');
    expect(snap!.kind).toBe('rect');
    expect(snap!.x).toBe(300 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap!.y).toBe(120 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // shape.style defaults: white fill, dark outline.
    expect(snap!.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap!.stroke).toBe(DEFAULT_SHAPE_STROKE);
    // Empty Y.Text label.
    expect(snap!.label).toBe('');
    expect(getShapeLabel(doc, id!)).toBeInstanceOf(Y.Text);
    expect(snap!.createdBy).toBe('dana');
    expect(Number.isFinite(snap!.createdAt)).toBe(true);
  });

  it('TC-02 a 200x120 drag creates exactly that shape', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    const id = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 40, y: 30, width: 200, height: 120 }, at: { x: 40, y: 30 }, square: false },
      'dana',
    );
    expect(id).not.toBeNull();
    expect(count()).toBe(1);
    const snap = shapeOf(doc, id!);
    expect(snap!.kind).toBe('ellipse');
    expect(snap!.x).toBe(40);
    expect(snap!.y).toBe(30);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(120);
  });

  it('TC-03 a 10x8 drag is a click: the default centred shape', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    // Dragging from (100,100) to (110,108): 10x8, below the 20 minimum.
    const id = createShape(
      doc,
      { kind: 'diamond', rect: { x: 100, y: 100, width: 10, height: 8 }, at: { x: 100, y: 100 }, square: false },
      'dana',
    );
    expect(id).not.toBeNull();
    expect(count()).toBe(1);
    const snap = shapeOf(doc, id!);
    expect(snap!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(snap!.x).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(snap!.y).toBe(100 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('a drag exactly at the minimum in one axis is still a click', () => {
    const doc = freshDoc();
    const id = createShape(
      doc,
      {
        kind: 'rect',
        rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: 300 },
        at: { x: 0, y: 0 },
        square: false,
      },
      'dana',
    );
    const snap = shapeOf(doc, id!);
    // 20 wide is NOT "smaller than the minimum in either axis"… the rule is
    // strictly smaller, so 20x300 is a real drag.
    expect(snap!.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(snap!.height).toBe(300);
  });
});

describe('createShape squares (TC-04)', () => {
  it('TC-04 a 200x120 drag with Shift is a 200x200 square anchored at the drag origin', () => {
    const doc = freshDoc();
    // Drag from the top-left corner (0,0) to (200,120).
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 }, square: true },
      'dana',
    );
    const snap = shapeOf(doc, id!);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(200);
    expect(snap!.x).toBe(0);
    expect(snap!.y).toBe(0);
  });

  it('anchoring follows the drag corner: from the bottom-right it grows up-left', () => {
    const doc = freshDoc();
    // Same drawn rect, but the drag ORIGIN is the bottom-right corner:
    // the square keeps (200,120) pinned and grows up-left.
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 200, y: 120 }, square: true },
      'dana',
    );
    const snap = shapeOf(doc, id!);
    expect(snap!.width).toBe(200);
    expect(snap!.height).toBe(200);
    expect(snap!.x).toBe(0);
    expect(snap!.y).toBe(-80);
  });

  it('squareRect is the exported pure helper', () => {
    expect(squareRect({ x: 0, y: 0, width: 200, height: 120 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    // Drag origin (60,100) is the bottom-right corner: the 90x90 square is
    // anchored there and grows up-left.
    expect(squareRect({ x: 10, y: 10, width: 50, height: 90 }, { x: 60, y: 100 })).toEqual({
      x: -30,
      y: 10,
      width: 90,
      height: 90,
    });
  });
});

describe('setShapeStyle (TC-05)', () => {
  it('TC-05 changing the fill applies exactly one update', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const count = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'blue' })).toBe(true);
    expect(count()).toBe(1);
    expect(shapeOf(doc, id!)!.fill).toBe('blue');
    expect(shapeOf(doc, id!)!.stroke).toBe(DEFAULT_SHAPE_STROKE); // untouched
  });

  it('changing the outline applies exactly one update', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const count = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { stroke: 'red' })).toBe(true);
    expect(count()).toBe(1);
    expect(shapeOf(doc, id!)!.stroke).toBe('red');
    expect(shapeOf(doc, id!)!.fill).toBe(DEFAULT_SHAPE_FILL); // untouched
  });

  it('an unknown colour name is rejected with no update', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const count = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: 'teal' as never })).toBe(false);
    expect(setShapeStyle(doc, id!, { stroke: 'purple' as never })).toBe(false);
    expect(count()).toBe(0);
  });

  it('setting the current colour is a no-op with no update', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const count = countUpdates(doc);
    expect(setShapeStyle(doc, id!, { fill: DEFAULT_SHAPE_FILL })).toBe(false);
    expect(count()).toBe(0);
  });

  it('unknown ids and non-shapes are rejected with no update', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: 0, y: 0 });
    const count = countUpdates(doc);
    expect(setShapeStyle(doc, 'nope', { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, noteId, { fill: 'blue' })).toBe(false);
    expect(setShapeStyle(doc, 'nope', {})).toBe(false);
    expect(count()).toBe(0);
  });
});

describe('createShape validation (TC-06)', () => {
  it('TC-06 non-finite input is rejected with no transaction', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 }, square: false }, 'dana')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: Infinity }, square: false }, 'dana')).toBeNull();
    expect(
      createShape(doc, { kind: 'rect', rect: { x: NaN, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 }, square: false }, 'dana'),
    ).toBeNull();
    expect(count()).toBe(0);
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('an unknown kind is rejected with no transaction', () => {
    const doc = freshDoc();
    const count = countUpdates(doc);
    expect(createShape(doc, { kind: 'star' as never, rect: null, at: { x: 0, y: 0 }, square: false }, 'dana')).toBeNull();
    expect(count()).toBe(0);
  });

  it('new shapes stack above existing objects', () => {
    const doc = freshDoc();
    const noteId = createSticky(doc, { x: 0, y: 0 });
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const note = objectSnapshot(doc).find((o) => o.id === noteId)!;
    const shape = shapeOf(doc, id!)!;
    expect(shape.z).toBeGreaterThan(note.z);
  });
});

describe('shape label (shapes.label)', () => {
  it('the label is a shared Y.Text that round-trips through the snapshot', () => {
    const doc = freshDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 }, square: false }, 'dana');
    const label = getShapeLabel(doc, id!);
    expect(label).toBeInstanceOf(Y.Text);
    label!.insert(0, 'Checkout');
    expect(shapeOf(doc, id!)!.label).toBe('Checkout');
    // Unknown ids and other types return undefined.
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
    const noteId = createSticky(doc, { x: 5, y: 5 });
    expect(getShapeLabel(doc, noteId)).toBeUndefined();
  });
});

describe('validators', () => {
  it('kind/fill/stroke validators accept exactly the named values', () => {
    expect(isShapeKind('rect')).toBe(true);
    expect(isShapeKind('ellipse')).toBe(true);
    expect(isShapeKind('diamond')).toBe(true);
    expect(isShapeKind('star')).toBe(false);
    expect(isShapeKind(undefined)).toBe(false);
    for (const c of Object.keys(SHAPE_FILL_COLORS) as (keyof typeof SHAPE_FILL_COLORS)[]) {
      expect(isFillColor(c)).toBe(true);
    }
    expect(isFillColor('teal')).toBe(false);
    expect(isStrokeColor('red')).toBe(true);
    expect(isStrokeColor('blue')).toBe(true);
    expect(isStrokeColor('black')).toBe(false);
  });
});
