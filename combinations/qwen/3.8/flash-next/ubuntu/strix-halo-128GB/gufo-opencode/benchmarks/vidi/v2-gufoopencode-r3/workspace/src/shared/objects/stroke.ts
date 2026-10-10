import * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot } from '../board-model';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness
} from '../config';
import type { Point } from '../geometry';

export type { PenColor, PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  readonly type: 'stroke';
  // Strokes always carry an explicit box.
  readonly width: number;
  readonly height: number;
  // Flat [x0, y0, x1, y1, ...] relative to the bbox origin, at base size.
  readonly points: readonly number[];
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly color: PenColor;
  readonly thickness: PenThickness;
}

export type StrokeFields = Omit<
  StrokeSnap,
  keyof ObjectSnapshot | 'id' | 'type'
>;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function strokeMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'stroke') return undefined;
  return obj;
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.hasOwn(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, value);
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

function snapFromMap(id: string, obj: Y.Map<unknown>): StrokeSnap | undefined {
  if (obj.get('type') !== 'stroke') return undefined;
  const fields = readFields(obj);
  if (fields === undefined) return undefined;
  const x = obj.get('x');
  const y = obj.get('y');
  const z = obj.get('z');
  const width = obj.get('width');
  const height = obj.get('height');
  return {
    id,
    type: 'stroke',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    z: typeof z === 'number' ? z : 0,
    width: typeof width === 'number' ? width : fields.baseWidth,
    height: typeof height === 'number' ? height : fields.baseHeight,
    ...fields
  };
}

export function getStrokeFields(doc: Y.Doc, id: string): StrokeFields | undefined {
  const obj = strokeMap(doc, id);
  if (obj === undefined) return undefined;
  return readFields(obj);
}

function readFields(obj: Y.Map<unknown>): StrokeFields | undefined {
  const raw = obj.get('points');
  const baseWidth = obj.get('baseWidth');
  const baseHeight = obj.get('baseHeight');
  const color = obj.get('color');
  const thickness = obj.get('thickness');
  if (
    !Array.isArray(raw) ||
    !raw.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    typeof baseWidth !== 'number' ||
    !Number.isFinite(baseWidth) ||
    baseWidth <= 0 ||
    typeof baseHeight !== 'number' ||
    !Number.isFinite(baseHeight) ||
    baseHeight <= 0 ||
    !isPenColor(color) ||
    !isPenThickness(thickness)
  ) {
    return undefined;
  }
  return {
    points: raw as number[],
    baseWidth,
    baseHeight,
    color,
    thickness
  };
}

export function collectStrokeSnapshots(doc: Y.Doc): readonly StrokeSnap[] {
  const out: StrokeSnap[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    const snap = snapFromMap(id, obj);
    if (snap !== undefined) out.push(snap);
  }
  return out;
}

export function getStrokeSnap(doc: Y.Doc, id: string): StrokeSnap | undefined {
  const obj = strokeMap(doc, id);
  return obj === undefined ? undefined : snapFromMap(id, obj);
}

// One finished stroke (or one split part) in a single LOCAL_ORIGIN
// transaction. World-space points become bbox-relative at creation size; the
// bbox is the point bounds padded by half the drawn thickness. Empty points,
// non-finite coordinates or unknown colour/thickness are contract errors:
// null and no transaction at all.
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string
): string | null {
  if (a.points.length === 0) return null;
  if (!isPenColor(a.color) || !isPenThickness(a.thickness)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = PEN_THICKNESS_WORLD[a.thickness] / 2;
  const x = minX - pad;
  const y = minY - pad;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const points: number[] = [];
  for (const p of a.points) {
    points.push(p.x - x, p.y - y);
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', points);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

// Current-size world points: stored coordinates scale by the live
// width/baseWidth and height/baseHeight; thickness itself never scales.
export function scaledPoints(s: StrokeSnap): Point[] {
  const sx = s.width / s.baseWidth;
  const sy = s.height / s.baseHeight;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}
