/**
 * Shape object model (story 10, shape.object): the 'shape' object type is a
 * rectangle, ellipse or diamond with a named fill/outline and a centred
 * label, created by dragging on the board (or a click, which yields the
 * default size at the click point).
 *
 * This module is the single owner of the 'shape' schema and every shape
 * mutation, exactly like board-model is for stickies and text.ts is for
 * text. It registers 'shape' as a known object type on import so
 * shared-level code (unit tests) can create and snapshot shapes without the
 * client-side registry.
 */

import * as Y from 'yjs';
import {
  addKnownObjectType,
  LOCAL_ORIGIN,
  maxZ,
  type ObjectSnapshot,
} from '../board-model';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeKind,
  type ShapeStrokeColor,
} from '../config';
import { type Point, type Rect } from '../geometry';

// The shape model owns the 'shape' type for the document layer (idempotent;
// the client registry registers it again when it loads).
addKnownObjectType('shape');

/** Immutable view of one shape (ObjectSnapshot + shape fields). The label
 *  content is also exposed through the generic `text` field by
 *  snapshotAll, so generic text consumers (e2e hooks) see it too. */
export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  label: string;
}

/** Arguments for createShape. */
export interface CreateShapeArgs {
  kind: ShapeKind;
  /** The dragged rect in world coordinates; null = a click (no drag). */
  rect: Rect | null;
  /** The click point / drag origin in world coordinates. */
  at: Point;
  /** Shift held while dragging: a square from the larger dimension,
   *  anchored at the drag origin. */
  square?: boolean;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePoint(p: unknown): p is Point {
  return (
    typeof p === 'object' &&
    p !== null &&
    finiteNumber((p as Point).x) &&
    finiteNumber((p as Point).y)
  );
}

/** The 'shape' entry for `id`, or undefined for stale ids / other types. */
export function shapeEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id);
  if (entry instanceof Y.Map && entry.get('type') === 'shape') {
    return entry;
  }
  return undefined;
}

function validKind(kind: unknown): kind is ShapeKind {
  return typeof kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(kind);
}

/**
 * The final stored rect for a creation:
 * - a null rect, or a rect below SHAPE_MIN_SIZE_WORLD in either dimension,
 *   yields the default SHAPE_DEFAULT_SIZE_WORLD square centred on `at`
 *   (the click-without-drag case);
 * - `square` (Shift) takes the larger of the two dragged dimensions and
 *   anchors the square at the drag origin.
 */
function shapeRect(args: CreateShapeArgs): Rect {
  const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
  const { rect, at } = args;
  if (
    rect === null ||
    !finiteNumber(rect.x) ||
    !finiteNumber(rect.y) ||
    !finiteNumber(rect.width) ||
    !finiteNumber(rect.height) ||
    rect.width < SHAPE_MIN_SIZE_WORLD ||
    rect.height < SHAPE_MIN_SIZE_WORLD
  ) {
    return {
      x: at.x - half,
      y: at.y - half,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }
  if (args.square === true) {
    const size = Math.max(rect.width, rect.height);
    return { x: at.x, y: at.y, width: size, height: size };
  }
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Creates a shape on top of all other objects. `createdBy` records who
 * created it (a per-tab client id).
 *
 * Returns the new id, or null (no transaction) for an unknown kind or
 * non-finite coordinates.
 */
export function createShape(
  doc: Y.Doc,
  args: CreateShapeArgs,
  createdBy: string,
): string | null {
  if (!validKind(args.kind) || !finitePoint(args.at) || typeof createdBy !== 'string') {
    return null;
  }
  const rect = shapeRect(args);
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'shape');
      entry.set('kind', args.kind);
      entry.set('x', rect.x);
      entry.set('y', rect.y);
      entry.set('width', rect.width);
      entry.set('height', rect.height);
      entry.set('fill', DEFAULT_SHAPE_FILL);
      entry.set('stroke', DEFAULT_SHAPE_STROKE);
      entry.set('label', new Y.Text());
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      entry.set('createdBy', createdBy);
      doc.getMap('objects').set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Sets the shape's named fill and/or outline. Returns false (no
 * transaction) for stale ids, non-shapes, unknown colour names, or when
 * nothing changes. One transaction for the whole call.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const entry = shapeEntry(doc, id);
  if (entry === undefined) {
    return false;
  }
  const changes: [string, string][] = [];
  if (s.fill !== undefined) {
    if (!(typeof s.fill === 'string' && s.fill in SHAPE_FILL_COLORS)) {
      return false;
    }
    if (entry.get('fill') !== s.fill) {
      changes.push(['fill', s.fill]);
    }
  }
  if (s.stroke !== undefined) {
    if (!(typeof s.stroke === 'string' && s.stroke in SHAPE_STROKE_COLORS)) {
      return false;
    }
    if (entry.get('stroke') !== s.stroke) {
      changes.push(['stroke', s.stroke]);
    }
  }
  if (changes.length === 0) {
    return false; // no-op
  }
  doc.transact(
    () => {
      for (const [key, value] of changes) {
        entry.set(key, value);
      }
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The shape's label Y.Text, or undefined for stale/unknown ids. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = shapeEntry(doc, id);
  if (entry === undefined) {
    return undefined;
  }
  const label = entry.get('label');
  return label instanceof Y.Text ? label : undefined;
}
