import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, DEFAULT_TEXT_SIZE, STICKY_COLORS, STICKY_SIZE_WORLD, TEXT_SIZES, type StickyColor, type TextSize } from './config';
import type { TextSnapshot } from './objects/text';
import type { ShapeSnap } from './objects/shape';
import { detachConnectorsTo, parseEndpoint, type ConnectorSnap } from './objects/connector';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, SHAPE_FILL_COLORS, SHAPE_KINDS, SHAPE_STROKE_COLORS } from './config';
import { rectContains, type Point, type Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

/** Fields every board object has, whatever its type. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

export function isSticky(o: ObjectSnapshot): o is StickySnapshot {
  return o.type === 'sticky';
}

/** Object types the client can render, select and transform (the registry adds its own). */
const knownTypes = new Set<string>(['sticky', 'text', 'shape', 'connector']);
export function registerKnownType(type: string): void {
  knownTypes.add(type);
}

const SCHEMA_VERSION = 1;

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isTextSize(s: string): s is TextSize {
  return Object.prototype.hasOwnProperty.call(TEXT_SIZES, s);
}

function isColor(c: string): c is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((o) => {
    max = Math.max(max, zOf(o));
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

/** Returns the new id, or '' when the coordinates are not finite (nothing is written). */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objects(doc).set(id, obj);
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', isColor(color) ? color : DEFAULT_STICKY_COLOR);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objects(doc).get(id);
  if (!obj || !isColor(color)) return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** Bounds of an object; stickies saved before resizing existed read as STICKY_SIZE_WORLD squares. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/** Ids of objects lying entirely inside `rect` (partly inside, or merely touching from outside, does not count). */
export function objectsInRect(snap: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snap.filter((o) => knownTypes.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

export function allObjectIds(snap: readonly ObjectSnapshot[]): string[] {
  return snap.filter((o) => knownTypes.has(o.type)).map((o) => o.id);
}

const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));

/** Absolute positions. Returns how many objects changed; missing ids are skipped. At most one transaction. */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!finite(p.x, p.y)) return 0;
  const present = [...positions].filter(([id]) => objects(doc).has(id));
  if (present.length === 0) return 0;
  const bounds = present.some(([id]) => objects(doc).get(id)!.get('type') === 'connector') ? connectorBounds(doc) : null;
  doc.transact(() => {
    for (const [id, p] of present) {
      const obj = objects(doc).get(id)!;
      if (obj.get('type') === 'connector') {
        const b = bounds?.get(id);
        if (b) translateConnector(obj, p.x - b.x, p.y - b.y);
        continue;
      }
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Derived bounding boxes of the connectors on the board. */
function connectorBounds(doc: Y.Doc): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const o of snapshot(doc)) if (o.type === 'connector') out.set(o.id, objectBounds(o));
  return out;
}

/** A connector has no position of its own: moving it shifts its free ends; attached ends follow their objects. */
function translateConnector(obj: Y.Map<unknown>, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const key of ['from', 'to']) {
    const e = parseEndpoint(obj.get(key));
    if (e.kind === 'free') obj.set(key, { kind: 'free', x: e.x + dx, y: e.y + dy });
  }
}

/** Absolute rects; the first resize of an implicitly sized sticky writes width and height. */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) if (!finite(r.x, r.y, r.width, r.height) || r.width <= 0 || r.height <= 0) return 0;
  const present = [...rects].filter(([id]) => objects(doc).has(id));
  if (present.length === 0) return 0;
  const bounds = present.some(([id]) => objects(doc).get(id)!.get('type') === 'connector') ? connectorBounds(doc) : null;
  doc.transact(() => {
    for (const [id, r] of present) {
      const obj = objects(doc).get(id)!;
      if (obj.get('type') === 'connector') {
        const b = bounds?.get(id);
        if (b) translateConnector(obj, r.x - b.x, r.y - b.y);
        continue;
      }
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Raises the given objects above every other object, keeping their order among themselves. */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids.filter((id) => objects(doc).has(id)));
  if (wanted.size === 0) return 0;
  let othersMax = 0;
  const chosen: { id: string; z: number }[] = [];
  objects(doc).forEach((o, id) => {
    if (wanted.has(id)) chosen.push({ id, z: zOf(o) });
    else othersMax = Math.max(othersMax, zOf(o));
  });
  chosen.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (chosen[0].z > othersMax) return 0;
  doc.transact(() => {
    chosen.forEach((c, rank) => objects(doc).get(c.id)!.set('z', othersMax + rank + 1));
  }, LOCAL_ORIGIN);
  return chosen.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => objects(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    detachConnectorsTo(doc, present);
    present.forEach((id) => objects(doc).delete(id));
  }, LOCAL_ORIGIN);
  return present.length;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const t = objects(doc).get(id)?.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** Only the sticky notes of the board. */
export function stickies(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc).filter(isSticky);
}

/** Rectangles of every board object that arrows can attach to (everything but connectors). */
export function objectRects(doc: Y.Doc): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const o of readObjects(doc, false)) out.set(o.id, objectBounds(o));
  return out;
}

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  return readObjects(doc, true);
}

function readObjects(doc: Y.Doc, withConnectors: boolean): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  const connectors: [string, Y.Map<unknown>, ObjectSnapshot][] = [];
  objects(doc).forEach((o, id) => {
    if (!(o instanceof Y.Map)) return;
    const type = o.get('type');
    if (typeof type !== 'string' || !knownTypes.has(type)) return;
    const fallback = type === 'sticky' ? STICKY_SIZE_WORLD : 1;
    const dim = (key: string) => {
      const v = o.get(key);
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const base: ObjectSnapshot = {
      id,
      type,
      x: Number(o.get('x')) || 0,
      y: Number(o.get('y')) || 0,
      width: dim('width'),
      height: dim('height'),
      z: zOf(o),
      createdAt: Number(o.get('createdAt')) || 0,
    };
    if (type === 'sticky') {
      const text = o.get('text');
      const color = o.get('color') as string;
      const sticky: StickySnapshot = {
        ...base,
        type: 'sticky',
        color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
      };
      out.push(sticky);
    } else if (type === 'text') {
      const text = o.get('text');
      const size = o.get('size') as string;
      const t: TextSnapshot = {
        ...base,
        type: 'text',
        text: text instanceof Y.Text ? text.toString() : '',
        size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
        widthMode: o.get('widthMode') === 'fixed' ? 'fixed' : 'auto',
      };
      out.push(t);
    } else if (type === 'shape') {
      const label = o.get('label');
      const kind = o.get('kind') as string;
      const fill = o.get('fill') as string;
      const stroke = o.get('stroke') as string;
      const shape: ShapeSnap = {
        ...base,
        type: 'shape',
        kind: (SHAPE_KINDS as readonly string[]).includes(kind) ? (kind as ShapeSnap['kind']) : 'rect',
        fill: Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, fill) ? (fill as ShapeSnap['fill']) : DEFAULT_SHAPE_FILL,
        stroke: Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, stroke) ? (stroke as ShapeSnap['stroke']) : DEFAULT_SHAPE_STROKE,
        label: label instanceof Y.Text ? label.toString() : '',
      };
      out.push(shape);
    } else if (type === 'connector') {
      if (withConnectors) connectors.push([id, o, base]);
    } else out.push(base);
  });
  if (connectors.length > 0) {
    const rects = new Map<string, Rect>();
    for (const o of out) rects.set(o.id, objectBounds(o));
    for (const [, o, base] of connectors) {
      const c = { from: parseEndpoint(o.get('from')), to: parseEndpoint(o.get('to')) };
      const ends = resolveEndpoints(c, rects);
      const conn: ConnectorSnap = { ...base, type: 'connector', ...c, ends, ...connectorBBox(ends.from, ends.to) };
      out.push(conn);
    }
  }
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
