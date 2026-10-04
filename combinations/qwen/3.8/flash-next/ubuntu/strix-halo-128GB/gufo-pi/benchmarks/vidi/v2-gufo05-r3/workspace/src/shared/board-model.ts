import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * vidi6 board document model (Yjs).
 *
 * This module owns the document schema and every mutation of board objects. It
 * is framework-free so the Durable Object (story 4) can import it for
 * validation and migration, and so story 3 can attach a network provider to the
 * same document.
 *
 * Schema (the future persisted and wire contract):
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
 * Rules:
 * - Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`.
 * - Invalid or pointless input (stale id, unknown colour, non-finite numbers,
 *   bringing the topmost note forward) returns `false` *before* opening a
 *   transaction, so no update — and therefore no sync traffic in story 3 — is
 *   produced. The module never throws for user-driven input.
 * - Unknown `type` values are skipped by {@link snapshot} so notes from later
 *   stories (shapes, text, pen) cannot crash the renderer.
 */

/** Transaction origin for local user edits (used by story 8 undo, story 3 echo-avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Written to `meta.schemaVersion` by {@link initDoc}; story 4 migrates from it. */
export const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

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

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as unknown as Y.Map<Y.Map<unknown>>;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return finite(value) ? value : fallback;
}

/** Highest `z` in the document (0 when it holds no objects). */
function maxZ(objects: Y.Map<Y.Map<unknown>>): number {
  let max = 0;
  for (const m of objects.values()) {
    const z = m.get('z');
    if (finite(z) && z > max) max = z;
  }
  return max;
}

/**
 * True when nothing renders above `id`: the render order is `(z, id)`, so an
 * equal `z` with a larger id (possible once story 3 syncs concurrent creates)
 * still counts as being on top.
 */
function isTopmost(objects: Y.Map<Y.Map<unknown>>, id: string): boolean {
  const self = objects.get(id);
  if (!self) return false;
  const z = numberOr(self.get('z'), 0);
  for (const [otherId, other] of objects) {
    if (otherId === id) continue;
    const otherZ = numberOr(other.get('z'), 0);
    if (otherZ > z) return false;
    if (otherZ === z && otherId > id) return false;
  }
  return true;
}

/**
 * Ensure the document carries the current schema. Sets `meta.schemaVersion`
 * only when absent, so re-running it (and future migrations) is idempotent.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Add a sticky note centred on the world point `at` (so its top-left is
 * `at − STICKY_SIZE_WORLD / 2`) on top of all other notes.
 *
 * Returns the new id, or `''` (falsy) when the point is not finite or the
 * colour is not one of the six presets — nothing is written in that case.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!at || !finite(at.x) || !finite(at.y)) return '';
  if (!isStickyColor(color)) return '';

  let id = '';
  doc.transact(() => {
    const objects = objectsMap(doc);
    id = crypto.randomUUID();
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', maxZ(objects) + 1);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note to world coordinates (top-left). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finite(x) || !finite(y)) return false;
  const note = objectsMap(doc).get(id);
  if (!note) return false;
  if (note.get('x') === x && note.get('y') === y) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other object. No-op when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note) return false;
  if (isTopmost(objects, id)) return false;
  doc.transact(() => {
    note.set('z', maxZ(objects) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour. Unknown colour names and stale ids are rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectsMap(doc).get(id);
  if (!note) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  const note = objects.get(id);
  if (!note) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's shared text, or `undefined` for a stale id or other object type. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsMap(doc).get(id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable view of the board for rendering, sorted by `(z, id)` — bottom first.
 * Objects whose `type` this build does not know are skipped.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, note] of objectsMap(doc)) {
    if (note.get('type') !== 'sticky') continue;
    const color = note.get('color');
    const text = note.get('text');
    out.push({
      id,
      type: 'sticky',
      x: numberOr(note.get('x'), 0),
      y: numberOr(note.get('y'), 0),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: numberOr(note.get('z'), 0),
      createdAt: numberOr(note.get('createdAt'), 0),
    });
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
