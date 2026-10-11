import * as Y from 'yjs';
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * The board document model (story 2).
 *
 * A board is one `Y.Doc`:
 *
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map> where a sticky note is
 *            { type: 'sticky', x, y, color, text: Y.Text, z, createdAt }
 *
 * The module is framework-free on purpose: the client uses it now, the Durable
 * Object (story 4) imports the same file for validation and migration, and the
 * document itself becomes the wire format (story 3) and the persisted format.
 *
 * Rules every caller can rely on:
 * - every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
 * - rejected input (stale id, unknown colour, non-finite coordinate) and
 *   no-ops return `false` **before** a transaction is opened, so nothing is
 *   broadcast and no `update` event fires;
 * - it never throws for user-driven input.
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/** Origin tag for local mutations (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

export interface StickySnapshot {
  readonly id: string;
  readonly type: 'sticky';
  /** Top-left, world units. */
  readonly x: number;
  readonly y: number;
  readonly color: StickyColor;
  readonly text: string;
  /** Stacking order; higher is drawn on top. */
  readonly z: number;
  readonly createdAt: number;
}

/** A world point (the point a new note is centred on). */
export interface PointLike {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Schema keys
// ---------------------------------------------------------------------------

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';
const FIELD_TYPE = 'type';
const FIELD_X = 'x';
const FIELD_Y = 'y';
const FIELD_COLOR = 'color';
const FIELD_TEXT = 'text';
const FIELD_Z = 'z';
const FIELD_CREATED_AT = 'createdAt';
const FIELD_SCHEMA_VERSION = 'schemaVersion';

const STICKY_TYPE = 'sticky';

type ObjectMap = Y.Map<unknown>;
type ObjectsMap = Y.Map<ObjectMap>;

// ---------------------------------------------------------------------------
// Validation helpers (the same guards the story 4 Durable Object will use)
// ---------------------------------------------------------------------------

function isObjectMap(value: unknown): value is ObjectMap {
  return value instanceof Y.Map;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function isStickyMap(value: unknown): value is ObjectMap {
  return isObjectMap(value) && value.get(FIELD_TYPE) === STICKY_TYPE;
}

function objectsOf(doc: Y.Doc): ObjectsMap {
  return doc.getMap<ObjectMap>(OBJECTS_KEY);
}

function maxZ(objects: ObjectsMap): number {
  let max = 0;
  objects.forEach((value) => {
    if (isObjectMap(value)) {
      const z = value.get(FIELD_Z);
      if (isFiniteNumber(z) && z > max) {
        max = z;
      }
    }
  });
  return max;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Environments without crypto.randomUUID (older runtimes) still get unique ids.
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Read a note into an immutable snapshot, or `undefined` when it is not usable. */
function readSticky(id: string, value: unknown): StickySnapshot | undefined {
  if (!isStickyMap(value)) {
    return undefined;
  }
  const x = value.get(FIELD_X);
  const y = value.get(FIELD_Y);
  const z = value.get(FIELD_Z);
  const color = value.get(FIELD_COLOR);
  const text = value.get(FIELD_TEXT);
  const createdAt = value.get(FIELD_CREATED_AT);
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined;
  }
  return Object.freeze({
    id,
    type: STICKY_TYPE,
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : typeof text === 'string' ? text : '',
    z,
    createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
  });
}

/** Draw order: z ascending, then id, so every client agrees on ties. */
function compareNotes(a: StickySnapshot, b: StickySnapshot): number {
  if (a.z !== b.z) {
    return a.z - b.z;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

/** Mark the document's schema version. Idempotent: never rewrites, never transacts twice. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get(FIELD_SCHEMA_VERSION) !== undefined) {
    return;
  }
  doc.transact(() => {
    meta.set(FIELD_SCHEMA_VERSION, BOARD_SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a sticky note centred on `at` (the stored `x, y` is its top-left),
 * on top of every other object. Returns the new id, or `null` if rejected.
 */
export function createSticky(
  doc: Y.Doc,
  at: PointLike,
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | null {
  if (!at || !isFiniteNumber(at.x) || !isFiniteNumber(at.y)) {
    return null;
  }
  if (!isStickyColor(color)) {
    return null;
  }

  const id = newId();
  const objects = objectsOf(doc);
  const z = maxZ(objects) + 1;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const createdAt = Date.now();

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set(FIELD_TYPE, STICKY_TYPE);
    note.set(FIELD_X, x);
    note.set(FIELD_Y, y);
    note.set(FIELD_COLOR, color);
    note.set(FIELD_TEXT, new Y.Text());
    note.set(FIELD_Z, z);
    note.set(FIELD_CREATED_AT, createdAt);
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note to a new top-left. False when the note is gone or nothing changed. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const note = objectsOf(doc).get(id);
  if (!isStickyMap(note)) {
    return false;
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return false;
  }
  if (note.get(FIELD_X) === x && note.get(FIELD_Y) === y) {
    return false;
  }
  doc.transact(() => {
    note.set(FIELD_X, x);
    note.set(FIELD_Y, y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other object. False when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const note = objects.get(id);
  if (!isStickyMap(note)) {
    return false;
  }

  // "Topmost" is defined by the draw order, so equal-z ties are resolved too.
  const notes: StickySnapshot[] = [];
  objects.forEach((value, key) => {
    const read = readSticky(key, value);
    if (read) {
      notes.push(read);
    }
  });
  notes.sort(compareNotes);
  const top = notes[notes.length - 1];
  if (notes.length <= 1 || (top && top.id === id)) {
    return false;
  }

  const z = maxZ(objects) + 1;
  doc.transact(() => {
    note.set(FIELD_Z, z);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change only the note's colour. False for stale ids and unknown colour names. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) {
    return false;
  }
  const note = objectsOf(doc).get(id);
  if (!isStickyMap(note)) {
    return false;
  }
  if (note.get(FIELD_COLOR) === color) {
    return false;
  }
  doc.transact(() => {
    note.set(FIELD_COLOR, color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. False when it does not exist. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const note = objects.get(id);
  if (!isObjectMap(note)) {
    return false;
  }
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The note's shared text, for the editor to diff into. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = objectsOf(doc).get(id);
  if (!isStickyMap(note)) {
    return undefined;
  }
  const text = note.get(FIELD_TEXT);
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render model, sorted by `(z, id)`. Objects of an unknown `type`
 * (shapes, text, images from stories 9-12) are skipped rather than crashing
 * the renderer.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  objectsOf(doc).forEach((value, id) => {
    const note = readSticky(id, value);
    if (note) {
      notes.push(note);
    }
  });
  notes.sort(compareNotes);
  return Object.freeze(notes);
}
