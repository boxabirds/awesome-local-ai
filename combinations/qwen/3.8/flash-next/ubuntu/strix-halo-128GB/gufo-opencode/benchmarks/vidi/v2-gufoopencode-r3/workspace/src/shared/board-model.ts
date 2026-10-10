import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor
} from './config';

// Origin tag for every local mutation. Story 8 uses it for undo and story 3
// uses it to avoid echoing local changes back over the network.
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

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

const META = 'meta';
const OBJECTS = 'objects';

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function finitePoint(at: { x: number; y: number }): boolean {
  return Number.isFinite(at.x) && Number.isFinite(at.y);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS);
}

function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const obj of objectsMap(doc).values()) {
    const z = obj.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR
): string {
  if (!finitePoint(at)) {
    // Non-finite input is a programming error, never user-driven input;
    // reject loudly so bugs surface instead of corrupting the document.
    throw new TypeError(`createSticky: coordinates must be finite, got (${at.x}, ${at.y})`);
  }
  const id = crypto.randomUUID();
  doc.transact(() => {
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', at.x - STICKY_SIZE_WORLD / 2);
    obj.set('y', at.y - STICKY_SIZE_WORLD / 2);
    obj.set('color', color);
    obj.set('text', new Y.Text());
    obj.set('z', maxZ(doc) + 1);
    obj.set('createdAt', Date.now());
    objectsMap(doc).set(id, obj);
  }, LOCAL_ORIGIN);
  return id;
}

function stickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'sticky') return undefined;
  return obj;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = stickyMap(doc, id);
  if (obj === undefined) return false;
  if (obj.get('x') === x && obj.get('y') === y) return false;
  doc.transact(() => {
    obj.set('x', x);
    obj.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = stickyMap(doc, id);
  if (obj === undefined) return false;
  const top = maxZ(doc);
  const current = obj.get('z');
  if (typeof current === 'number' && current === top) return false;
  doc.transact(() => {
    obj.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = stickyMap(doc, id);
  if (obj === undefined) return false;
  if (obj.get('color') === color) return false; // no-op → false per contract
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = stickyMap(doc, id);
  const text = obj?.get('text');
  return text instanceof Y.Text ? text : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc)) {
    if (obj.get('type') !== 'sticky') continue; // forward compatibility
    const x = obj.get('x');
    const y = obj.get('y');
    const color = obj.get('color');
    const text = obj.get('text');
    const z = obj.get('z');
    const createdAt = obj.get('createdAt');
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !isStickyColor(color) ||
      !(text instanceof Y.Text) ||
      typeof z !== 'number' ||
      typeof createdAt !== 'number'
    ) {
      continue;
    }
    notes.push({ id, type: 'sticky', x, y, color, text: text.toString(), z, createdAt });
  }
  notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
