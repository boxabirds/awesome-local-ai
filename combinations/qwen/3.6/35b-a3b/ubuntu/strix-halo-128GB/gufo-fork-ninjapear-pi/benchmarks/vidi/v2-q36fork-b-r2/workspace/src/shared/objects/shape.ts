import * as Y from 'yjs';
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
} from '../config';
import type { FillColor, StrokeColor } from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

export type ShapeKind = typeof SHAPE_KINDS[number];

export interface ShapeSnap extends Record<string, any> {
  id: string;
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdBy: string;
  createdAt: number;
}

interface ObjectsMap {
  get(key: string): Y.Map<any> | undefined;
  set(key: string, value: Y.Map<any>): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  forEach(callback: (value: Y.Map<any>, key: string) => void): void;
}

function getObjects(doc: Y.Doc): ObjectsMap {
  return doc.getMap('objects') as unknown as ObjectsMap;
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((v) => {
    const z = v.get('z');
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });
  return maxZ;
}

/** Clamp a point to non-negative coordinates */
function clampPositive(p: Point): Point {
  return { x: Math.max(0, p.x), y: Math.max(0, p.y) };
}

/** Check if a rectangle is valid (finite dimensions) */
function isValidRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** Check if point coordinates are finite */
function isFinitePoint(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Create a new shape object.
 * @param doc - Y.Doc
 * @param params - shape parameters
 * @param createdBy - identity id of creating user
 * @returns new shape id or null on error
 */
export function createShape(
  doc: Y.Doc,
  params: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  createdBy: string,
): string | null {
  // Validate kind
  if (!SHAPE_KINDS.includes(params.kind)) {
    return null;
  }

  // Validate point
  if (!isFinitePoint(params.at)) {
    return null;
  }

  // Validate rect if provided
  if (params.rect !== null && params.rect !== undefined) {
    const r = params.rect;
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      return null;
    }
  }

  const kind = params.kind;
  const rect = params.rect;
  const at = clampPositive(params.at);

  // Determine final rect
  let finalX: number;
  let finalY: number;
  let finalWidth: number;
  let finalHeight: number;

  if (rect === null || rect === undefined) {
    // Click → standard size centred at point
    finalX = at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
    finalY = at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
    finalWidth = SHAPE_DEFAULT_SIZE_WORLD;
    finalHeight = SHAPE_DEFAULT_SIZE_WORLD;
  } else {
    // Use provided rect, normalizing direction
    finalX = Math.min(rect.x, rect.x + rect.width);
    finalY = Math.min(rect.y, rect.y + rect.height);
    finalWidth = Math.abs(rect.width);
    finalHeight = Math.abs(rect.height);

    // Check for tiny drag (< min size in either direction → treat as click)
    if (finalWidth < SHAPE_MIN_SIZE_WORLD || finalHeight < SHAPE_MIN_SIZE_WORLD) {
      finalX = at.x - SHAPE_DEFAULT_SIZE_WORLD / 2;
      finalY = at.y - SHAPE_DEFAULT_SIZE_WORLD / 2;
      finalWidth = SHAPE_DEFAULT_SIZE_WORLD;
      finalHeight = SHAPE_DEFAULT_SIZE_WORLD;
    }
  }

  // Constrain proportions with Shift (square)
  if (params.square) {
    const size = Math.max(finalWidth, finalHeight);
    finalWidth = size;
    finalHeight = size;
  }

  // Enforce min/max
  finalWidth = Math.max(SHAPE_MIN_SIZE_WORLD, Math.min(MAX_OBJECT_SIZE_WORLD, finalWidth));
  finalHeight = Math.max(SHAPE_MIN_SIZE_WORLD, Math.min(MAX_OBJECT_SIZE_WORLD, finalHeight));

  // If rect was provided but not tiny and not square, also check min
  if (rect !== null && !params.square) {
    if (finalWidth < SHAPE_MIN_SIZE_WORLD) finalWidth = Math.max(SHAPE_MIN_SIZE_WORLD, rect ? Math.abs(rect.width) : SHAPE_MIN_SIZE_WORLD);
    if (finalHeight < SHAPE_MIN_SIZE_WORLD) finalHeight = Math.max(SHAPE_MIN_SIZE_WORLD, rect ? Math.abs(rect.height) : SHAPE_MIN_SIZE_WORLD);
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const objects = getObjects(doc);
    const shapeMap = new Y.Map();
    shapeMap.set('type', 'shape');
    shapeMap.set('kind', kind);
    shapeMap.set('fill', DEFAULT_SHAPE_FILL);
    shapeMap.set('stroke', DEFAULT_SHAPE_STROKE);
    shapeMap.set('label', new Y.Text());
    shapeMap.set('x', finalX);
    shapeMap.set('y', finalY);
    shapeMap.set('width', finalWidth);
    shapeMap.set('height', finalHeight);
    shapeMap.set('z', z);
    shapeMap.set('createdBy', createdBy);
    shapeMap.set('createdAt', Date.now());
    objects.set(id, shapeMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Set fill/stroke style on a shape. Returns true if changed.
 * Validates against known colour palettes. Stores hex values.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = getObjects(doc);
  const shapeMap = objects.get(id);
  if (!shapeMap) {
    return false;
  }

  // Resolve colour keys to hex values
  let fillHex: string | undefined;
  if (s.fill !== undefined) {
    const resolved = SHAPE_FILL_COLORS[s.fill as keyof typeof SHAPE_FILL_COLORS];
    if (!resolved) {
      return false;
    }
    fillHex = resolved;
  }

  let strokeHex: string | undefined;
  if (s.stroke !== undefined) {
    const resolved = SHAPE_STROKE_COLORS[s.stroke as keyof typeof SHAPE_STROKE_COLORS];
    if (!resolved) {
      return false;
    }
    strokeHex = resolved;
  }

  // Check if anything actually changes
  const currentFill = shapeMap.get('fill');
  const currentStroke = shapeMap.get('stroke');
  if (
    fillHex !== undefined && fillHex === currentFill &&
    strokeHex !== undefined && strokeHex === currentStroke
  ) {
    return false;
  }

  doc.transact(() => {
    if (fillHex !== undefined) {
      shapeMap.set('fill', fillHex);
    }
    if (strokeHex !== undefined) {
      shapeMap.set('stroke', strokeHex);
    }
  }, LOCAL_ORIGIN);

  return true;
}

/** Get the Y.Text label for a shape, or undefined if not found. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const shapeMap = objects.get(id);
  if (!shapeMap) {
    return undefined;
  }
  const textVal = shapeMap.get('label');
  return textVal instanceof Y.Text ? textVal : undefined;
}
