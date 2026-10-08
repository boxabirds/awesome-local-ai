import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
} from '../config';
import type { ShapeFillColor, ShapeStrokeColor } from '../config';
import type { Point } from '../../client/canvas/camera';
import type { Rect } from '../geometry';

/** A shape kind. */
export type ShapeKind = typeof SHAPE_KINDS[number];

/** Snapshot of a shape for rendering. */
export interface ShapeSnap {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  label: string;
  z: number;
  createdAt: number;
  createdBy?: string;
}

// ─── Internal helpers ────────────────────────────────────────────────

/** Get the objects map from doc (mirrors board-model getDocObjects). */
function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

function getDataMap(objs: any, id: string): any {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}

/** Validate that a shape kind is known. */
function isValidKind(kind: string): kind is ShapeKind {
  return SHAPE_KINDS.includes(kind as ShapeKind);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create a shape on a real Y.Doc.
 *
 * @param rect - World-space rectangle, or null to centre at `at` with default size.
 * @param at   - Center point used when rect is null (click) or tiny drag.
 * @param square - If true, constrain the shape to a square using the larger dimension.
 * @returns The new object id, or null on invalid input (no transaction written).
 */
export function createShape(
  doc: Y.Doc,
  a: {
    kind: ShapeKind;
    rect: Rect | null;
    at: Point;
    square?: boolean;
  },
  by: string,
): string | null {
  // Validate kind first
  if (!isValidKind(a.kind)) {
    return null;
  }

  // Check finiteness of click point (used when rect is null)
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) {
    return null;
  }

  // Determine final rect
  let finalRect: Rect;

  if (a.rect) {
    // Check finiteness
    if (
      !Number.isFinite(a.rect.x) ||
      !Number.isFinite(a.rect.y) ||
      !Number.isFinite(a.rect.width) ||
      !Number.isFinite(a.rect.height)
    ) {
      return null;
    }

    const w = Math.abs(a.rect.width);
    const h = Math.abs(a.rect.height);

    // Square mode: use larger dimension for both
    if (a.square) {
      const side = Math.max(w, h);
      finalRect = {
        x: a.rect.x,
        y: a.rect.y,
        width: side,
        height: side,
      };
    } else {
      finalRect = {
        x: Math.min(a.rect.x, a.rect.x + a.rect.width),
        y: Math.min(a.rect.y, a.rect.y + a.rect.height),
        width: w,
        height: h,
      };
    }
  } else {
    // Click / tiny drag → default size centred at point
    finalRect = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }

  // Tiny drag: if either dimension < min, treat as click
  if (finalRect.width < SHAPE_MIN_SIZE_WORLD && finalRect.height < SHAPE_MIN_SIZE_WORLD) {
    finalRect = {
      x: a.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: a.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    };
  }

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'shape');
  dataMap.set('kind', a.kind);
  dataMap.set('x', finalRect.x);
  dataMap.set('y', finalRect.y);
  dataMap.set('width', finalRect.width);
  dataMap.set('height', finalRect.height);
  dataMap.set('fill', DEFAULT_SHAPE_FILL);
  dataMap.set('stroke', DEFAULT_SHAPE_STROKE);
  dataMap.set('label', new Y.Text());
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());
  dataMap.set('createdBy', by);

  doc.transact(() => {
    objects.set(id, dataMap);
  });

  return id;
}

/**
 * Change a shape's fill or stroke colour.
 *
 * @returns true on success, false if stale id or unknown colour key.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;

  // Validate colours before writing
  if (s.fill !== undefined) {
    if (!(s.fill in SHAPE_FILL_COLORS)) {
      return false;
    }
  }
  if (s.stroke !== undefined) {
    if (!(s.stroke in SHAPE_STROKE_COLORS)) {
      return false;
    }
  }

  doc.transact(() => {
    if (s.fill !== undefined) {
      dm.set('fill', s.fill);
    }
    if (s.stroke !== undefined) {
      dm.set('stroke', s.stroke);
    }
  });

  return true;
}

/**
 * Get the Y.Text label for a shape.
 *
 * @returns the Y.Text instance, or undefined if the id doesn't exist or isn't a shape.
 */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return undefined;
  const type = String(dm.get('type') ?? '');
  if (type !== 'shape') return undefined;
  const val = dm.get('label');
  return val instanceof Y.Text ? val : undefined;
}

/** Clamp text content to SHAPE_LABEL_MAX_CHARS. */
export function clampToShapeLabel(text: string): string {
  if (text.length <= SHAPE_LABEL_MAX_CHARS) return text;
  return text.slice(0, SHAPE_LABEL_MAX_CHARS);
}
