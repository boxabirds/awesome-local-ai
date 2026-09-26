import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { LOCAL_ORIGIN, initDoc, objectSnapshot } from '@/shared/board-model';
import { createShape, readShape, setShapeStyle, getShapeLabel } from '@/shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '@/shared/config';

function trackUpdates(doc: Y.Doc): { count: () => number; lastOrigin: () => unknown; dispose: () => void } {
  let count = 0;
  let lastOrigin: unknown = undefined;
  const cb = (_update: Uint8Array, origin: unknown) => {
    count += 1;
    lastOrigin = origin;
  };
  doc.on('update', cb);
  return {
    count: () => count,
    lastOrigin: () => lastOrigin,
    dispose: () => doc.off('update', cb),
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** createShape that throws on rejection (these tests expect success). */
function mustCreateShape(doc: Y.Doc, a: Parameters<typeof createShape>[1], by: string): string {
  const id = createShape(doc, a, by);
  if (id === null) throw new Error('expected createShape to succeed');
  return id;
}

describe('shape.model (unit, real Y.Doc)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('TC-01: createShape rect 200x120 adds exactly one object with defaults', () => {
    const updates = trackUpdates(doc);
    const id = mustCreateShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: 200, height: 120 }, at: { x: 110, y: 80 } },
      'dana',
    );
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);

    const snap = readShape(doc, id);
    expect(snap).toMatchObject({
      id,
      type: 'shape',
      kind: 'rect',
      x: 10,
      y: 20,
      width: 200,
      height: 120,
      fill: 'white',
      stroke: 'dark',
      label: '',
    });
    // createdBy is persisted on the raw object (per-tab client id).
    const raw = doc.getMap<Y.Map<unknown>>('objects').get(id);
    expect(raw?.get('createdBy')).toBe('dana');
    // The label is a real Y.Text (inline editing, shape.label_limit).
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    // The generic snapshot carries the shape fields.
    const generic = objectSnapshot(doc);
    expect(generic).toHaveLength(1);
    expect(generic[0]).toMatchObject({ kind: 'rect', fill: 'white', stroke: 'dark', label: '' });
  });

  it('TC-02: rect null or below min size becomes the default size centred on the click', () => {
    const at = { x: 300, y: -50 };
    const idClick = mustCreateShape(doc, { kind: 'ellipse', rect: null, at }, 'dina');
    const click = readShape(doc, idClick);
    expect(click).toMatchObject({
      kind: 'ellipse',
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    });

    const idTiny = mustCreateShape(
      doc,
      { kind: 'rect', rect: { x: 10, y: 20, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at },
      'dina',
    );
    const tiny = readShape(doc, idTiny);
    expect(tiny).toMatchObject({
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    });
  });

  it('TC-03: a rect exactly at the min size is kept as drawn', () => {
    const id = mustCreateShape(
      doc,
      { kind: 'rect', rect: { x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 15, y: 16 } },
      'dina',
    );
    const snap = readShape(doc, id);
    expect(snap).toMatchObject({ x: 5, y: 6, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD });
  });

  it('TC-04: square (Shift) sets both sides to the larger dimension', () => {
    const id = mustCreateShape(
      doc,
      { kind: 'diamond', rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 100, y: 60 }, square: true },
      'dina',
    );
    expect(readShape(doc, id)).toMatchObject({ width: 200, height: 200 });
  });

  it('TC-05: setShapeStyle applies known names in one update; unknown names are rejected', () => {
    const id = mustCreateShape(
      doc,
      { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 50, y: 50 } },
      'dina',
    );

    let updates = trackUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(true);
    expect(updates.count()).toBe(1);
    expect(updates.lastOrigin()).toBe(LOCAL_ORIGIN);
    expect(readShape(doc, id)?.fill).toBe('blue');
    updates.dispose();

    updates = trackUpdates(doc);
    expect(setShapeStyle(doc, id, { fill: 'teal' })).toBe(false);
    expect(updates.count()).toBe(0);
    expect(readShape(doc, id)?.fill).toBe('blue');
    expect(setShapeStyle(doc, id, { stroke: 'red' })).toBe(true);
    expect(updates.count()).toBe(1);
    expect(readShape(doc, id)).toMatchObject({ fill: 'blue', stroke: 'red' });
    updates.dispose();
  });

  it('TC-06: unknown kind or non-finite geometry is rejected with no transaction', () => {
    let updates = trackUpdates(doc);
    expect(createShape(doc, { kind: 'triangle' as never, rect: null, at: { x: 0, y: 0 } }, 'dina')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: NaN }, at: { x: 0, y: 0 } }, 'dina')).toBeNull();
    expect(createShape(doc, { kind: 'rect', rect: null, at: { x: Infinity, y: 0 } }, 'dina')).toBeNull();
    expect(updates.count()).toBe(0);
    updates.dispose();
    expect(objectSnapshot(doc)).toHaveLength(0);
  });
});

describe('shape.label (unit, real Y.Doc)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('the label Y.Text round-trips through the generic snapshot and enforces the limit at the editor boundary', () => {
    const id = mustCreateShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, 'dina');
    const label = getShapeLabel(doc, id);
    expect(label).toBeDefined();
    // The editor clamps to SHAPE_LABEL_MAX_CHARS (shape.label_limit); the
    // model stores what the editor writes.
    const clamped = 'a'.repeat(SHAPE_LABEL_MAX_CHARS);
    label!.insert(0, clamped);
    expect(readShape(doc, id)?.label).toBe(clamped);
    expect(objectSnapshot(doc)[0].label).toBe(clamped);
    expect(getShapeLabel(doc, 'missing-id')).toBeUndefined();
  });
});
