import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from './config';
import type { StickyColor } from './config';

/**
 * The board document model.
 *
 * Schema (this is the format story 4 persists and story 3 puts on the wire):
 *
 *   Y.Doc
 *     meta: Y.Map { schemaVersion: 1 }
 *     objects: Y.Map<string /* id *\/, Y.Map>
 *       <id>: Y.Map {
 *         type: 'sticky'
 *         x: number, y: number   // top-left, world units
 *         color: StickyColor
 *         text: Y.Text
 *         z: number              // stacking; higher is on top
 *         createdAt: number      // epoch ms
 *       }
 *
 * This module is framework-free on purpose: the Durable Object (story 4) imports
 * it for validation and migration.
 */

/** Name of the Y.Map holding all board objects. */
export const OBJECTS_MAP_NAME = 'objects';
/** Name of the Y.Map holding document metadata. */
export const META_MAP_NAME = 'meta';
/** Version of the document schema written to `meta.schemaVersion`. */
export const SCHEMA_VERSION = 1;

/** Origin tag for every local mutation (story 8 undo, story 3 echo avoidance). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left corner in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order, higher is on top. */
  z: number;
  createdAt: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

type ObjectMap = Y.Map<unknown>;

function objectsOf(doc: Y.Doc): Y.Map<ObjectMap> {
  // Y.Map<T> generics are invariant, so cast through unknown
  return doc.getMap(OBJECTS_MAP_NAME) as unknown as Y.Map<ObjectMap>;
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);
}

function fieldsOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const value = objectsOf(doc).get(id);
  return value instanceof Y.Map ? value : undefined;
}

function stickyFieldsOf(doc: Y.Doc, id: string): ObjectMap | undefined {
  const fields = fieldsOf(doc, id);
  if (!fields || fields.get('type') !== 'sticky') return undefined;
  return fields;
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function maxZ(objects: Y.Map<ObjectMap>): number {
  let max = 0;
  objects.forEach((value) => {
    if (value instanceof Y.Map) {
      const z = value.get('z');
      if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
    }
  });
  return max;
}

/** Id of the object drawn on top: highest z, ties broken by id (same on every client). */
function topmostId(objects: Y.Map<ObjectMap>): string | undefined {
  let bestId: string | undefined;
  let bestZ = -Infinity;
  objects.forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    const z = value.get('z');
    const zValue = typeof z === 'number' && Number.isFinite(z) ? z : -Infinity;
    if (zValue > bestZ || (zValue === bestZ && bestId !== undefined && id > bestId)) {
      bestZ = zValue;
      bestId = id;
    }
  });
  return bestId;
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for hosts without crypto.randomUUID (never expected in browsers/Workers)
  let id = '';
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  for (let i = 0; i < 16; i++) id += bytes[i].toString(16).padStart(2, '0');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Record the schema version if the document does not have one yet. Idempotent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_MAP_NAME);
  doc.getMap(OBJECTS_MAP_NAME);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on the world point `at` (the stored x,y is the
 * top-left, i.e. `at` minus half the note size), on top of all other notes.
 * Returns the new id, or '' when rejected (non-finite point, unknown colour).
 */
export function createSticky(doc: Y.Doc, at: WorldPoint, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!at || !isFinitePoint(at.x, at.y)) return '';
  if (!isStickyColor(color)) return '';

  const objects = objectsOf(doc);
  const id = newId();
  const z = maxZ(objects) + 1;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const createdAt = Date.now();

  doc.transact(() => {
    const fields = new Y.Map<unknown>();
    fields.set('type', 'sticky');
    fields.set('x', x);
    fields.set('y', y);
    fields.set('color', color);
    fields.set('text', new Y.Text(''));
    fields.set('z', z);
    fields.set('createdAt', createdAt);
    objects.set(id, fields);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move an object to world (x, y). False when rejected, unknown id or nothing changed. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const fields = fieldsOf(doc, id);
  if (!fields) return false;
  if (fields.get('x') === x && fields.get('y') === y) return false;

  doc.transact(() => {
    fields.set('x', x);
    fields.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise an object above every other object. False when it is already on top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const fields = fieldsOf(doc, id);
  if (!fields) return false;
  if (topmostId(objects) === id) return false;

  const z = maxZ(objects) + 1;
  doc.transact(() => {
    fields.set('z', z);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a sticky note's colour. Text, position, stacking and selection are untouched. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const fields = stickyFieldsOf(doc, id);
  if (!fields) return false;
  if (fields.get('color') === color) return false;

  doc.transact(() => {
    fields.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object from the board. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsOf(doc);
  const fields = fieldsOf(doc, id);
  if (!fields) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The Y.Text of a sticky note (shared live in story 3), or undefined when absent. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const fields = stickyFieldsOf(doc, id);
  if (!fields) return undefined;
  const text = fields.get('text');
  return text instanceof Y.Text ? text : undefined;
}

function toSnapshot(id: string, fields: ObjectMap): StickySnapshot | undefined {
  const x = fields.get('x');
  const y = fields.get('y');
  const z = fields.get('z');
  const color = fields.get('color');
  const createdAt = fields.get('createdAt');
  const text = fields.get('text');
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return {
    id,
    type: 'sticky',
    x,
    y,
    color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
    text: text instanceof Y.Text ? text.toString() : '',
    z: typeof z === 'number' && Number.isFinite(z) ? z : 0,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/**
 * Immutable render model: every known sticky note, sorted by (z, id) so all
 * clients agree on stacking even for equal z values. Unknown object types
 * (stories 9-12) are skipped rather than throwing.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = objectsOf(doc);
  const notes: StickySnapshot[] = [];
  objects.forEach((value, id) => {
    if (!(value instanceof Y.Map)) return;
    if (value.get('type') !== 'sticky') return;
    const snap = toSnapshot(id, value);
    if (snap) notes.push(snap);
  });
  notes.sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}
