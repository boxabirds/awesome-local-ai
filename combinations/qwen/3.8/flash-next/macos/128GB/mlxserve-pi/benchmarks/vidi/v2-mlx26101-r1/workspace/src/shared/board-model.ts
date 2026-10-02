// Yjs board document model. See the board.model contract.
//
// The document is the single source of truth for board objects. It is stored in
// a Y.Doc from day one so story 3 only attaches a network provider and story 4
// only persists the same document. This module is framework-free so the Durable
// Object (story 4) can import it for validation/migration.
//
// Schema:
//   meta:    Y.Map { schemaVersion: 1 }
//   objects: Y.Map<string, Y.Map> where each value is
//            { type:'sticky', x, y, color, text: Y.Text, z, createdAt }
//
// Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)` so
// story 8's undo manager sees one reversible operation per user action and
// story 3's provider can skip echoing local changes. Every rejection (stale id,
// unknown colour, non-finite coordinates, pointless bring-to-front) returns
// false *before* opening a transaction, so it emits no `update` event.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * Transaction origin for local (this client's) mutations. Story 8's undo manager
 * and story 3's provider use it to distinguish local changes from remote ones
 * and avoid echo.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/** Current persisted/wire schema version. */
const SCHEMA_VERSION = 1;

const META = 'meta';
const OBJECTS = 'objects';

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

type ObjectMap = Y.Map<unknown>;
type Objects = Y.Map<Y.Map<unknown>>;

function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META);
}

function objects(doc: Y.Doc): Objects {
  return doc.getMap<Y.Map<unknown>>(OBJECTS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** Return the note's Y.Map only when `id` is an existing sticky object. */
function getSticky(doc: Y.Doc, id: string): ObjectMap | undefined {
  const map = objects(doc).get(id);
  if (!map || map.get('type') !== 'sticky') return undefined;
  return map;
}

/** Highest `z` across all objects that carry a finite numeric z (0 if none). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objects(doc).forEach((obj) => {
    const z = obj.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/**
 * Ensure the document's meta map carries a schemaVersion (the format becomes
 * the persisted/wire contract in stories 3-4, so version it from the start).
 * Idempotent: does nothing (and emits nothing) when already present.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = metaMap(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (top-left = at - size/2), on top of all
 * other notes (z = maxZ + 1). Returns the new id, or `''` when `at` is not a
 * finite point (nothing is written in that case).
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return '';

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id-${Math.random().toString(36).slice(2)}`;

  const half = STICKY_SIZE_WORLD / 2;
  const x = at.x - half;
  const y = at.y - half;

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', x);
    note.set('y', y);
    note.set('color', isStickyColor(color) ? color : DEFAULT_STICKY_COLOR);
    note.set('text', new Y.Text(''));
    note.set('z', maxZ(doc) + 1);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a sticky note to world (x, y). False for a stale id / non-finite input. */
export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const note = getSticky(doc, id);
  if (!note) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/** Raise a note above every other one. No-op (false) when already topmost. */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = getSticky(doc, id);
  if (!note) return false;
  const top = maxZ(doc);
  const currentZ = note.get('z');
  if (currentZ === top) return false; // already topmost: pointless write / sync
  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note. False for a stale id or a colour name not in STICKY_COLORS. */
export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!isStickyColor(color)) return false;
  const note = getSticky(doc, id);
  if (!note) return false;
  doc.transact(() => {
    note.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. False for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const note = getSticky(doc, id);
  if (!note) return false;
  doc.transact(() => {
    objects(doc).delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's Y.Text for live editing, or undefined for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = getSticky(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable render model: sticky objects only (unknown types skipped for forward
 * compatibility with stories 9-12), sorted by (z, id) so every client that ever
 * syncs this document renders the same stacking even if two notes share a z.
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  objects(doc).forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return; // skip unknown / future types
    const text = obj.get('text');
    const color = obj.get('color');
    out.push({
      id,
      type: 'sticky',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
    });
  });
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
