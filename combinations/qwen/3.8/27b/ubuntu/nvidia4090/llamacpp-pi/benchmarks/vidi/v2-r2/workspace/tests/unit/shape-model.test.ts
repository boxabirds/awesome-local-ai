/**
 * Story 10, shape model unit tests (design shape.*, TC-01 to TC-06).
 *
 * The 'shape' object type: rect / ellipse / diamond with a named
 * fill/outline and a centred label. Created from a drag rect (or a click,
 * which yields the default size at the click point); Shift squares the
 * drag; tiny drags fall back to the default size; labels clamp to
 * SHAPE_LABEL_MAX_CHARS through the shared editor pipeline.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { snapshotAll } from '../../src/shared/board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import { applyTextDiff, clampToLimit } from '../../src/client/objects/StickyText';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeEntry,
} from '../../src/shared/objects/shape';

const CREATOR = 'g_test';

function newDoc(): Y.Doc {
  return new Y.Doc();
}

function countUpdates(doc: Y.Doc): { updates: number; off: () => void } {
  let updates = 0;
  const handler = (): void => {
    updates += 1;
  };
  doc.on('update', handler);
  return {
    get updates() {
      return updates;
    },
    off: () => doc.off('update', handler),
  };
}

describe('shape model (design shape.*)', () => {
  it('TC-01: dragging 200x120 from (100,200) creates a 200x120 shape at that world position', () => {
    const doc = newDoc();
    const id = createShape(
      doc,
      { kind: 'rect', rect: { x: 100, y: 200, width: 200, height: 120 }, at: { x: 100, y: 200 } },
      CREATOR,
    );
    expect(id).not.toBeNull();
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(entry.get('type')).toBe('shape');
    expect(entry.get('kind')).toBe('rect');
    expect(entry.get('x')).toBe(100);
    expect(entry.get('y')).toBe(200);
    expect(entry.get('width')).toBe(200);
    expect(entry.get('height')).toBe(120);
    expect(entry.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(entry.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(entry.get('z')).toBe(1);
    expect(entry.get('createdBy')).toBe(CREATOR);
    // The snapshot exposes the shape fields (and the empty label as text).
    const snap = snapshotAll(doc).find((o) => o.id === id);
    expect(snap).toBeDefined();
    expect(snap?.kind).toBe('rect');
    expect(snap?.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(snap?.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(snap?.label).toBe('');
  });

  it('TC-02: a click, or a drag below the 20-unit minimum in either dimension, creates the default 160x160 shape centred on the click point', () => {
    const doc = newDoc();
    // A plain click (no drag).
    const id1 = createShape(doc, { kind: 'rect', rect: null, at: { x: 50, y: 60 } }, CREATOR);
    expect(id1).not.toBeNull();
    let entry = doc.getMap('objects').get(id1!) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('x')).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(entry.get('y')).toBe(60 - SHAPE_DEFAULT_SIZE_WORLD / 2);

    // A drag 19 wide x 200 tall: below the minimum in one dimension.
    const id2 = createShape(
      doc,
      { kind: 'ellipse', rect: { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD - 1, height: 200 }, at: { x: 10, y: 10 } },
      CREATOR,
    );
    expect(id2).not.toBeNull();
    entry = doc.getMap('objects').get(id2!) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(entry.get('x')).toBe(10 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(entry.get('y')).toBe(10 - SHAPE_DEFAULT_SIZE_WORLD / 2);
  });

  it('TC-03: kind must be one of rect|ellipse|diamond; an unknown kind creates nothing (0 updates)', () => {
    const doc = newDoc();
    const updates = countUpdates(doc);
    const id = (createShape as (d: Y.Doc, a: unknown, by: string) => string | null)(
      doc,
      { kind: 'triangle', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } },
      CREATOR,
    );
    expect(id).toBeNull();
    expect(updates.updates).toBe(0);
    // And every valid kind is accepted.
    for (const kind of SHAPE_KINDS) {
      const ok = createShape(doc, { kind, rect: null, at: { x: 0, y: 0 } }, CREATOR);
      expect(ok).not.toBeNull();
    }
    expect(doc.getMap('objects').size).toBe(SHAPE_KINDS.length);
    updates.off();
  });

  it('TC-04: Shift (square) makes the shape square from the larger dimension, anchored at the drag origin', () => {
    const doc = newDoc();
    const at = { x: 100, y: 200 };
    const id = createShape(
      doc,
      {
        kind: 'diamond',
        rect: { x: 100, y: 200, width: 200, height: 120 },
        at,
        square: true,
      },
      CREATOR,
    );
    expect(id).not.toBeNull();
    const entry = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(200);
    expect(entry.get('height')).toBe(200);
    expect(entry.get('x')).toBe(at.x);
    expect(entry.get('y')).toBe(at.y);
  });

  it('TC-05: setShapeStyle with a known colour updates the entry in one transaction; unknown colours are rejected with no transaction', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, CREATOR)!;
    const updates = countUpdates(doc);

    expect(setShapeStyle(doc, id, { fill: 'magenta' })).toBe(false); // unknown fill
    expect(updates.updates).toBe(0);
    expect(setShapeStyle(doc, id, { stroke: 'gold' })).toBe(false); // unknown outline
    expect(updates.updates).toBe(0);
    expect(setShapeStyle(doc, 'missing', { fill: 'blue' })).toBe(false); // stale id
    expect(updates.updates).toBe(0);

    expect(setShapeStyle(doc, id, { fill: 'blue', stroke: 'red' })).toBe(true);
    expect(updates.updates).toBe(1); // one transaction for the whole call
    const entry = shapeEntry(doc, id)!;
    expect(entry.get('fill')).toBe('blue');
    expect(entry.get('stroke')).toBe('red');

    // No change → no-op, no transaction.
    expect(setShapeStyle(doc, id, { fill: 'blue' })).toBe(false);
    expect(updates.updates).toBe(1);
    // Every palette name is accepted.
    for (const name of Object.keys(SHAPE_FILL_COLORS)) {
      expect(setShapeStyle(doc, id, { fill: name })).toBe(true);
    }
    for (const name of Object.keys(SHAPE_STROKE_COLORS)) {
      expect(setShapeStyle(doc, id, { stroke: name })).toBe(true);
    }
    updates.off();
  });

  it('TC-06: typing more than 500 characters stores exactly 500 (the editor pipeline clamps the label)', () => {
    const doc = newDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: 0, y: 0 } }, CREATOR)!;
    const label = getShapeLabel(doc, id)!;
    const long = 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 100);

    // The shape label editor commits through the same shared pipeline as
    // stickies: clamp to the limit, then the minimal Y.Text diff.
    const kept = clampToLimit(long, SHAPE_LABEL_MAX_CHARS);
    expect(kept.length).toBe(SHAPE_LABEL_MAX_CHARS);
    doc.transact(() => applyTextDiff(label, kept, LOCAL_ORIGIN), LOCAL_ORIGIN);
    expect(label.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(label.toString()).toBe('a'.repeat(SHAPE_LABEL_MAX_CHARS));
    // The snapshot exposes the clamped label (as label and generic text).
    const snap = snapshotAll(doc).find((o) => o.id === id);
    expect(snap?.label).toBe(label.toString());
    expect(snap?.text).toBe(label.toString());
  });
});
