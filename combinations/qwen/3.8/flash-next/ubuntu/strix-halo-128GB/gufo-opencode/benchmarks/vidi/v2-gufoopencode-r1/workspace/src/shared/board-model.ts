import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Point, type Rect } from './geometry';

// Origin tag for every local mutation. Story 8 uses it for undo and story 3 to
// avoid echoing changes back over the network.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

// Generic per-object fields every object type shares. Story 7 introduced
// persisted width/height (sticky notes default to STICKY_SIZE_WORLD for docs
// written before story 7).
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  width: number;
  height: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

// Types this story's model knows how to read. Unknown types stay in the doc
// untouched and are never selectable, listed or measured (design sel.registry).
const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set(['sticky']);

export function isKnownObjectType(type: string): boolean {
  return KNOWN_OBJECT_TYPES.has(type);
}

// Runtime check used by renderers that receive a generic ObjectSnapshot and
// need the sticky fields (snapshot() guarantees it for stored stickies).
export function isStickyObject(obj: ObjectSnapshot): obj is StickySnapshot {
  const candidate = obj as Partial<StickySnapshot>;
  return obj.type === 'sticky' && typeof candidate.color === 'string' && typeof candidate.text === 'string';
}

const SCHEMA_VERSION = 1;

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function maxZ(doc: Y.Doc): number {
  const objects = doc.getMap('objects');
  let max = 0;
  for (const value of objects.values()) {
    const entry = value as Y.Map<unknown>;
    const z = entry.get('z');
    if (typeof z === 'number' && z > max) max = z;
  }
  return max;
}

export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string | false {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  const chosen: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;
  const id = newId();
  const objects = doc.getMap('objects');
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    const top = maxZ(doc);
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('width', STICKY_SIZE_WORLD);
    note.set('height', STICKY_SIZE_WORLD);
    note.set('color', chosen);
    note.set('z', top + 1);
    note.set('createdAt', Date.now());
    const text = new Y.Text('');
    note.set('text', text);
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const objects = doc.getMap('objects');
  const note = objects.get(id) as Y.Map<unknown> | undefined;
  if (note === undefined || note.get('type') !== 'sticky') return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects');
  const note = objects.get(id) as Y.Map<unknown> | undefined;
  if (note === undefined || note.get('type') !== 'sticky') return false;
  const currentZ = note.get('z');
  const top = maxZ(doc);
  if (currentZ === top) return false;
  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const objects = doc.getMap('objects');
  const note = objects.get(id) as Y.Map<unknown> | undefined;
  if (note === undefined || note.get('type') !== 'sticky') return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = doc.getMap('objects');
  const note = objects.get(id) as Y.Map<unknown> | undefined;
  if (note === undefined || note.get('type') !== 'sticky') return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = doc.getMap('objects');
  const note = objects.get(id) as Y.Map<unknown> | undefined;
  if (note === undefined || note.get('type') !== 'sticky') return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = doc.getMap('objects');
  const result: StickySnapshot[] = [];
  for (const [id, value] of objects.entries()) {
    const entry = value as Y.Map<unknown>;
    if (entry.get('type') !== 'sticky') continue;
    const x = entry.get('x');
    const y = entry.get('y');
    const color = entry.get('color');
    const z = entry.get('z');
    const createdAt = entry.get('createdAt');
    const text = entry.get('text');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || !isStickyColor(color)) continue;
    const width = entry.get('width');
    const height = entry.get('height');
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      width: isFiniteNumber(width) ? width : STICKY_SIZE_WORLD,
      height: isFiniteNumber(height) ? height : STICKY_SIZE_WORLD,
      color,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0
    });
  }
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

// --- Story 7: generic bounds and group operations ------------------------

export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

// Marquee containment: only objects fully inside the rect (design sel.marquee).
export function objectsInRect(objects: readonly ObjectSnapshot[], rect: Rect): string[] {
  const ids: string[] = [];
  for (const obj of objects) {
    if (!isKnownObjectType(obj.type)) continue;
    if (rectContains(rect, objectBounds(obj))) ids.push(obj.id);
  }
  return ids;
}

export function allObjectIds(objects: readonly ObjectSnapshot[]): string[] {
  return objects.filter((obj) => isKnownObjectType(obj.type)).map((obj) => obj.id);
}

function entryWithPosition(objects: Y.Map<unknown>, id: string): Y.Map<unknown> | undefined {
  const entry = objects.get(id) as Y.Map<unknown> | undefined;
  return entry;
}

// Absolute positions for many objects in one LOCAL_ORIGIN transaction.
// Missing ids and non-finite coordinates are skipped; nothing is written
// unless at least one position is applicable.
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  const objects = doc.getMap('objects');
  const writes: [Y.Map<unknown>, number, number][] = [];
  for (const [id, at] of positions) {
    if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) continue;
    const entry = entryWithPosition(objects, id);
    if (entry === undefined) continue;
    writes.push([entry, at.x, at.y]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [entry, x, y] of writes) {
      entry.set('x', x);
      entry.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

// Absolute rects (position + size) for many objects in one transaction.
// Missing ids, non-finite values and non-positive sizes are skipped.
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  const objects = doc.getMap('objects');
  const writes: [Y.Map<unknown>, Rect][] = [];
  for (const [id, rect] of rects) {
    if (
      !isFiniteNumber(rect.x) ||
      !isFiniteNumber(rect.y) ||
      !isFiniteNumber(rect.width) ||
      !isFiniteNumber(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue;
    }
    const entry = entryWithPosition(objects, id);
    if (entry === undefined) continue;
    writes.push([entry, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [entry, rect] of writes) {
      entry.set('x', rect.x);
      entry.set('y', rect.y);
      entry.set('width', rect.width);
      entry.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

// Raise every listed object above everything else while keeping their relative
// stacking order (ascending z). Ids missing from the doc are skipped.
// Re-raising an already-topmost selection is a no-op.
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const objects = doc.getMap('objects');
  const selected = new Set(ids);
  let topUnselected = 0;
  for (const [id, value] of objects.entries()) {
    if (selected.has(id)) continue;
    const z = (value as Y.Map<unknown>).get('z');
    if (typeof z === 'number' && z > topUnselected) topUnselected = z;
  }
  const entries: [Y.Map<unknown>, number][] = [];
  for (const id of ids) {
    const entry = objects.get(id) as Y.Map<unknown> | undefined;
    if (entry === undefined) continue;
    const z = entry.get('z');
    entries.push([entry, typeof z === 'number' ? z : 0]);
  }
  if (entries.length === 0) return 0;
  entries.sort((a, b) => a[1] - b[1]);
  const assignments = entries.map(([entry, z], i): [Y.Map<unknown>, number, number] => [entry, z, topUnselected + 1 + i]);
  const changed = assignments.filter(([, z, target]) => z !== target);
  if (changed.length === 0) return 0;
  doc.transact(() => {
    for (const [entry, , target] of changed) entry.set('z', target);
  }, LOCAL_ORIGIN);
  return changed.length;
}

export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const objects = doc.getMap('objects');
  const present = ids.filter((id) => objects.has(id));
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
