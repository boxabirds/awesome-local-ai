import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');
export const SCHEMA_VERSION = 1;
const HALF = 2;

/** What every board object has; width/height are absent on stickies created before story 7. */
export interface ObjectSnapshot {
  id: string; type: string; x: number; y: number; width?: number; height?: number; z: number; createdAt: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky'; color: StickyColor; text: string;
}

/** Object types that selection, select-all and marquee may act on (the client registry adds to this). */
const KNOWN_TYPES = new Set<string>(['sticky']);

export function registerKnownObjectType(type: string): void {
  KNOWN_TYPES.add(type);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

function isColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(obj: Y.Map<unknown>): number {
  const z = obj.get('z');
  return typeof z === 'number' ? z : 0;
}

function maxZ(doc: Y.Doc, exceptId?: string): number {
  let max = 0;
  objectsOf(doc).forEach((obj, id) => {
    if (id !== exceptId && obj instanceof Y.Map) max = Math.max(max, zOf(obj));
  });
  return max;
}

/** Returns the new id, or false when the coordinates are not finite numbers. */
export function createSticky(
  doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isColor(color)) return false;
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    objectsOf(doc).set(id, obj);
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    obj.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsOf(doc).get(id);
  return obj instanceof Y.Map ? obj : undefined;
}

export function hasObject(doc: Y.Doc, id: string): boolean {
  return getObject(doc, id) !== undefined;
}

const finiteRect = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite);

export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x, y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of known-type objects lying entirely inside `rect` (touching from outside does not count). */
export function objectsInRect(snap: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snap.filter((o) => KNOWN_TYPES.has(o.type) && rectContains(rect, objectBounds(o))).map((o) => o.id);
}

export function allObjectIds(snap: readonly ObjectSnapshot[]): string[] {
  return snap.filter((o) => KNOWN_TYPES.has(o.type)).map((o) => o.id);
}

/** Absolute positions. Returns how many objects changed; non-finite input applies nothing. */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  for (const p of positions.values()) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  const todo: Array<[Y.Map<unknown>, Point]> = [];
  positions.forEach((p, id) => {
    const obj = getObject(doc, id);
    if (obj && (obj.get('x') !== p.x || obj.get('y') !== p.y)) todo.push([obj, p]);
  });
  if (todo.length === 0) return 0;
  doc.transact(() => todo.forEach(([obj, p]) => { obj.set('x', p.x); obj.set('y', p.y); }), LOCAL_ORIGIN);
  return todo.length;
}

/** Absolute rects; writes width and height too (making implicit-size stickies explicit). */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) if (!finiteRect(r) || r.width <= 0 || r.height <= 0) return 0;
  const todo: Array<[Y.Map<unknown>, Rect]> = [];
  rects.forEach((r, id) => {
    const obj = getObject(doc, id);
    if (!obj) return;
    const w = obj.get('width') ?? STICKY_SIZE_WORLD;
    const h = obj.get('height') ?? STICKY_SIZE_WORLD;
    const same = obj.get('x') === r.x && obj.get('y') === r.y && w === r.width && h === r.height
      && obj.get('width') !== undefined && obj.get('height') !== undefined;
    if (!same) todo.push([obj, r]);
  });
  if (todo.length === 0) return 0;
  doc.transact(() => todo.forEach(([obj, r]) => {
    obj.set('x', r.x); obj.set('y', r.y); obj.set('width', r.width); obj.set('height', r.height);
  }), LOCAL_ORIGIN);
  return todo.length;
}

/** Raises the given objects above every other object, keeping their order among themselves. */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const picked: Array<{ id: string; obj: Y.Map<unknown> }> = [];
  let others = 0;
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    if (wanted.has(id)) picked.push({ id, obj });
    else others = Math.max(others, zOf(obj));
  });
  if (picked.length === 0) return 0;
  picked.sort((a, b) => zOf(a.obj) - zOf(b.obj) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (zOf(picked[0].obj) > others) return 0;
  doc.transact(() => picked.forEach(({ obj }, rank) => obj.set('z', others + 1 + rank)), LOCAL_ORIGIN);
  return picked.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = [...new Set(ids)].filter((id) => hasObject(doc, id));
  if (present.length === 0) return 0;
  doc.transact(() => present.forEach((id) => objectsOf(doc).delete(id)), LOCAL_ORIGIN);
  return present.length;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) === 1;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) === 1;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = getObject(doc, id);
  if (!obj || !isColor(color) || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) === 1;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = getObject(doc, id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function size(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Every object with a type and a position, in stacking order. Stickies carry colour and text. */
export function snapshotObjects(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const type = obj.get('type');
    const x = obj.get('x');
    const y = obj.get('y');
    if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
    const createdAt = obj.get('createdAt');
    const base: ObjectSnapshot = {
      id, type, x, y, z: zOf(obj), createdAt: typeof createdAt === 'number' ? createdAt : 0,
    };
    const width = size(obj.get('width'));
    const height = size(obj.get('height'));
    if (width !== undefined) base.width = width;
    if (height !== undefined) base.height = height;
    if (type === 'sticky') {
      const color = obj.get('color');
      const text = obj.get('text');
      out.push({
        ...base, type: 'sticky',
        color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
      } as StickySnapshot);
    } else {
      out.push(base);
    }
  });
  return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshotObjects(doc).filter((o): o is StickySnapshot => o.type === 'sticky');
}
