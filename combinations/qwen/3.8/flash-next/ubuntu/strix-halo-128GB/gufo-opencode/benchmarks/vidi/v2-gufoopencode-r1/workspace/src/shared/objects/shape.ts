import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point, Rect } from '../geometry';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor
} from '../config';

// Story 10: shape objects (rect / ellipse / diamond) with a centred wrapping
// label and fill/stroke styles. See spec story 010 "Shape model".
// Shapes reuse story 7's generic move/resize/select; nothing shape-specific
// lives there beyond the registry entry.

export interface ShapeSnapshot extends ObjectSnapshot {
  type: 'shape';
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
}

export interface CreateShapeArgs {
  kind: ShapeKind;
  rect: Rect | null;
  at: Point;
  square?: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function shapeEntry(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const entry = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  if (entry === undefined || entry.get('type') !== 'shape') return undefined;
  return entry;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of doc.getMap('objects').values()) {
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

// Drag rects smaller than the minimum are treated as a click: a default-sized
// shape centred on the click point. A square drag takes the larger side,
// anchored at the drag origin.
function resolveRect(args: CreateShapeArgs): Rect | null {
  if (args.rect === null) {
    return {
      x: args.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: args.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD
    };
  }
  const r = args.rect;
  if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.width) || !isFiniteNumber(r.height)) {
    return null;
  }
  if (r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
    return {
      x: args.at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: args.at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD
    };
  }
  if (args.square === true) {
    const side = Math.max(r.width, r.height);
    return { x: r.x, y: r.y, width: side, height: side };
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function createShape(doc: Y.Doc, args: CreateShapeArgs, by: string): string | null {
  if (!isShapeKind(args.kind)) return null;
  if (!isFiniteNumber(args.at.x) || !isFiniteNumber(args.at.y)) return null;
  const rect = resolveRect(args);
  if (rect === null) return null;
  const id = newId();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    entry.set('type', 'shape');
    entry.set('kind', args.kind);
    entry.set('x', rect.x);
    entry.set('y', rect.y);
    entry.set('width', rect.width);
    entry.set('height', rect.height);
    entry.set('fill', DEFAULT_SHAPE_FILL);
    entry.set('stroke', DEFAULT_SHAPE_STROKE);
    entry.set('z', maxZ(doc) + 1);
    entry.set('createdAt', Date.now());
    entry.set('createdBy', by);
    entry.set('label', new Y.Text(''));
    objects.set(id, entry);
  }, LOCAL_ORIGIN);
  return id;
}

export function setShapeStyle(doc: Y.Doc, id: string, style: { fill?: string; stroke?: string }): boolean {
  const entry = shapeEntry(doc, id);
  if (entry === undefined) return false;
  let fill: FillColor | undefined;
  let stroke: StrokeColor | undefined;
  if (style.fill !== undefined) {
    if (!isFillColor(style.fill)) return false;
    fill = style.fill;
  }
  if (style.stroke !== undefined) {
    if (!isStrokeColor(style.stroke)) return false;
    stroke = style.stroke;
  }
  if (fill === undefined && stroke === undefined) return false;
  const changed =
    (fill !== undefined && entry.get('fill') !== fill) || (stroke !== undefined && entry.get('stroke') !== stroke);
  if (!changed) return false;
  doc.transact(() => {
    if (fill !== undefined) entry.set('fill', fill);
    if (stroke !== undefined) entry.set('stroke', stroke);
  }, LOCAL_ORIGIN);
  return true;
}

export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = shapeEntry(doc, id);
  if (entry === undefined) return undefined;
  const label = entry.get('label');
  return label instanceof Y.Text ? label : undefined;
}

export function readShape(id: string, entry: Y.Map<unknown>): ShapeSnapshot | null {
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const width = entry.get('width');
  const height = entry.get('height');
  const kind = entry.get('kind');
  const fill = entry.get('fill');
  const stroke = entry.get('stroke');
  const label = entry.get('label');
  const createdAt = entry.get('createdAt');
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    !isShapeKind(kind) ||
    !isFillColor(fill) ||
    !isStrokeColor(stroke) ||
    !(label instanceof Y.Text)
  ) {
    return null;
  }
  return {
    id,
    type: 'shape',
    x,
    y,
    width,
    height,
    kind,
    fill,
    stroke,
    label: label.toString(),
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0
  };
}
