import * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Board document model (story 2).
 *
 * Schema (this is the future persisted format of story 4 and the live wire
 * format of story 3, hence `meta.schemaVersion`):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * The module is framework-free and side-effect free apart from Yjs
 * transactions so the Durable Object (story 4) can import it too.
 */

/**
 * Transaction origin for mutations made by this client.
 * Story 3 uses it to avoid echoing changes back; story 8 uses it for undo scope.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export const SCHEMA_VERSION = 1;

export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  readonly z: number;
  readonly createdAt: number;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && (COLOR_NAMES as string[]).includes(value);
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function isSticky(m: Y.Map<unknown> | undefined): m is Y.Map<unknown> {
  return !!m && m.get('type') === 'sticky';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  objects.forEach((m) => {
    if (!isSticky(m)) return;
    const z = num(m.get('z'));
    if (z > max) max = z;
  });
  return max;
}

/** Sets `meta.schemaVersion` when absent. Idempotent; no-op otherwise. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>('meta');
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Creates a sticky note centred on `at` (world units), on top of every other
 * note. Returns the new id, or '' when the point is not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return '';

  const objects = objectsOf(doc);
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const safeColor: StickyColor = isStickyColor(color) ? color : DEFAULT_STICKY_COLOR;

  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', at.x - STICKY_SIZE_WORLD / 2);
    m.set('y', at.y - STICKY_SIZE_WORLD / 2);
    m.set('color', safeColor);
    m.set('text', new Y.Text());
    m.set('z', maxZ(objects) + 1);
    m.set('createdAt', Date.now());
    objects.set(id, m);
  }, LOCAL_ORIGIN);

  return id;
}

/** Moves a note to world top-left (x, y). Rejects stale ids and non-finite numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const m = objectsOf(doc).get(id);
  if (!isSticky(m)) return false;
  if (m.get('x') === x && m.get('y') === y) return false;

  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raises a note above every other note. No-op (false) when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const m = objects.get(id);
  if (!isSticky(m)) return false;

  const z = num(m.get('z'));
  const top = maxZ(objects);
  if (z >= top) return false;

  doc.transact(() => {
    m.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Sets the note colour. Rejects stale ids and colour names outside STICKY_COLORS. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;

  const m = objectsOf(doc).get(id);
  if (!isSticky(m)) return false;
  if (m.get('color') === color) return false;

  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Removes an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or undefined for a stale id / non-sticky object. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectsOf(doc).get(id);
  if (!isSticky(m)) return undefined;
  const text = m.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable view of every sticky object, sorted by (z, id) so all clients agree
 * on stacking even when concurrent creation produces equal z values.
 * Objects with an unknown `type` are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = objectsOf(doc);
  const out: StickySnapshot[] = [];

  objects.forEach((m, id) => {
    if (!isSticky(m)) return;
    const text = m.get('text');
    const color = m.get('color');
    out.push({
      id,
      type: 'sticky',
      x: num(m.get('x')),
      y: num(m.get('y')),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: num(m.get('z')),
      createdAt: num(m.get('createdAt')),
    });
  });

  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
