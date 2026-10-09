import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness
} from '../config';

// Story 11: freehand stroke objects. The recorded path is stored as a flat
// [x, y, ...] array relative to the object's bbox origin at creation size;
// resize scales the path with the bbox (scaledPoints) instead of rewriting
// the points, so the object keeps story 7's plain x/y/width/height model.

export interface StrokeSnapshot extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
}

export interface CreateStrokeArgs {
  points: readonly Point[];
  color: string;
  thickness: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);
}

export function isStrokePoints(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length % 2 === 0 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of doc.getMap('objects').values()) {
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Validate everything before opening a transaction; invalid input never
// touches the doc (design pen.model).
export function createStroke(doc: Y.Doc, args: CreateStrokeArgs, by: string): string | null {
  if (args.points.length === 0) return null;
  for (const p of args.points) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return null;
  }
  if (!isPenColor(args.color) || !isPenThickness(args.thickness)) return null;
  const thickness = PEN_THICKNESS_WORLD[args.thickness];
  const pad = thickness / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of args.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Single point (a click dot): a thickness-sized square centred on it.
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (args.points.length === 1) {
    const p = args.points[0];
    x = p.x - pad;
    y = p.y - pad;
    width = thickness;
    height = thickness;
  } else {
    x = minX - pad;
    y = minY - pad;
    width = maxX - minX + thickness;
    height = maxY - minY + thickness;
  }

  const flat: number[] = [];
  for (const p of args.points) {
    flat.push(p.x - x, p.y - y);
  }

  const id = newId();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'stroke');
    entry.set('x', x);
    entry.set('y', y);
    entry.set('width', width);
    entry.set('height', height);
    entry.set('baseWidth', width);
    entry.set('baseHeight', height);
    entry.set('points', flat);
    entry.set('color', args.color);
    entry.set('thickness', args.thickness);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    entry.set('createdBy', by);
    objects.set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

// World-space points of the path at the object's current size: creation-size
// coordinates scaled by width/baseWidth and height/baseHeight.
export function scaledPoints(s: StrokeSnapshot): Point[] {
  const sx = s.baseWidth > 0 ? s.width / s.baseWidth : 1;
  const sy = s.baseHeight > 0 ? s.height / s.baseHeight : 1;
  const out: Point[] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) {
    out.push({ x: s.x + s.points[i] * sx, y: s.y + s.points[i + 1] * sy });
  }
  return out;
}

export function readStroke(id: string, entry: Y.Map<unknown>): StrokeSnapshot | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const width = entry.get('width');
  const height = entry.get('height');
  const baseWidth = entry.get('baseWidth');
  const baseHeight = entry.get('baseHeight');
  const points = entry.get('points');
  const color = entry.get('color');
  const thickness = entry.get('thickness');
  const createdAt = entry.get('createdAt');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isFiniteNumber(baseWidth) ||
    !isFiniteNumber(baseHeight) ||
    baseWidth <= 0 ||
    baseHeight <= 0 ||
    !isStrokePoints(points) ||
    !isPenColor(color) ||
    !isPenThickness(thickness)
  ) {
    return null;
  }
  return {
    id,
    type: 'stroke',
    x,
    y,
    width,
    height,
    baseWidth,
    baseHeight,
    points: [...points],
    color,
    thickness,
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0
  };
}
