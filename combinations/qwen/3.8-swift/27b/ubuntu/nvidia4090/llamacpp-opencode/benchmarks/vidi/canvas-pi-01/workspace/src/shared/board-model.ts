// Board document model (see spec: board.model).
//
// All board objects live in a Yjs Y.Doc:
//   meta: Y.Map { schemaVersion: 1 }
//   objects: Y.Map<id, Y.Map>
//     <id>: { type, x, y, color, text: Y.Text, z, createdAt }
//
// Framework-free: this module owns the schema and every mutation so the same
// code can later run in the Durable Object (story 4) and validate/migrate
// documents. Story 3 attaches a network provider; story 4 persists the same
// document. Every successful mutation is exactly one doc.transact(_, LOCAL_ORIGIN);
// rejections return false before opening a transaction.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Transaction origin for all local mutations (story 8 undo, story 3 echo filter). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local');

/** Immutable, renderable view of one sticky note. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left of the note in world units. */
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
}

const META = 'meta';
const OBJECTS = 'objects';
const SCHEMA_VERSION = 1;

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS);
}

/** Set meta.schemaVersion if absent (never overwrites an existing value). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META);
  if (meta.get('schemaVersion') === undefined) {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Highest z among all objects (0 when the board is empty). */
function maxZ(doc: Y.Doc): number {
  let top = 0;
  for (const object of objects(doc).values()) {
    const z = object.get('z');
    if (typeof z === 'number' && z > top) top = z;
  }
  return top;
}

/** Create a sticky (default colour) centred on `at`; returns the new id. */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const object = new Y.Map();
    object.set('type', 'sticky');
    object.set('x', at.x - STICKY_SIZE_WORLD / 2);
    object.set('y', at.y - STICKY_SIZE_WORLD / 2);
    object.set('color', color);
    object.set('text', new Y.Text());
    object.set('z', maxZ(doc) + 1);
    object.set('createdAt', Date.now());
    objects(doc).set(id, object);
  }, LOCAL_ORIGIN);
  return id;
}

/** Move a note's top-left to world (x, y). False when unknown id or non-finite input. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const object = objects(doc).get(id);
  if (object === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  doc.transact(() => {
    object.set('x', x);
    object.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above all others (z = maxZ + 1). False when unknown or already top. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const object = objects(doc).get(id);
  if (object === undefined) return false;
  const z = object.get('z');
  if (typeof z === 'number' && z >= maxZ(doc)) return false;
  doc.transact(() => {
    object.set('z', maxZ(doc) + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Change a note's colour by name. False for unknown colours or ids. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const object = objects(doc).get(id);
  if (object === undefined || !isStickyColor(color)) return false;
  doc.transact(() => {
    object.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note. False when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const object = objects(doc).get(id);
  if (object === undefined) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's editable Y.Text, if the note exists. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const object = objects(doc).get(id);
  if (object === undefined) return undefined;
  const text = object.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * All sticky notes, sorted by (z, id) — equal z (possible once story 3 syncs
 * concurrent edits) breaks ties by id so every client renders the same order.
 * Objects of unknown `type` are skipped (forward compatibility, stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const notes: StickySnapshot[] = [];
  for (const [id, object] of objects(doc)) {
    if (object.get('type') !== 'sticky') continue;
    const x = object.get('x');
    const y = object.get('y');
    const z = object.get('z');
    const color = object.get('color');
    const text = object.get('text');
    const createdAt = object.get('createdAt');
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      !isStickyColor(color) ||
      !(text instanceof Y.Text) ||
      typeof createdAt !== 'number'
    ) {
      continue;
    }
    notes.push({ id, type: 'sticky', x, y, color, text: text.toString(), z, createdAt });
  }
  notes.sort((a, b) => (a.z === b.z ? (a.id < b.id ? -1 : 1) : a.z - b.z));
  return notes;
}
