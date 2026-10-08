import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';
import { createShape, setShapeStyle, getShapeLabel, clampToShapeLabel } from '@shared/objects/shape';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_LABEL_MAX_CHARS,
} from '@shared/config';
import type { Rect } from '@shared/geometry';

// ─── Helpers ──────────────────────────────────────────────────────────────

function trackUpdates(doc: Y.Doc) {
  let count = 0;
  const unsub = (doc.on('update', () => {
    count++;
  })) as unknown as () => void;
  return {
    get count() {
      return count;
    },
    cleanup() {
      unsub();
    },
  };
}

function makeDoc() {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('schemaVersion', 1);
  });
  return doc;
}

// ─── TC-01: createShape drag creates shape with correct dimensions ───────

describe('TC-01: createShape by drag', () => {
  it('rect 200×120 → width 200, height 120, fill white stroke dark, empty label, z=max+1', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const rect: Rect = { x: 0, y: 0, width: 200, height: 120 };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'test-user');

    expect(id).toBeTruthy();

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('type')).toBe('shape');
    expect(dm.get('kind')).toBe('rect');
    expect(dm.get('x')).toBe(0);
    expect(dm.get('y')).toBe(0);
    expect(dm.get('width')).toBe(200);
    expect(dm.get('height')).toBe(120);
    expect(dm.get('fill')).toBe(DEFAULT_SHAPE_FILL);
    expect(dm.get('stroke')).toBe(DEFAULT_SHAPE_STROKE);
    expect(dm.get('label') instanceof Y.Text).toBe(true);
    expect(dm.get('label').toString()).toBe('');
    expect(dm.get('z')).toBe(1); // first object in fresh doc
    expect(dm.get('createdBy')).toBe('test-user');

    expect(tracker.count).toBe(1);
    tracker.cleanup();
  });

  it('creates shape from negative-width rect (swapped coordinates)', () => {
    const doc = makeDoc();
    const rect: Rect = { x: 200, y: 100, width: -200, height: -80 };
    const id = createShape(doc, { kind: 'ellipse', rect, at: { x: 0, y: 0 } }, 'u');

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('x')).toBeCloseTo(0, 6); // min(200, 0) = 0
    expect(dm.get('y')).toBeCloseTo(20, 6); // min(100, 20) — wait no: min(100, 20)
    expect(dm.get('x')).toBe(0);
    expect(dm.get('y')).toBe(20);
    expect(dm.get('width')).toBe(200);
    expect(dm.get('height')).toBe(80);
  });
});

// ─── TC-02: createShape click (null rect) and tiny drag ──────────────────

describe('TC-02: createShape click and tiny drag', () => {
  it('rect null → default size centred at point', () => {
    const doc = makeDoc();
    const at = { x: 400, y: 300 };
    const id = createShape(doc, { kind: 'diamond', rect: null, at }, 'u');

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('x')).toBeCloseTo(400 - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(dm.get('y')).toBeCloseTo(300 - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(dm.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(dm.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('tiny rect 19×19 below min in both dims → default size centred', () => {
    const doc = makeDoc();
    const rect: Rect = { x: 100, y: 200, width: 19, height: 19 };
    const at = { x: 109.5, y: 209.5 };
    const id = createShape(doc, { kind: 'rect', rect, at }, 'u');

    const dm = doc.getMap('objects').get(id!) as any;
    // Both dims < min so treated as click
    expect(dm.get('width')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(dm.get('height')).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(dm.get('x')).toBeCloseTo(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(dm.get('y')).toBeCloseTo(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
  });
});

// ─── TC-03: boundary — exactly SHAPE_MIN_SIZE_WORLD kept ─────────────────

describe('TC-03: shape at minimum size', () => {
  it('exactly 20×20 is kept as drawn (boundary)', () => {
    const doc = makeDoc();
    const rect: Rect = { x: 0, y: 0, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'u');

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('width')).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(dm.get('height')).toBe(SHAPE_MIN_SIZE_WORLD);
  });
});

// ─── TC-04: square mode ──────────────────────────────────────────────────

describe('TC-04: createShape with square flag', () => {
  it('square: true on 200×120 → 200×200 anchored at origin', () => {
    const doc = makeDoc();
    const rect: Rect = { x: 50, y: 50, width: 200, height: 120 };
    const id = createShape(doc, { kind: 'ellipse', rect, at: { x: 0, y: 0 }, square: true }, 'u');

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('x')).toBe(50);
    expect(dm.get('y')).toBe(50);
    expect(dm.get('width')).toBe(200); // larger of 200 and 120
    expect(dm.get('height')).toBe(200);
  });
});

// ─── TC-05: setShapeStyle validation ─────────────────────────────────────

describe('TC-05: setShapeStyle', () => {
  it('valid blue fill applied, 1 update; label/size unchanged', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'u');
    const dm = doc.getMap('objects').get(id!) as any;
    const beforeZ = dm.get('z');

    const tracker = trackUpdates(doc);
    const result = setShapeStyle(doc, id!, { fill: 'blue' });
    expect(result).toBe(true);
    expect(tracker.count).toBe(1);
    tracker.cleanup();

    expect(dm.get('fill')).toBe('blue');
    expect(dm.get('stroke')).toBe(DEFAULT_SHAPE_STROKE); // unchanged
    expect(dm.get('z')).toBe(beforeZ); // unchanged
  });

  it('unknown colour returns false, 0 updates', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'u');
    const tracker = trackUpdates(doc);

    const result = setShapeStyle(doc, id!, { fill: 'teal' });
    expect(result).toBe(false);
    expect(tracker.count).toBe(0);
    tracker.cleanup();

    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('fill')).toBe(DEFAULT_SHAPE_FILL);
  });

  it('valid stroke color applies correctly', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'u');

    setShapeStyle(doc, id!, { stroke: 'red' });
    const dm = doc.getMap('objects').get(id!) as any;
    expect(dm.get('stroke')).toBe('red');
  });
});

// ─── TC-06: error path — invalid inputs ───────────────────────────────────

describe('TC-06: invalid shape creation', () => {
  it('invalid kind "triangle" → null, 0 updates', () => {
    const doc = makeDoc();
    const tracker = trackUpdates(doc);
    const id = createShape(doc, { kind: 'triangle' as any, rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'u');

    expect(id).toBeNull();
    expect(tracker.count).toBe(0);
    tracker.cleanup();
  });

  it('non-finite rect → null', () => {
    const doc = makeDoc();
    const rect = { x: Infinity, y: 0, width: 100, height: 80 };
    const id = createShape(doc, { kind: 'rect', rect, at: { x: 0, y: 0 } }, 'u');
    expect(id).toBeNull();
  });

  it('non-finite at → null for click', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: null, at: { x: NaN, y: 0 } }, 'u');
    expect(id).toBeNull();
  });

  it('setShapeStyle stale id → false', () => {
    const doc = makeDoc();
    const result = setShapeStyle(doc, 'nonexistent-id', { fill: 'blue' });
    expect(result).toBe(false);
  });
});

// ─── clampToShapeLabel ───────────────────────────────────────────────────

describe('clampToShapeLabel', () => {
  it('text within limit returned unchanged', () => {
    const short = 'hello'.repeat(50); // 250 chars
    expect(clampToShapeLabel(short)).toBe(short);
    expect(short.length).toBe(250);
  });

  it('text over limit truncated to 500 chars', () => {
    const long = 'a'.repeat(600);
    expect(clampToShapeLabel(long)).toBe('a'.repeat(SHAPE_LABEL_MAX_CHARS));
    expect(clampToShapeLabel(long).length).toBe(SHAPE_LABEL_MAX_CHARS);
  });
});

// ─── getShapeLabel ────────────────────────────────────────────────────────

describe('getShapeLabel', () => {
  it('returns Y.Text for valid shape id', () => {
    const doc = makeDoc();
    const id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } }, 'u');
    const label = getShapeLabel(doc, id!);
    expect(label).toBeDefined();
    expect(label).toBeInstanceOf(Y.Text);
    expect(label!.toString()).toBe('');
  });

  it('returns undefined for non-shape id', () => {
    const doc = makeDoc();
    // Create a sticky-like entry
    doc.getMap('objects').set('other-id', new Y.Map());
    const dm = doc.getMap('objects').get('other-id') as any;
    dm.set('type', 'sticky');
    expect(getShapeLabel(doc, 'other-id')).toBeUndefined();
  });

  it('returns undefined for unknown id', () => {
    const doc = makeDoc();
    expect(getShapeLabel(doc, 'nope')).toBeUndefined();
  });
});
