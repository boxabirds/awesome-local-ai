/**
 * Board document model: the Yjs schema and every mutation the board performs.
 *
 * Framework-free on purpose — the client imports it now, and from story 4 the
 * Durable Object uses the same module for validation and migration. The schema
 * below is the future persisted (story 4) and wire (story 3) format, which is
 * why `meta.schemaVersion` exists from day one.
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<id, Y.Map>, one entry per object:
 *       type: 'sticky'
 *       x: number, y: number     // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number                // stacking; higher is on top
 *       createdAt: number        // epoch ms
 *
 * Every successful mutation runs in one `doc.transact(fn, LOCAL_ORIGIN)`;
 * rejections (stale id, unknown colour, non-finite coordinates, pointless
 * bringToFront) return `false` before opening a transaction and emit no
 * update. The module never throws for user-driven input.
 */

import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';

/** Document keys of the board schema. */
export const META_KEY = 'meta';
export const OBJECTS_KEY = 'objects';

/** Current document format version (story 4 migrates from older ones). */
export const SCHEMA_VERSION = 1;

/** Note type key; the renderer skips entries of any other type. */
export const STICKY_TYPE = 'sticky';

/**
 * Transaction origin for mutations done by this client. Story 8 wires undo
 * managers to it and story 3 uses it to avoid echoing changes back.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** A note as rendered: the immutable view of one `objects` entry. */
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

type ObjectMap = Y.Map<unknown>;

/** True for values that can safely be written as coordinates. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

/** The entry for `id`, or undefined when it is missing or not a Y.Map. */
function objectOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const entry = objectsOf(doc).get(id);
  return entry instanceof Y.Map ? entry : undefined;
}

/** True when `color` is one of the six configured colour names. */
function isStickyColor(color: unknown): color is StickyColor {
  return typeof color === 'string' && Object.hasOwn(STICKY_COLORS, color);
}

/** Current `z` of an entry, or 0 when absent/non-finite. */
function zOf(entry: ObjectMap): number {
  return typeof entry.get('z') === 'number' ? (entry.get('z') as number) : 0;
}

/** Highest `z` in the document; 0 for an empty document, so the first z is 1. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    if (entry instanceof Y.Map) max = Math.max(max, zOf(entry));
  }
  return max;
}

/**
 * Prepare the document: sets `meta.schemaVersion` when absent, in one
 * transaction. Calling it again on an initialised doc changes nothing.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a yellow (unless recoloured now) sticky note *centred* on `at`
 * (world units), on top of every other note. The stored `x`/`y` are the
 * top-left, i.e. `at` minus half the note size.
 *
 * Returns the new id, or `false` when the coordinates are not finite
 * (TC-39) — the design contract allows `createSticky` to reject input, so its
 * return type is `string | false` rather than a bare `string`.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;

  const id = crypto.randomUUID();
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const z = maxZ(doc) + 1;
  const createdAt = Date.now();

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', STICKY_TYPE);
    note.set('x', x);
    note.set('y', y);
    note.set('color', color);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', createdAt);
    objectsOf(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move an object to world coordinates (top-left). */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const note = objectOf(doc, id);
  if (!note) return false;
  if (note.get('x') === x && note.get('y') === y) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Restack `id` above every other object. `false` when the note is already
 * topmost (its `z` equals the maximum) so a drag over one's own note costs
 * story 3 no sync traffic.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = objectOf(doc, id);
  if (!note) return false;
  const z = zOf(note);
  if (z >= maxZ(doc)) return false;
  const next = maxZ(doc) + 1;
  doc.transact(() => {
    note.set('z', next);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Set the note colour (sticky.color). Text, position, stacking and any local
 * selection are untouched; unknown colour names and stale ids are rejected
 * without a transaction.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const note = objectOf(doc, id);
  if (!note || note.get('type') !== STICKY_TYPE) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove the object from `objects` (sticky.delete). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The `Y.Text` holding the note's text, for text editing to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectOf(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function toSnapshot(id: string, entry: ObjectMap): StickySnapshot | undefined {
  if (entry.get('type') !== STICKY_TYPE) return undefined; // unknown type: skipped (TC-12)
  const x = entry.get('x');
  const y = entry.get('y');
  const z = entry.get('z');
  const createdAt = entry.get('createdAt');
  const color = entry.get('color');
  const text = entry.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  if (!isFiniteNumber(createdAt)) return undefined;
  if (!isStickyColor(color)) return undefined;
  return {
    id,
    type: STICKY_TYPE,
    x,
    y,
    color,
    text: text instanceof Y.Text ? text.toString() : '',
    z,
    createdAt,
  };
}

/**
 * The notes to render, sorted by `(z, id)` so equal `z` values — possible
 * once story 3 syncs concurrent creation — still order identically on every
 * client. Unknown object types are skipped (forward compatibility for
 * stories 9–12). Immutable until the document changes.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!(entry instanceof Y.Map)) continue;
    const note = toSnapshot(id, entry);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.z - b.z));
  return notes;
}
