import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap('objects') as Y.Map<ObjectMap>;
}

function isColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((o) => {
    const z = o.get('z');
    if (typeof z === 'number' && z > max) max = z;
  });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
}

/** Creates a note centred on `at`. Returns the new id, or '' when the point is not finite. */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';
  const id = crypto.randomUUID();
  const objects = objectsOf(doc);
  doc.transact(() => {
    const note: ObjectMap = new Y.Map();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', isColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const note = objectsOf(doc).get(id);
  if (!note || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (note.get('x') === x && note.get('y') === y) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const note = objects.get(id);
  if (!note) return false;
  const z = note.get('z');
  const top = maxZ(objects);
  if (z === top) {
    // Topmost, unless another note shares the same z (then the id tie-break decides).
    let shared = false;
    objects.forEach((o, key) => { if (key !== id && o.get('z') === z) shared = true; });
    if (!shared) return false;
  }
  doc.transact(() => note.set('z', top + 1), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const note = objectsOf(doc).get(id);
  if (!note || !isColor(color) || note.get('color') === color) return false;
  doc.transact(() => note.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => objects.delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = objectsOf(doc).get(id)?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((o, id) => {
    if (o.get('type') !== 'sticky') return;
    const text = o.get('text');
    const x = o.get('x');
    const y = o.get('y');
    const z = o.get('z');
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    const color = o.get('color');
    const createdAt = o.get('createdAt');
    out.push({
      id,
      type: 'sticky',
      x,
      y,
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    });
  });
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
