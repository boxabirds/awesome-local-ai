import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '@/shared/config';
import { LOCAL_ORIGIN, ensureMeta, type ObjectSnapshot } from '@/shared/board-model';
import { registerKnownObjectType } from '@/shared/known-object-types';
import type { Point, Rect } from '@/shared/geometry';

// The shape model marks its type known (sel.all_types). The call is safe at
// module scope: known-object-types.ts is dependency-free (see its header).
registerKnownObjectType('shape');

/** The shape kinds this build draws (story 10; more arrive in 12/14/15). */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Fill swatch names (key of SHAPE_FILL_COLORS); 'none' = transparent. */
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

/** Outline swatch names (key of SHAPE_STROKE_COLORS). */
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** A shape object snapshot (type guard: isShapeSnap). */
export interface ShapeSnap extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  /** Fill colour NAME (resolved against SHAPE_FILL_COLORS when reading). */
  fill: FillColor;
  /** Outline colour NAME (resolved against SHAPE_STROKE_COLORS when reading). */
  stroke: StrokeColor;
  label: string;
  width: number;
  height: number;
}

export function isShapeSnap(o: ObjectSnapshot): o is ShapeSnap {
  return o.type === 'shape';
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function shapeObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objects(doc).get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Creates a shape object and returns its id (shape.create_click,
 * shape.create_drag, shape.constrain, shape.style).
 *
 * Size resolution: `rect` null (a click), or below SHAPE_MIN_SIZE_WORLD in
 * either dimension (a tiny drag), becomes the default SHAPE_DEFAULT_SIZE_WORLD
 * square centred on `at`. With `square` (Shift held) both sides take the
 * larger dimension, anchored at the drag origin.
 *
 * Rejects (returns null, no transaction): unknown kind, non-finite
 * coordinates. Exactly one LOCAL_ORIGIN transaction on success.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!(SHAPE_KINDS as readonly string[]).includes(a.kind)) return null;
  if (!isFinitePoint(a.at)) return null;
  if (a.rect !== null && !isFiniteRect(a.rect)) return null;

  let x: number;
  let y: number;
  let width: number;
  let height: number;
  const r = a.rect;
  if (r === null || r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    // A click (or a drag too small to be a drag): default size, centred on the click.
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - s / 2;
    y = a.at.y - s / 2;
    width = s;
    height = s;
  } else {
    // Normalize a possibly inverted drag rect to top-left + positive size.
    x = Math.min(r.x, r.x + r.width);
    y = Math.min(r.y, r.y + r.height);
    width = Math.abs(r.width);
    height = Math.abs(r.height);
    if (a.square) {
      // Shift (shape.constrain): both sides take the larger dimension;
      // the rect keeps its normalized top-left corner.
      const s = Math.max(width, height);
      width = s;
      height = s;
    }
  }

  const id = crypto.randomUUID();
  const label = new Y.Text();
  doc.transact(() => {
    ensureMeta(doc);
    const all = objects(doc);
    const obj = new Y.Map();
    obj.set('type', 'shape');
    obj.set('kind', a.kind);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('fill', DEFAULT_SHAPE_FILL);
    obj.set('stroke', DEFAULT_SHAPE_STROKE);
    obj.set('label', label);
    obj.set('z', maxZ(all) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    all.set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Reads a shape object as a typed snapshot. Returns undefined when the id is
 * stale, is not a shape, or is malformed. `fill`/`stroke` are resolved to
 * swatch names (unknown stored names fall back to the defaults, so a
 * future/removed swatch never crashes the toolbar).
 */
export function readShape(doc: Y.Doc, id: string): ShapeSnap | undefined {
  const obj = shapeObj(doc, id);
  if (!obj) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const width = obj.get('width');
  const height = obj.get('height');
  const kind = obj.get('kind');
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (kind !== 'rect' && kind !== 'ellipse' && kind !== 'diamond') return undefined;
  const z = obj.get('z');
  const createdAt = obj.get('createdAt');
  const fill = obj.get('fill');
  const stroke = obj.get('stroke');
  const labelY = obj.get('label');
  return {
    id,
    type: 'shape',
    kind,
    x,
    y,
    width,
    height,
    fill: typeof fill === 'string' && fill in SHAPE_FILL_COLORS ? (fill as FillColor) : DEFAULT_SHAPE_FILL,
    stroke:
      typeof stroke === 'string' && stroke in SHAPE_STROKE_COLORS ? (stroke as StrokeColor) : DEFAULT_SHAPE_STROKE,
    z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    label: labelY instanceof Y.Text ? labelY.toString() : '',
  };
}

/**
 * Sets the shape's fill and/or outline colour NAMES (shape.style). Both are
 * optional; at least one must be a known swatch name. Returns false without
 * a transaction when the id is stale, both are absent, or a name is unknown.
 */
export function setShapeStyle(doc: Y.Doc, id: string, s: { fill?: string; stroke?: string }): boolean {
  const hasFill = s.fill !== undefined;
  const hasStroke = s.stroke !== undefined;
  if (!hasFill && !hasStroke) return false;
  if (hasFill && !(typeof s.fill === 'string' && s.fill in SHAPE_FILL_COLORS)) return false;
  if (hasStroke && !(typeof s.stroke === 'string' && s.stroke in SHAPE_STROKE_COLORS)) return false;
  const obj = shapeObj(doc, id);
  if (!obj) return false;
  doc.transact(() => {
    if (hasFill) obj.set('fill', s.fill);
    if (hasStroke) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The shape's label Y.Text (for the inline editor, shape.label_limit).
 * Returns undefined for a stale/non-shape id.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = shapeObj(doc, id);
  if (!obj) return undefined;
  const label = obj.get('label');
  return label instanceof Y.Text ? label : undefined;
}
