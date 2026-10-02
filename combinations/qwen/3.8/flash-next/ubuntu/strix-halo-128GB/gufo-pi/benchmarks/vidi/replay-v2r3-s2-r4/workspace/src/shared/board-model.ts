import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  type StickyColor,
} from './config';

/**
 * Board document model (story 2).
 *
 * The Y.Doc schema below is the future persisted format (story 4) and the wire
 * format (story 3), which is why `meta.schemaVersion` exists from day one.
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
 * This module is framework-free so the Durable Object (story 4) can import it
 * for validation and migration.
 */

export const SCHEMA_VERSION = 1;
export const META_MAP = 'meta';
export const OBJECTS_MAP = 'objects';

/** Transaction origin for local user-driven mutations (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export type ObjectType = 'sticky';

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

export interface Point {
  x: number;
  y: number;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as readonly string[];

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && COLOR_NAMES.includes(value);
}

function isFinitePoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as Point).x) &&
    Number.isFinite((value as Point).y)
  );
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
}

function getStickyMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  if (typeof id !== 'string') return undefined;
  const value = getObjects(doc).get(id);
  if (!(value instanceof Y.Map)) return undefined;
  if (value.get('type') !== 'sticky') return undefined;
  return value;
}

/** Largest z currently in the document (0 when empty, so the first note gets z 1). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const value of getObjects(doc).values()) {
    if (!(value instanceof Y.Map)) continue;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** Create the `meta` / `objects` maps. Safe to call repeatedly; only the first call writes. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_MAP);
  if (meta.get('schemaVersion') !== undefined) return;
  // Touching `objects` keeps the schema shape stable for story 4 migrations.
  doc.transact(() => {
    getObjects(doc);
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (top-left = point - STICKY_SIZE_WORLD / 2),
 * on top of all other notes. Returns the new id, or null when `at` is not a finite point.
 */
export function createSticky(
  doc: Y.Doc,
  at: Point,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!isFinitePoint(at)) return null;

  const id = crypto.randomUUID();
  const note = new Y.Map<unknown>();
  const text = new Y.Text();

  doc.transact(() => {
    note.set('type', 'sticky' satisfies ObjectType);
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', text);
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    getObjects(doc).set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note (world coordinates of its top-left). Rejects non-finite numbers and stale ids. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const note = getStickyMap(doc, id);
  if (!note) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other note. No-op (false) when it is already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = getStickyMap(doc, id);
  if (!note) return false;

  const z = note.get('z');
  const current = typeof z === 'number' ? z : 0;
  const top = maxZ(doc);
  if (current >= top) return false;

  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Rejects stale ids and colour names outside STICKY_COLORS. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const note = getStickyMap(doc, id);
  if (!note) return false;
  if (!isStickyColor(color)) return false;
  if (note.get('color') === color) return false;

  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const note = getStickyMap(doc, id);
  if (!note) return false;

  doc.transact(() => {
    getObjects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, for minimal-diff editing (see StickyText.applyTextDiff). */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = getStickyMap(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function toSticky(id: string, note: Y.Map<unknown>): StickySnapshot | null {
  if (note.get('type') !== 'sticky') return null;

  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  const color = note.get('color');
  const text = note.get('text');
  const createdAt = note.get('createdAt');

  return {
    id,
    type: 'sticky',
    x: typeof x === 'number' ? x : 0,
    y: typeof y === 'number' ? y : 0,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' ? z : 0,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/**
 * Immutable view of the board, sorted by (z, id) so every client renders the
 * same order even when concurrent creates produce equal z values. Unknown
 * object types (stories 9-12) are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const result: StickySnapshot[] = [];
  for (const [id, value] of getObjects(doc)) {
    if (!(value instanceof Y.Map)) continue;
    const note = toSticky(id, value);
    if (note) result.push(note);
  }
  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
