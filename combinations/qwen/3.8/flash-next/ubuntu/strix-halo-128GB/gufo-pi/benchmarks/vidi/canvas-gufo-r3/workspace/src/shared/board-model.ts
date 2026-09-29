import * as Y from 'yjs';
import { StickyColor, STICKY_COLORS, STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

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

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || !(m instanceof Y.Map) || m.get('type') !== 'sticky') return undefined;
  return m;
}

function isStickyColor(value: string): value is StickyColor {
  return Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    if (m instanceof Y.Map && m.get('type') === 'sticky') {
      const z = m.get('z');
      if (isFiniteNumber(z) && z > max) max = z;
    }
  });
  return max;
}

/** Sets meta.schemaVersion if absent. Idempotent, emits no update when already set. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      if (!meta.has('schemaVersion')) meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Creates a sticky note centred on the world point `at`
 * (stored top-left = at - STICKY_SIZE_WORLD / 2), on top of all other notes.
 * Returns the new id, or '' if the point is invalid.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';
  if (!isStickyColor(color)) return '';
  const id = crypto.randomUUID();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', at.x - STICKY_SIZE_WORLD / 2);
    m.set('y', at.y - STICKY_SIZE_WORLD / 2);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/** Moves the note's top-left to (x, y) world units. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises the note above all others. No-op (false) when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  const z = m.get('z');
  const max = maxZ(doc);
  if (!isFiniteNumber(z) || z >= max) return false;
  doc.transact(() => {
    m.set('z', max + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets the note colour. Rejects unknown colour names and stale ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isStickyColor(color)) return false;
  if (m.get('color') === color) return false;
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes the note from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

/** Immutable snapshot of all sticky notes sorted by (z, id); unknown types skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'sticky') return;
    const x = m.get('x');
    const y = m.get('y');
    const color = m.get('color');
    const text = m.get('text');
    const z = m.get('z');
    const createdAt = m.get('createdAt');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return;
    result.push({
      id,
      type: 'sticky',
      x,
      y,
      color: isStickyColor(String(color)) ? (color as StickyColor) : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
    });
  });
  result.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
