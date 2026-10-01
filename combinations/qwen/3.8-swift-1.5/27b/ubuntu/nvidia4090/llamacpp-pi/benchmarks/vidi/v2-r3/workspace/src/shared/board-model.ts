import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_COLORS,
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_SIZE,
  isTextSize,
  type StickyColor,
} from './config';
import { rectContains, type Rect } from './geometry';
import type { TextSnapshot } from './objects/text';
import type { ShapeSnap } from './objects/shape';
import { readShapeSnap } from './objects/shape';
import { readStrokeSnap, type StrokeSnap } from './objects/stroke';
import type { ConnectorSnap } from './geometry/connector-geometry';
import { readConnectorSnaps, detachConnectorsTo } from './objects/connector';
import type { ImageSnap } from './objects/image';
import { readImageSnap } from './objects/image';

/**
 * Origin for local (this client) transactions.
 * Story 8 (undo) and story 3 (sync echo avoidance) key off this.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local-origin');

/**
 * Story 7: the read-only base shape every board object has. `snapshot()`
 * stays sticky-only (story 2 contract); future types flow through the same
 * doc schema ({type, x, y, z} + type fields) and can opt into the snapshot
 * later. `width`/`height` are optional: pre-story-7 stickies (and any type
 * without an explicit size) fall back to `STICKY_SIZE_WORLD` in
 * `objectBounds`.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  color: StickyColor;
  text: string;
  createdAt: number;
}

/** Every object type this client can render (story 12 adds image). */
export type BoardObjectSnapshot = StickySnapshot | TextSnapshot | ShapeSnap | ConnectorSnap | StrokeSnap | ImageSnap;

/** Document schema version (persisted format in story 4, wire format in story 3). */
const SCHEMA_VERSION = 1;
const OBJECT_TYPE_STICKY = 'sticky';

/**
 * Object types known to this client. Populated as a side effect of the
 * client-side type registry (story 7) registering each type; used by
 * `allObjectIds` so generic selection never picks objects whose type this
 * client cannot render (sel.all_types).
 */
const knownObjectTypes = new Set<string>();

export function registerKnownObjectType(type: string): void {
  knownObjectTypes.add(type);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isStickyColor(c: unknown): c is StickyColor {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, c);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

function objectMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return objectsMap(doc).get(id);
}

/** Highest z among all objects, or 0 when the board is empty. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  for (const m of objectsMap(doc).values()) {
    const z = m.get('z');
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return max;
}

/**
 * Ensure the document has its meta block. Idempotent: sets `meta.schemaVersion`
 * only if absent, so calling it on an already-initialised doc is a no-op.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', SCHEMA_VERSION);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (world units). The note's top-left is
 * placed at `at - STICKY_SIZE_WORLD/2` and it is stacked on top (z = maxZ + 1).
 * Returns the new id, or `false` if the coordinates are not finite.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string | false {
  if (!isFiniteNumber(at.x) || !isFiniteNumber(at.y)) return false;
  if (!isStickyColor(color)) return false;
  const id = crypto.randomUUID();
  const text = new Y.Text();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', OBJECT_TYPE_STICKY);
    m.set('x', at.x - STICKY_SIZE_WORLD / 2);
    m.set('y', at.y - STICKY_SIZE_WORLD / 2);
    m.set('color', color);
    m.set('text', text);
    m.set('z', maxZ(doc) + 1);
    m.set('createdAt', Date.now());
    objectsMap(doc).set(id, m);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move an object's top-left to world `(x, y)`. Returns `true` on success,
 * `false` for a stale id or non-finite coordinates (no transaction in that case).
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('x', x);
    m.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Bring an object to the top of the stack (z = maxZ + 1). Returns `false` for a
 * stale id or when the object is already topmost (no transaction).
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

/**
 * Set a sticky note's colour. Returns `false` for a stale id or an unknown
 * colour name (no transaction). Text, position and stacking are untouched.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isStickyColor(color)) return false;
  const m = objectMap(doc, id);
  if (!m) return false;
  doc.transact(() => {
    m.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove an object. Returns `false` for a stale id (no transaction). */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

/** Return the note's Y.Text, or `undefined` for a stale id. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const m = objectMap(doc, id);
  if (!m) return undefined;
  const t = m.get('text');
  return t instanceof Y.Text ? t : undefined;
}

const OBJECT_TYPE_TEXT = 'text';

function sortSnapshots(out: BoardObjectSnapshot[]): BoardObjectSnapshot[] {
  out.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * Read an immutable, render-ready snapshot of EVERY object this client knows
 * (stickies and, story 9, text), sorted by `(z, id)` so equal-z ties
 * (possible once story 3 syncs) resolve identically on every client. Unknown
 * object types are skipped (forward compatibility).
 */
export function objects(doc: Y.Doc): readonly BoardObjectSnapshot[] {
  const out: BoardObjectSnapshot[] = [];
  for (const [id, m] of objectsMap(doc).entries()) {
    const type = m.get('type');
    const x = m.get('x');
    const y = m.get('y');
    const z = m.get('z');
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) continue;
    const width = m.get('width');
    const height = m.get('height');
    if (type === OBJECT_TYPE_STICKY) {
      const createdAt = m.get('createdAt');
      const color = m.get('color');
      const text = m.get('text');
      const snap: StickySnapshot = {
        id,
        type: 'sticky',
        x,
        y,
        color: isStickyColor(color) ? color : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z,
        createdAt: isFiniteNumber(createdAt) ? createdAt : 0,
      };
      if (isFiniteNumber(width)) snap.width = width;
      if (isFiniteNumber(height)) snap.height = height;
      out.push(snap);
    } else if (type === OBJECT_TYPE_TEXT) {
      const text = m.get('text');
      const size = m.get('size');
      const widthMode = m.get('widthMode');
      const snap: TextSnapshot = {
        id,
        type: 'text',
        x,
        y,
        z,
        text: text instanceof Y.Text ? text.toString() : '',
        size: isTextSize(size) ? size : DEFAULT_TEXT_SIZE,
        widthMode: widthMode === 'fixed' ? 'fixed' : 'auto',
      };
      // The text box is always stored (created with an estimate, then
      // measured); keep it so selection bounds never fall back to sticky size.
      if (isFiniteNumber(width)) snap.width = width;
      if (isFiniteNumber(height)) snap.height = height;
      out.push(snap);
    } else if (type === 'shape') {
      const snap = readShapeSnap(doc, id, m);
      if (snap) out.push(snap);
    } else if (type === 'stroke') {
      const snap = readStrokeSnap(id, m);
      if (snap) out.push(snap);
    } else if (type === 'image') {
      const snap = readImageSnap(doc, id, m);
      if (snap) out.push(snap);
    }
    // Connector types are handled separately below (they need all rects).
  }
  // Story 10: connectors are added after all other objects so they can
  // resolve their endpoints against the full set of rects.
  const connectors = readConnectorSnaps(doc);
  for (const { snap } of connectors) {
    out.push(snap);
  }
  return sortSnapshots(out);
}

/**
 * Read an immutable, render-ready snapshot of all sticky notes, sorted by
 * `(z, id)` (story 2 contract; story 9 clients use `objects()` for the full
 * set). Unknown object types are skipped (forward compatibility).
 */
export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return objects(doc).filter((o): o is StickySnapshot => o.type === 'sticky');
}

/**
 * Story 7 (sel.geometry_ops): bounds of an object in world units.
 * Objects without explicit width/height (legacy stickies, types that do not
 * declare a size) fall back to STICKY_SIZE_WORLD — the current rendering
 * size of a standard sticky.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return {
    x: obj.x,
    y: obj.y,
    width: isFiniteNumber(obj.width) ? obj.width : STICKY_SIZE_WORLD,
    height: isFiniteNumber(obj.height) ? obj.height : STICKY_SIZE_WORLD,
  };
}

/** Ids of objects lying entirely inside `rect` (marquee, TC-07). */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const out: string[] = [];
  for (const obj of snapshot) {
    if (rectContains(rect, objectBounds(obj))) out.push(obj.id);
  }
  return out;
}

/** Ids of objects whose type is known to this client (Ctrl/Cmd+A, TC-08). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((o) => knownObjectTypes.has(o.type)).map((o) => o.id);
}

/**
 * Set world positions of several objects in ONE transaction (sel.group_move).
 * Returns the number of objects actually changed. Missing ids are skipped;
 * non-finite positions are rejected (0, no transaction).
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, { x: number; y: number }>): number {
  if (positions.size === 0) return 0;
  const objects = objectsMap(doc);
  const present: Array<[Y.Map<unknown>, number, number]> = [];
  for (const [id, p] of positions) {
    if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return 0;
    const m = objects.get(id);
    if (!m) continue; // deleted remotely → skip, never recreate
    present.push([m, p.x, p.y]);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const [m, x, y] of present) m.set('x', x), m.set('y', y);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Set world rects (x/y/width/height) of several objects in ONE transaction
 * (sel.resize). Missing ids are skipped; non-finite values are rejected.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;
  const objects = objectsMap(doc);
  const present: Array<[Y.Map<unknown>, number, number, number, number]> = [];
  for (const [id, r] of rects) {
    if (
      !isFiniteNumber(r.x) ||
      !isFiniteNumber(r.y) ||
      !isFiniteNumber(r.width) ||
      !isFiniteNumber(r.height)
    ) {
      return 0;
    }
    const m = objects.get(id);
    if (!m) continue;
    present.push([m, r.x, r.y, r.width, r.height]);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    for (const [m, x, y, w, h] of present) {
      m.set('x', x);
      m.set('y', y);
      m.set('width', w);
      m.set('height', h);
    }
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Raise every given object above all unselected objects in ONE transaction,
 * preserving their relative stacking order (sel.bring_to_front).
 * Returns the number of objects whose z actually changed (0 = no transaction).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const selected = new Map<string, Y.Map<unknown>>();
  for (const id of ids) {
    const m = objects.get(id);
    if (!m) continue; // deleted remotely → skip
    selected.set(id, m);
  }
  if (selected.size === 0) return 0;

  let maxSelectedZ = -Infinity;
  for (const m of selected.values()) {
    const z = m.get('z');
    if (isFiniteNumber(z)) maxSelectedZ = Math.max(maxSelectedZ, z);
  }
  let maxOtherZ = -Infinity;
  for (const [id, obj] of objects) {
    if (selected.has(id)) continue;
    const z = obj.get('z');
    if (isFiniteNumber(z)) maxOtherZ = Math.max(maxOtherZ, z);
  }
  if (maxSelectedZ >= maxOtherZ) return 0; // nothing to do → no transaction

  // Rebase the selected objects above all others, keeping relative order.
  const ordered = [...selected.values()].sort((a, b) => {
    const za = a.get('z');
    const zb = b.get('z');
    return (isFiniteNumber(za) ? za : 0) - (isFiniteNumber(zb) ? zb : 0);
  });
  doc.transact(() => {
    ordered.forEach((m, i) => m.set('z', maxOtherZ + 1 + i));
  }, LOCAL_ORIGIN);
  return ordered.length;
}

/** Delete several objects in ONE transaction (sel.delete_group). Returns count removed. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const present: string[] = [];
  for (const id of ids) {
    if (objects.get(id) !== undefined) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Story 10: detach connector ends attached to deleted objects BEFORE removing them.
    detachConnectorsTo(doc, present);
    for (const id of present) objects.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}
