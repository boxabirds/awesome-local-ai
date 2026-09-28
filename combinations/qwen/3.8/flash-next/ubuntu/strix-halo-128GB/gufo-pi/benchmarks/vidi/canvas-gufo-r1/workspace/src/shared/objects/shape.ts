import * as Y from 'yjs';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
  type FillColor,
  type StrokeColor,
} from '../config';
import type { Rect, Point } from '../geometry';
import { LOCAL_ORIGIN } from '../board-model';

export interface ShapeSnapshot {
  id: string;
  type: 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  text: string;
}

const KIND_SET: Set<string> = new Set<string>(SHAPE_KINDS);
const FILL_KEYS: Set<string> = new Set(Object.keys(SHAPE_FILL_COLORS));
const STROKE_KEYS: Set<string> = new Set(Object.keys(SHAPE_STROKE_COLORS));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isValidFinite(n: number): boolean {
  return Number.isFinite(n);
}

export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  // Validate kind
  if (!KIND_SET.has(a.kind)) return null;
  // Validate point finiteness
  if (!isValidFinite(a.at.x) || !isValidFinite(a.at.y)) return null;
  // Validate rect finiteness if provided
  if (a.rect !== null) {
    if (!isValidFinite(a.rect.x) || !isValidFinite(a.rect.y) ||
        !isValidFinite(a.rect.width) || !isValidFinite(a.rect.height)) return null;
  }

  let x: number, y: number, width: number, height: number;

  if (a.rect === null) {
    // Click: default size centred on point
    width = SHAPE_DEFAULT_SIZE_WORLD;
    height = SHAPE_DEFAULT_SIZE_WORLD;
    x = a.at.x - width / 2;
    y = a.at.y - height / 2;
  } else {
    width = a.rect.width;
    height = a.rect.height;
    x = a.rect.x;
    y = a.rect.y;

    // If square (Shift), use larger dimension anchored at drag origin
    if (a.square) {
      const side = Math.max(width, height);
      width = side;
      height = side;
    }

    // Check if below minimum size → default size centred at `at`
    if (width < SHAPE_MIN_SIZE_WORLD || height < SHAPE_MIN_SIZE_WORLD) {
      width = SHAPE_DEFAULT_SIZE_WORLD;
      height = SHAPE_DEFAULT_SIZE_WORLD;
      x = a.at.x - width / 2;
      y = a.at.y - height / 2;
    }
  }

  const id = crypto.randomUUID();
  const objects = objectsMap(doc);

  doc.transact(() => {
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'shape');
    yMap.set('x', x);
    yMap.set('y', y);
    yMap.set('width', width);
    yMap.set('height', height);
    yMap.set('kind', a.kind);
    yMap.set('fill', DEFAULT_SHAPE_FILL);
    yMap.set('stroke', DEFAULT_SHAPE_STROKE);
    yMap.set('label', new Y.Text(''));
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    yMap.set('createdBy', by);
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);

  return id;
}

export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return false;

  // Validate colours before writing
  if (s.fill !== undefined && !FILL_KEYS.has(s.fill)) return false;
  if (s.stroke !== undefined && !STROKE_KEYS.has(s.stroke)) return false;

  // If nothing to change, still return true (but check if values already match)
  let changed = false;
  if (s.fill !== undefined && obj.get('fill') !== s.fill) changed = true;
  if (s.stroke !== undefined && obj.get('stroke') !== s.stroke) changed = true;
  if (!changed) return false;

  doc.transact(() => {
    if (s.fill !== undefined) obj.set('fill', s.fill);
    if (s.stroke !== undefined) obj.set('stroke', s.stroke);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'shape') return undefined;
  return obj.get('label') as Y.Text;
}
