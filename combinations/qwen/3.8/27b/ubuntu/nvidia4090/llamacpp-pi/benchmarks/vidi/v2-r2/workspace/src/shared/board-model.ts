/**
 * Yjs document schema and all board mutations for vidi6.
 *
 * Story 2 keeps the document in memory; story 3 attaches a network provider
 * and story 4 persists the same document, so this module is the single
 * owner of the schema and every mutation. It is framework-free (no React)
 * so story 4's Durable Object can import it for validation/migration.
 *
 * Schema:
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map (key = id, value = Y.Map)
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number      // top-left, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number                 // stacking; higher is on top
 *       createdAt: number         // epoch ms
 *     }
 */

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/** Transaction origin for all local (non-synced) mutations. */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

/** Immutable view of one sticky note, as rendered by the client. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left of the note in world units. */
  x: number;
  /** Top-left of the note in world units. */
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher is drawn on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
}

const SCHEMA_VERSION = 1;

function objectsOf(doc: Y.Doc): Y.Map<any> {
  return doc.getMap('objects') as Y.Map<any>;
}

/** True when the entry is a Y.Map with type 'sticky'. */
function isSticky(entry: unknown): entry is Y.Map<any> {
  return entry instanceof Y.Map && entry.get('type') === 'sticky';
}

function stickyOf(doc: Y.Doc, id: string): Y.Map<any> | undefined {
  const entry = objectsOf(doc).get(id);
  return isSticky(entry) ? entry : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function knownColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

/** The highest z among all objects (0 when there are none). */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const entry of objectsOf(doc).values()) {
    if (!(entry instanceof Y.Map)) {
      continue;
    }
    const z = entry.get('z');
    if (finiteNumber(z) && z > max) {
      max = z;
    }
  }
  return max;
}

/**
 * Sets `meta.schemaVersion` if absent (idempotent).
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(
      () => {
        meta.set('schemaVersion', SCHEMA_VERSION);
      },
      LOCAL_ORIGIN,
    );
  }
}

/**
 * Creates a sticky note centred on `at` (top-left = at − STICKY_SIZE_WORLD/2)
 * on top of all other notes, and returns its id. Returns `''` (falsy) when
 * the coordinates are not finite; no transaction is opened.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finiteNumber(at.x) || !finiteNumber(at.y)) {
    return '';
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const entry = new Y.Map();
      entry.set('type', 'sticky');
      entry.set('x', at.x - STICKY_SIZE_WORLD / 2);
      entry.set('y', at.y - STICKY_SIZE_WORLD / 2);
      entry.set('color', color);
      entry.set('text', new Y.Text());
      entry.set('z', maxZ(doc) + 1);
      entry.set('createdAt', Date.now());
      objectsOf(doc).set(id, entry);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/**
 * Moves an object to a world position. Returns false (no transaction) for
 * stale ids or non-finite coordinates.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const entry = stickyOf(doc, id);
  if (entry === undefined || !finiteNumber(x) || !finiteNumber(y)) {
    return false;
  }
  doc.transact(
    () => {
      entry.set('x', x);
      entry.set('y', y);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Raises an object's z to maxZ + 1 so it is drawn on top of everything.
 * Returns false (no transaction) for stale ids or when the object is
 * already topmost.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const entry = stickyOf(doc, id);
  if (entry === undefined) {
    return false;
  }
  const z = entry.get('z');
  if (finiteNumber(z) && z === maxZ(doc)) {
    return false; // already topmost: no pointless update
  }
  doc.transact(
    () => {
      entry.set('z', maxZ(doc) + 1);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Sets a sticky note's colour by preset name. Returns false (no
 * transaction) for unknown colour names, stale ids, or when the note
 * already has that colour.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const entry = stickyOf(doc, id);
  if (entry === undefined || !knownColor(color)) {
    return false;
  }
  if (entry.get('color') === color) {
    return false; // no-op
  }
  doc.transact(
    () => {
      entry.set('color', color);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** Removes an object from the board. Returns false for stale ids. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const entry = stickyOf(doc, id);
  if (entry === undefined) {
    return false;
  }
  doc.transact(
    () => {
      objectsOf(doc).delete(id);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The Y.Text of a sticky note, or undefined for stale/unknown ids. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const entry = stickyOf(doc, id);
  if (entry === undefined) {
    return undefined;
  }
  const text = entry.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Stable render order: (createdAt, id). The board renders notes in this
 * order so the DOM never reorders while a drag is in flight — a DOM move
 * releases pointer capture and kills the drag. Stacking is expressed purely
 * through CSS z-index (the snapshot's z), which can change freely.
 */
export function renderOrder(
  objects: readonly StickySnapshot[],
): readonly StickySnapshot[] {
  return [...objects].sort((a, b) =>
    a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Immutable snapshots of all sticky notes, sorted by (z, id) so concurrent
 * equal z values give every client the same order. Unknown object types and
 * malformed entries are skipped (forward compatibility for later stories).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, entry] of objectsOf(doc)) {
    if (!isSticky(entry)) {
      continue;
    }
    const x = entry.get('x');
    const y = entry.get('y');
    const z = entry.get('z');
    const color = entry.get('color');
    const createdAt = entry.get('createdAt');
    if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z) || !knownColor(color)) {
      continue;
    }
    const text = entry.get('text');
    out.push({
      id,
      type: 'sticky',
      x,
      y,
      color,
      text: text instanceof Y.Text ? text.toString() : '',
      z,
      createdAt: finiteNumber(createdAt) ? createdAt : 0,
    });
  }
  out.sort((a, b) => {
    if (a.z !== b.z) {
      return a.z - b.z;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
