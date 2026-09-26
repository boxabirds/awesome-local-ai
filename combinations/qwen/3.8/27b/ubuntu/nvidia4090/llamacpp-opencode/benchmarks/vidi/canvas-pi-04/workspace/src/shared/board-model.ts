// Story 2: the Yjs board document model (anchor: board.model).
//
// This module owns the document schema and every mutation. It is
// framework-free (no React) so the Durable Object of story 3 can import it.
// Selection and editing state are deliberately NOT here: they are per-client
// UI state (see useSelection) and must not be stored in the shared document.
//
// Story 3: the Durable Object relays raw Yjs updates; it does not call these
// mutations, but the schema documented here is the wire contract.

import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';

/**
 * Transaction origin for all local (this client's user) mutations.
 * Story 8 (undo) and story 3 (echo avoidance) key off this symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

/** Immutable view of one sticky note, as rendered by React. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left corner in world units. */
  x: number;
  /** Top-left corner in world units. */
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher draws on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
}

const OBJECTS_KEY = 'objects';
const META_KEY = 'meta';
const SCHEMA_VERSION = 1;

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(OBJECTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/** Set `meta.schemaVersion = 1` when absent. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(
    () => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    },
    LOCAL_ORIGIN,
  );
}

function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && value in STICKY_COLORS;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Create a yellow-by-default sticky centred on `at`, on top of everything,
 * and return its new id. Returns '' (no object, no update) when the
 * coordinates or colour are invalid.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
  if (!isStickyColor(color)) return '';

  // z = maxZ + 1 (0 when the board is empty, so the first note gets z 1).
  let z = 1;
  for (const obj of objectsMap(doc).values()) {
    const existing = asNumber(obj.get('z'), 0);
    if (existing >= z) z = existing + 1;
  }

  const id = crypto.randomUUID();
  const text = new Y.Text();
  const obj = new Y.Map();
  obj.set('type', 'sticky');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('color', color);
  obj.set('text', text);
  obj.set('z', z);
  obj.set('createdAt', Date.now());
  doc.transact(
    () => {
      objectsMap(doc).set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** Move an object's top-left to world (x, y); false (no update) when rejected. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const obj = objectsMap(doc).get(id);
  if (obj === undefined) return false;
  doc.transact(
    () => {
      obj.set('x', x);
      obj.set('y', y);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Raise an object above all others (z = maxZ + 1). No-op (false, no update)
 * when the object is already topmost or the id is unknown.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined) return false;
  const z = obj.get('z');
  if (typeof z !== 'number' || !Number.isFinite(z)) return false;

  let maxZ = 0;
  for (const other of objectsMap(doc).values()) {
    const oz = asNumber(other.get('z'), 0);
    if (oz > maxZ) maxZ = oz;
  }
  if (z >= maxZ) return false; // already topmost: no pointless update

  doc.transact(
    () => {
      obj.set('z', maxZ + 1);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** Set a sticky's colour to a preset colour name; false (no update) when rejected. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const obj = objectsMap(doc).get(id);
  if (obj === undefined) return false;
  if (obj.get('color') === color) return false; // no-op: no update

  doc.transact(
    () => {
      obj.set('color', color);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/**
 * Create a sticky note at an explicit world position. The client UI uses
 * createSticky (which derives the position from the viewport); the
 * worker-side integration tests use createStickyAt to script precise
 * positions.
 */
export function createStickyAt(
  doc: Y.Doc,
  x: number,
  y: number,
  color: string = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`createStickyAt: non-finite position (${x}, ${y})`);
  }
  if (!isStickyColor(color)) {
    throw new Error(`createStickyAt: unknown colour ${String(color)}`);
  }
  const id = crypto.randomUUID();
  doc.transact(
    () => {
      const map = objectsMap(doc);
      const obj = new Y.Map<unknown>();
      let maxZ = 0;
      for (const other of map.values()) {
        const oz = asNumber(other.get('z'), 0);
        if (oz > maxZ) maxZ = oz;
      }
      obj.set('id', id);
      obj.set('type', 'sticky');
      obj.set('x', x);
      obj.set('y', y);
      obj.set('color', color);
      obj.set('text', new Y.Text());
      obj.set('z', maxZ + 1);
      obj.set('createdAt', Date.now());
      map.set(id, obj);
    },
    LOCAL_ORIGIN,
  );
  return id;
}

/** Remove an object by id; false (no update) when the id is unknown. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  if (objectsMap(doc).get(id) === undefined) return false;
  doc.transact(
    () => {
      objectsMap(doc).delete(id);
    },
    LOCAL_ORIGIN,
  );
  return true;
}

/** The live Y.Text of a sticky, or undefined for unknown ids / other types. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const obj = objectsMap(doc).get(id);
  if (obj === undefined || obj.get('type') !== 'sticky') return undefined;
  const text = obj.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id); objects with an
 * unknown `type` are skipped (forward compatibility with stories 9-12).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const [id, obj] of objectsMap(doc).entries()) {
    if (obj.get('type') !== 'sticky') continue;
    const text = obj.get('text');
    const color = obj.get('color');
    out.push({
      id,
      type: 'sticky',
      x: asNumber(obj.get('x'), 0),
      y: asNumber(obj.get('y'), 0),
      color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
      text: text instanceof Y.Text ? text.toString() : '',
      z: asNumber(obj.get('z'), 0),
      createdAt: asNumber(obj.get('createdAt'), 0),
    });
  }
  out.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
