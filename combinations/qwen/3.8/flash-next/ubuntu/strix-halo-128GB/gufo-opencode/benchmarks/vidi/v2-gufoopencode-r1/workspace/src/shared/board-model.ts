import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';

// Origin tag for every local mutation. Story 8 uses it for undo and story 3 to
// avoid echoing changes back over the network.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: typeof createdAt === 'number' ? createdAt : 0
    });
  }
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
