import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, DEFAULT_TEXT_SIZE, STICKY_COLORS, STICKY_SIZE_WORLD, TEXT_SIZES, type StickyColor, type TextSize } from './config';
import type { TextSnapshot } from './objects/text';
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
const knownTypes = new Set<string>(['sticky', 'text']);
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
  doc.transact(() => {
    for (const [id, p] of present) {
      const obj = objects(doc).get(id)!;
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return present.length;
}

/** Absolute rects; the first resize of an implicitly sized sticky writes width and height. */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  for (const r of rects.values()) if (!finite(r.x, r.y, r.width, r.height) || r.width <= 0 || r.height <= 0) return 0;
  const present = [...rects].filter(([id]) => objects(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const [id, r] of present) {
      const obj = objects(doc).get(id)!;
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
  doc.transact(() => present.forEach((id) => objects(doc).delete(id)), LOCAL_ORIGIN);
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

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const out: ObjectSnapshot[] = [];
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
    } else out.push(base);
  });
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
