import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor,
} from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export const SCHEMA_VERSION = 1;
const HALF = 2;

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

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function isColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function zOf(m: Y.Map<unknown>): number {
  const z = m.get('z');
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsOf(doc).forEach((m) => { max = Math.max(max, zOf(m)); });
  return max;
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => meta.set('schemaVersion', SCHEMA_VERSION), LOCAL_ORIGIN);
  }
  doc.getMap('objects');
}

/** Creates a note centred on `at`. Returns false (no change) for non-finite coordinates. */
export function createSticky(
  doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !isColor(color)) return false;
  const id = crypto.randomUUID();
  const z = maxZ(doc) + 1;
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    objectsOf(doc).set(id, m);
    m.set('type', 'sticky');
    m.set('x', at.x - STICKY_SIZE_WORLD / HALF);
    m.set('y', at.y - STICKY_SIZE_WORLD / HALF);
    m.set('color', color);
    m.set('text', new Y.Text());
    m.set('z', z);
    m.set('createdAt', Date.now());
  }, LOCAL_ORIGIN);
  return id;
}

function getObject(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsOf(doc).get(id);
  return m instanceof Y.Map ? m : undefined;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const m = getObject(doc, id);
  if (!m || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (m.get('x') === x && m.get('y') === y) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = getObject(doc, id);
  if (!m) return false;
  const sorted = snapshot(doc);
  if (sorted.length > 0 && sorted[sorted.length - 1].id === id) return false;
  const z = maxZ(doc) + 1;
  doc.transact(() => m.set('z', z), LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getObject(doc, id);
  if (!m || !isColor(color)) return false;
  if (m.get('color') === color) return false;
  doc.transact(() => m.set('color', color), LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (!getObject(doc, id)) return false;
  doc.transact(() => objectsOf(doc).delete(id), LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getObject(doc, id);
  if (!m || m.get('type') !== 'sticky') return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** All sticky notes sorted by (z, id); objects of unknown type are skipped. */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsOf(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map) || m.get('type') !== 'sticky') return;
    const color = m.get('color');
    const text = m.get('text');
    out.push({
      id,
      type: 'sticky',
      x: num(m.get('x')),
      y: num(m.get('y')),
      color: isColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: zOf(m),
      createdAt: num(m.get('createdAt')),
    });
  });
  out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
