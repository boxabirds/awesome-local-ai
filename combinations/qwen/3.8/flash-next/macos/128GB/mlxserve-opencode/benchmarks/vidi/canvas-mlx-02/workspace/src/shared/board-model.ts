// Yjs board model (story 2). Framework-free module: the client imports it now,
// the story-4 Durable Object will import it for validation/migration.
//
// Schema (the future persisted + wire format):
//   meta:    Y.Map { schemaVersion: number }
//   objects: Y.Map<id, Y.Map> where each value is
//     { type, x, y, color, text: Y.Text, z, createdAt }
import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config.ts';

export const SCHEMA_VERSION = 1;

export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

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

const STICKY_TYPE = 'sticky';

// Known colour names (the six product presets).
const COLOR_NAMES = new Set<string>([
  'yellow',
  'orange',
  'green',
  'blue',
  'pink',
  'violet',
]);

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>('meta');
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function isColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && COLOR_NAMES.has(value);
}

// A usable world coordinate is a finite number.
function isCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    // init runs outside the user-mutation origin so it is not mistaken for a
    // user edit; still one transaction.
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

function readSticky(id: string, m: Y.Map<unknown>): StickySnapshot | null {
  if (m.get('type') !== STICKY_TYPE) return null; // forward-compat: skip unknown types
  const text = m.get('text');
  return {
    id,
    type: 'sticky',
    x: Number(m.get('x')),
    y: Number(m.get('y')),
    color: isColor(m.get('color')) ? (m.get('color') as StickyColor) : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: Number(m.get('z')),
    createdAt: Number(m.get('createdAt')),
  };
}

// Sort order: (z ascending, id as a stable tie-break) so concurrent equal z
// values render identically on every client.
function order(a: { z: number; id: string }, b: { z: number; id: string }): number {
  return a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objectsMap(doc).forEach((m, id) => {
    const s = readSticky(id, m);
    if (s) out.push(s);
  });
  out.sort(order);
  return out;
}

function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    const z = Number(m.get('z'));
    if (Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  // Inputs are validated before opening a transaction; never throws for
  // user-driven input. Non-finite points fall back to the origin.
  const ax = isCoord(at?.x) ? at.x : 0;
  const ay = isCoord(at?.y) ? at.y : 0;
  const col = isColor(color) ? color : DEFAULT_STICKY_COLOR;

  let newId = '';
  doc.transact(() => {
    newId = crypto.randomUUID();
    const m = new Y.Map<unknown>();
    m.set('type', STICKY_TYPE);
    m.set('x', ax - STICKY_SIZE_WORLD / 2); // centred on the click point
    m.set('y', ay - STICKY_SIZE_WORLD / 2);
    m.set('color', col);
    m.set('text', new Y.Text(''));
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(newId, m);
  }, LOCAL_ORIGIN);
  return newId;
}

// Look up a sticky Y.Map by id; returns undefined when missing or not sticky.
function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  const m = objectsMap(doc).get(id);
  if (!m || m.get('type') !== STICKY_TYPE) return undefined;
  return m;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false; // stale / unknown id
  if (!isCoord(x) || !isCoord(y)) return false; // non-finite coordinate
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  const current = Number(m.get('z'));
  const top = maxZ(doc);
  // Already the topmost (>= every other z): no change, no transaction.
  if (Number.isFinite(current) && current >= top) return false;
  doc.transact(() => {
    m.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const m = getStickyMap(doc, id);
  if (!m) return false;
  if (!isColor(color)) return false; // unknown colour name
  if (m.get('color') === color) return false; // no-op: avoid pointless traffic
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const m = objectsMap(doc).get(id);
  if (!m) return false;
  doc.transact(() => {
    objectsMap(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = getStickyMap(doc, id);
  if (!m) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}
