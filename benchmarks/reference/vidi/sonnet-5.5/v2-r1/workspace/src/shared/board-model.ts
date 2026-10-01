import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, DEFAULT_TEXT_SIZE, STICKY_COLORS, STICKY_SIZE_WORLD, TEXT_SIZES } from './config';
import type { StickyColor, TextSize } from './config';
import { rectContains } from './geometry';
import type { Point, Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export const SCHEMA_VERSION = 1;
const HALF = 2;

/** What every board object has; `width`/`height` are absent on stickies created before story 7. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  createdAt: number;
  color?: StickyColor;
  text?: string;
  size?: TextSize;
  widthMode?: 'auto' | 'fixed';
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(['sticky', 'text']);

export function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', SCHEMA_VERSION);
}

function isColor(color: string): color is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, color);
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((obj) => {
    max = Math.max(max, num(obj.get('z')));
  });
  return max;
}

/** Creates a sticky centred on `at`. Returns the new id, or false when the input is rejected. */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
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

export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: obj.width ?? STICKY_SIZE_WORLD,
    height: obj.height ?? STICKY_SIZE_WORLD,
  };
}

/** Ids of objects lying entirely inside `rect` (partly inside or merely touching from outside: not included). */
export function objectsInRect(snap: readonly ObjectSnapshot[], rect: Rect): string[] {
  return snap.filter((o) => rectContains(rect, objectBounds(o))).map((o) => o.id);
}

/** Ids of every selectable object; types the client has not registered are skipped. */
export function allObjectIds(
  snap: readonly ObjectSnapshot[],
  isKnownType: (type: string) => boolean = (t) => KNOWN_TYPES.has(t),
): string[] {
  return snap.filter((o) => isKnownType(o.type)).map((o) => o.id);
}

/** Writes absolute positions; returns how many objects changed. One transaction, none when nothing changes. */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const changes: [Y.Map<unknown>, Point][] = [];
  for (const [id, p] of positions) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
    const obj = objectsOf(doc).get(id);
    if (obj && (obj.get('x') !== p.x || obj.get('y') !== p.y)) changes.push([obj, p]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, p] of changes) {
      obj.set('x', p.x);
      obj.set('y', p.y);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Writes absolute rects, including width and height (which makes an implicit-size sticky explicit). */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const changes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, r] of rects) {
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return 0;
    const obj = objectsOf(doc).get(id);
    if (!obj) continue;
    const same =
      obj.get('x') === r.x && obj.get('y') === r.y && obj.get('width') === r.width && obj.get('height') === r.height;
    if (!same) changes.push([obj, r]);
  }
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const [obj, r] of changes) {
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
    }
  }, LOCAL_ORIGIN);
  return changes.length;
}

/** Raises the objects above every unselected object, keeping their stacking order among themselves. */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const wanted = new Set(ids);
  const selected: { id: string; obj: Y.Map<unknown>; z: number }[] = [];
  let maxUnselected = 0;
  objectsOf(doc).forEach((obj, id) => {
    const z = num(obj.get('z'));
    if (wanted.has(id)) selected.push({ id, obj, z });
    else maxUnselected = Math.max(maxUnselected, z);
  });
  selected.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const changes = selected.map((s, rank) => ({ ...s, next: maxUnselected + rank + 1 })).filter((s) => s.z !== s.next);
  if (changes.length === 0) return 0;
  doc.transact(() => {
    for (const c of changes) c.obj.set('z', c.next);
  }, LOCAL_ORIGIN);
  return changes.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const present = ids.filter((id) => objectsOf(doc).has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objectsOf(doc).delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  return moveObjects(doc, new Map([[id, { x, y }]])) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const obj = objectsOf(doc).get(id);
  if (!obj || !isColor(color) || obj.get('color') === color) return false;
  doc.transact(() => obj.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = objectsOf(doc).get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const result: ObjectSnapshot[] = [];
  objectsOf(doc).forEach((obj, id) => {
    if (!(obj instanceof Y.Map)) return;
    const type = obj.get('type');
    const x = obj.get('x');
    const y = obj.get('y');
    const z = obj.get('z');
    if (typeof type !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    const createdAt = obj.get('createdAt');
    const entry: ObjectSnapshot = { id, type, x, y, z, createdAt: typeof createdAt === 'number' ? createdAt : 0 };
    const width = obj.get('width');
    const height = obj.get('height');
    if (typeof width === 'number' && typeof height === 'number') {
      entry.width = width;
      entry.height = height;
    }
    if (type === 'sticky') {
      const text = obj.get('text');
      const color = obj.get('color');
      entry.color = typeof color === 'string' && isColor(color) ? color : DEFAULT_STICKY_COLOR;
      entry.text = text instanceof Y.Text ? text.toString() : '';
    }
    if (type === 'text') {
      const text = obj.get('text');
      const size = obj.get('size');
      entry.text = text instanceof Y.Text ? text.toString() : '';
      entry.size = typeof size === 'string' && size in TEXT_SIZES ? (size as TextSize) : DEFAULT_TEXT_SIZE;
      entry.widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';
    }
    result.push(entry);
  });
  return result.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
