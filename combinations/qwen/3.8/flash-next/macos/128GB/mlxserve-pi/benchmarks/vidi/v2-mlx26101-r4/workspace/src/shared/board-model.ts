/**
 * The board document model: the Yjs schema and every mutation to it, in one
 * framework-free module.
 *
 * The document is the single source of truth for what is on the board from
 * story 2 onwards, and it is deliberately the *same* document stories 3 and 4
 * sync and persist — hence `meta.schemaVersion`, and hence every successful
 * mutation being exactly one `doc.transact(fn, LOCAL_ORIGIN)`: one transaction
 * is one sync message and one undo step.
 *
 * Because of that the model is framework-free (no React, no DOM): story 4's
 * Durable Object imports this file to validate and migrate documents.
 *
 * Errors are values, never exceptions. A mutation that cannot be applied —
 * stale id, unknown colour, non-finite coordinates, a no-op that would only
 * produce pointless sync traffic — returns `false` and opens no transaction.
 *
 * Schema (see the design's "Document schema"):
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map> where each value is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 * `x`/`y` are the note's top-left in world units; render order sorts by
 * `(z, id)` so clients that merged equal `z` values still agree on stacking.
 */
import * as Y from 'yjs';

import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';

/** Origin of every local mutation; stories 3 and 8 filter on it. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** The schema this build writes; bumped when the document shape changes. */
export const SCHEMA_VERSION = 1;

/** Object discriminator stored on every object. */
export const STICKY_OBJECT_TYPE = 'sticky';

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const STICKY_TYPE = STICKY_OBJECT_TYPE;

/**
 * `createSticky` returns the new id, or this when the note could not be
 * created. It is falsy, so a caller that ignores the failure cannot end up
 * selecting or editing a note that does not exist.
 */
export const NO_ID = '';

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

type ObjectsMap = Y.Map<Y.Map<unknown>>;

function objectsOf(doc: Y.Doc): ObjectsMap {
  return doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
}

/** True for the six known colour names; anything else is not a colour we store. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stickyOf(objects: ObjectsMap, id: string): Y.Map<unknown> | undefined {
  if (id === NO_ID) return undefined;
  const note = objects.get(id);
  if (!(note instanceof Y.Map) || note.get('type') !== STICKY_TYPE) return undefined;
  return note;
}

/** Highest `z` in the document (0 when empty); counts every object, known or not. */
function highestZ(objects: ObjectsMap): number {
  let max = 0;
  for (const object of objects.values()) {
    if (!(object instanceof Y.Map)) continue;
    const z = object.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  }
  return max;
}

/** How many objects sit at exactly this `z` (a tie means "not yet on top"). */
function countAtZ(objects: ObjectsMap, z: number): number {
  let count = 0;
  for (const object of objects.values()) {
    if (object instanceof Y.Map && object.get('z') === z) count += 1;
  }
  return count;
}

function textOf(note: Y.Map<unknown>): Y.Text | undefined {
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Prepare a document for use: records the schema version if it is not there
 * yet. Idempotent, so attaching to a document that arrives from storage or
 * from another client (stories 3-4) changes nothing.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<number>(META_KEY);
  if (meta.has('schemaVersion')) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (the stored `x`/`y` is the top-left, so
 * the point is offset by half the note) and on top of every other object.
 *
 * Returns the new id, or `NO_ID` when the point is not a usable position.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at?.x) || !finite(at?.y)) return NO_ID;

  const objects = objectsOf(doc);
  const id = newId();
  const note = new Y.Map<unknown>();
  const z = highestZ(objects) + 1;

  doc.transact(() => {
    note.set('type', STICKY_TYPE);
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    // An unknown colour would be unreadable data, not a note worth keeping:
    // a new note always starts in a colour the board can render.
    note.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text(''));
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note to a world position. Its top-left becomes `(x, y)`. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!finite(x) || !finite(y)) return false;

  const note = stickyOf(objectsOf(doc), id);
  if (!note) return false;
  // Already there: writing it again would sync and undo-log a change that
  // changed nothing, once per animation frame of a drag.
  if (note.get('x') === x && note.get('y') === y) return false;

  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note above every other object. A note that is already the unique
 * topmost object changes nothing and returns false, so a drag that keeps
 * firing `bringToFront` cannot generate continuous sync traffic in story 3.
 * With a tie for the top (two clients that both picked `maxZ + 1`) there is
 * still a real change to make, so it is applied.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const note = stickyOf(objects, id);
  if (!note) return false;

  const z = note.get('z');
  const max = highestZ(objects);
  if (typeof z === 'number' && z === max && countAtZ(objects, max) === 1) return false;

  doc.transact(() => {
    note.set('z', max + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour and nothing else: text, position, stacking, creation
 * time and (being local) the selection all stay as they were. Unknown colour
 * names and stale ids are rejected.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;

  const note = stickyOf(objectsOf(doc), id);
  if (!note || note.get('color') === color) return false;

  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  if (id === NO_ID || !objects.has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * The note's text as a `Y.Text`, so typing merges character-by-character once
 * the board is shared. Returns undefined for a note that does not exist.
 * A note whose text field is missing or of the wrong type (a document written
 * by a future story) is repaired in place, so the editor always has something
 * to write to.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsOf(doc);
  const note = stickyOf(objects, id);
  if (!note) return undefined;

  const text = textOf(note);
  if (text) return text;

  const replacement = new Y.Text('');
  doc.transact(() => {
    note.set('text', replacement);
  }, LOCAL_ORIGIN);
  return replacement;
}

function readSticky(id: string, note: Y.Map<unknown>): StickySnapshot | null {
  const x = note.get('x');
  const y = note.get('y');
  const z = note.get('z');
  if (!finite(x) || !finite(y) || !finite(z)) return null;

  const storedColor = note.get('color');
  const text = textOf(note);
  const createdAt = note.get('createdAt');

  return Object.freeze({
    id,
    type: 'sticky' as const,
    x,
    y,
    // A colour from a future story must not hide the note: fall back to the
    // default colour rather than dropping user content.
    color: isStickyColor(storedColor) ? storedColor : DEFAULT_STICKY_COLOR,
    text: text ? text.toString() : '',
    z,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  });
}

/**
 * The notes to render, in stacking order: ascending `z`, ties broken by id so
 * every client renders the same order even after a merge produced equal `z`.
 * Objects of unknown `type` are skipped, which keeps this build able to open a
 * document written by a later story (shapes, arrows, text) without losing it.
 *
 * The arrays and note objects are frozen: React renders from them and nothing
 * downstream may edit a snapshot in place.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objectsOf(doc)) {
    if (!(object instanceof Y.Map)) continue;
    if (object.get('type') !== STICKY_TYPE) continue;
    const note = readSticky(id, object);
    if (note) notes.push(note);
  }
  notes.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Object.freeze(notes);
}

/** `crypto.randomUUID()`, with a fallback for environments without WebCrypto. */
function newId(): string {
  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `note-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}
