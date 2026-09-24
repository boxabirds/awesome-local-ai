/**
 * Story 2 · the board document model (design "Board document model").
 *
 * A framework-free module that owns every mutation of the shared document. It
 * is written against a real `Y.Doc` so the exact same code will, in story 3,
 * be synced between people and, in story 4, persisted by the Durable Object —
 * hence `meta.schemaVersion` and the transaction origin.
 *
 * Document schema:
 *   meta:    Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<id, Y.Map { type, x, y, color, text: Y.Text, z, createdAt }>
 *
 * The module never throws for user-driven input: a stale id, an unknown colour
 * or a non-finite coordinate returns `false` and opens no transaction (so no
 * pointless update / sync traffic). A successful mutation is exactly one
 * `doc.transact(fn, LOCAL_ORIGIN)`.
 */
import * as Y from 'yjs';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from './config';
import { rectContains, type Rect } from './geometry';
import { connectorBBox, resolveEndpoints } from './geometry/connector-geometry';
import {
  LOCAL_ORIGIN,
  finite,
  newId,
  objectsOf,
  readSize,
  rectOfRecord,
  recordIsType,
  topZ,
} from './doc';
import { readConnector, detachConnectorsTo, type ConnectorSnap } from './objects/connector';
import type { ShapeKind } from './objects/shape';
import type { ShapeFill, ShapeStroke } from './config';

/**
 * The object types the board renderer knows how to show. Select-all and
 * marquee only ever pick types from this set, so a `type` written by a newer
 * client (stories 9–12) never becomes selectable or resolvable until its
 * registry entry is registered here (PRD `sel.all_types`, TC-08).
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set(['sticky', 'text', 'shape', 'connector']);

/**
 * Transaction origin for local edits. Story 8's undo manager and story 3's
 * provider distinguish local from remote changes by origin, so every local
 * mutation is tagged with this single symbol. It now lives in `doc.ts` (the
 * object modules need it too) and is re-exported here — the SAME symbol, since
 * undo and the provider filter on its identity.
 */
export { LOCAL_ORIGIN } from './doc';

/**
 * An immutable view of one board object, safe to hand to React.
 *
 * Story 7 broadened this from sticky-note-only to a generic object snapshot:
 * every object carries a bounding size (`width`/`height`, falling back to the
 * default sticky size when a document predates explicit sizes). The sticky-only
 * fields (`color`, `text`) stay optional so the sticky renderer and the
 * cross-document convergence checks keep working while later-story object types
 * (which have neither) can share the same shape. `StickySnapshot` is kept as an
 * alias so existing imports are unaffected.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  createdAt: number;
  color?: StickyColor;
  text?: string;
  /** Story 9 · free text: the font-size preset key. */
  size?: string;
  /** Story 9 · free text: how the box width is derived. */
  widthMode?: 'auto' | 'fixed';
  /** Story 9 · who created this object (the identity id at create time). */
  createdBy?: string;
  /** Story 10 · shape: which of the three kinds to draw. */
  kind?: ShapeKind;
  /** Story 10 · shape: the fill colour token (`'none'` included). */
  fill?: ShapeFill;
  /** Story 10 · shape: the outline colour token. */
  stroke?: ShapeStroke;
  /** Story 10 · connector: the two stored endpoints… */
  from?: ConnectorSnap['from'];
  /** See {@link ConnectorSnapshot#from}. */
  to?: ConnectorSnap['to'];
  /**
   * Story 10 · connector: the two *resolved* points, so a hit test and a draw
   * share one answer (`distanceToPolyline` reads these).
   */
  ends?: { from: { x: number; y: number }; to: { x: number; y: number } };
}

/** @deprecated Kept for source compatibility; use {@link ObjectSnapshot}. */
export type StickySnapshot = ObjectSnapshot;

/** Story 10 · a connector snapshot carries derived geometry, not stored size. */
export type ConnectorSnapshot = ConnectorSnap;

const META_KEY = 'meta';

type StickyRecord = Y.Map<unknown>;

function objects(doc: Y.Doc): Y.Map<StickyRecord> {
  return objectsOf(doc);
}

function isSticky(record: StickyRecord | undefined): record is StickyRecord {
  return recordIsType(record, 'sticky');
}

/** Ensure the document metadata exists (idempotent: only writes once). */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      if (meta.get('schemaVersion') === undefined) meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

/**
 * Create a sticky note centred on `at` (the top-left is `at` minus half the
 * note size), on top of every other note (z = maxZ + 1). Returns the new id.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  const id = newId();
  const top = topZ(doc) + 1;
  const half = STICKY_SIZE_WORLD / 2;
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - half);
    note.set('y', at.y - half);
    note.set('color', color);
    note.set('text', new Y.Text(''));
    note.set('z', top);
    note.set('createdAt', Date.now());
    objects(doc).set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

/**
 * Move a note to world `(x, y)`. Returns false (no transaction) for a stale
 * id or a non-finite coordinate.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!finite(x, y)) return false;
  if (record.get('x') === x && record.get('y') === y) return false;
  doc.transact(() => {
    record.set('x', x);
    record.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note to the front. Returns false (no transaction) for a stale id or
 * a note that is already the topmost — avoiding pointless sync traffic later.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  const current = record.get('z');
  if (typeof current !== 'number') return false;
  const top = topZ(doc);
  if (current >= top) return false;
  doc.transact(() => {
    record.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Change a note's colour. Rejects an unknown colour name and a no-op recolour
 * (already that colour), returning false without a transaction.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return false;
  if (!Object.prototype.hasOwnProperty.call(STICKY_COLORS, color)) return false;
  if (record.get('color') === color) return false;
  doc.transact(() => {
    record.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** Delete a note. Returns false (no transaction) for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const map = objects(doc);
  if (!map.has(id)) return false;
  doc.transact(() => {
    map.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's `Y.Text`, or undefined if the id is missing or not a note. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const record = objects(doc).get(id);
  if (!isSticky(record)) return undefined;
  return record.get('text') as Y.Text | undefined;
}

/* ---- Story 7 · multi-object operations (one undo step, one broadcast) ------ */

/**
 * Move every listed object to an absolute world position in ONE transaction.
 * A `positions` entry with a non-finite coordinate is skipped; a missing id is
 * skipped. Returns the number of objects actually moved.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  const map = objects(doc);
  const writes: Array<[StickyRecord, number, number]> = [];
  for (const [id, at] of positions) {
    const record = map.get(id);
    if (record === undefined) continue;
    if (!finite(at.x, at.y)) continue;
    if (record.get('x') === at.x && record.get('y') === at.y) continue;
    writes.push([record, at.x, at.y]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [record, x, y] of writes) {
      record.set('x', x);
      record.set('y', y);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Resize every listed object to an absolute world rectangle in ONE transaction.
 * The first resize writes `width`/`height`, making an implicit sticky size
 * explicit (design: no migration, the size is written on first resize). A rect
 * with any non-finite component is skipped; so is a missing id. Returns the
 * number of objects actually resized.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  const map = objects(doc);
  const writes: Array<[StickyRecord, Rect]> = [];
  for (const [id, rect] of rects) {
    const record = map.get(id);
    if (record === undefined) continue;
    if (!finite(rect.x, rect.y, rect.width, rect.height)) continue;
    writes.push([record, rect]);
  }
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [record, rect] of writes) {
      record.set('x', rect.x);
      record.set('y', rect.y);
      record.set('width', rect.width);
      record.set('height', rect.height);
    }
  }, LOCAL_ORIGIN);
  return writes.length;
}

/**
 * Delete every listed object in ONE transaction. Missing ids are skipped.
 * Returns the number of objects actually deleted (design: deletes are undoable
 * as one step because they happen in one transaction).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const present: string[] = [];
  for (const id of ids) {
    if (map.has(id)) present.push(id);
  }
  if (present.length === 0) return 0;
  doc.transact(() => {
    // Arrows survive the object they pointed at (PRD connector.target_deleted):
    // every end that touched a deleted object becomes `free` at the point it was
    // attached. Done first, while the doomed rectangles still exist, so the
    // anchor can be measured; still ONE transaction, so the delete and its
    // detachments are one update and one undo step (TC-13).
    detachConnectorsTo(doc, present);
    for (const id of present) map.delete(id);
  }, LOCAL_ORIGIN);
  return present.length;
}

/**
 * Raise every listed object above the unselected objects in ONE transaction,
 * preserving the selection's relative order (design Key decision 4). New z
 * values start one above the top of everything, so the whole selection lifts as
 * a block. If every selected object is *already* above every unselected one,
 * nothing changes and 0 is returned (no transaction, no pointless sync).
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  const map = objects(doc);
  const selectedIds = new Set(ids);

  const selected: Array<{ record: StickyRecord; z: number; index: number }> = [];
  let index = 0;
  for (const id of ids) {
    const record = map.get(id);
    if (record === undefined) continue;
    const z = record.get('z');
    if (typeof z !== 'number') continue;
    selected.push({ record, z, index: index++ });
  }
  if (selected.length === 0) return 0;

  // The highest z among objects NOT in the selection.
  let unselectedMax = 0;
  map.forEach((record, id) => {
    if (selectedIds.has(id)) return;
    const z = record.get('z');
    if (typeof z === 'number' && z > unselectedMax) unselectedMax = z;
  });

  // Order the selection bottom-to-top (current z, ties keep call order) so the
  // lift preserves that order.
  const ordered = [...selected].sort((a, b) => (a.z !== b.z ? a.z - b.z : a.index - b.index));
  // If the lowest selected object already sits above everything unselected, the
  // block is already at the front — leave the document untouched.
  if (ordered.every((item) => item.z > unselectedMax)) return 0;

  doc.transact(() => {
    for (let i = 0; i < ordered.length; i++) {
      ordered[i].record.set('z', unselectedMax + 1 + i);
    }
  }, LOCAL_ORIGIN);
  return ordered.length;
}

/**
 * A plain, immutable snapshot of every object, ordered by `(z, id)` so the
 * render order is deterministic even once equal `z` values appear after a
 * story-3 merge. Unknown `type` values are skipped (forward compatibility): a
 * type is only snapshotted when it is registered in {@link KNOWN_TYPES} or
 * declared on `globalThis.__vidi6TestTypes` (used by the test-only fixtures).
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const result: ObjectSnapshot[] = [];
  const allowed = allowedTypes();
  const map = objects(doc);

  // Pass 1 — every object that is not an arrow, plus a live rect map. An arrow's
  // geometry is defined by what it points at, so those rectangles have to exist
  // before its own entry can be built.
  const rects = new Map<string, Rect>();
  const connectors: Array<[string, StickyRecord]> = [];
  map.forEach((record, id) => {
    const type = record.get('type');
    if (typeof type !== 'string' || !allowed.has(type)) return;
    if (type === 'connector') {
      connectors.push([id, record]);
      return;
    }
    const rect = rectOfRecord(record);
    if (rect) rects.set(id, rect);

    const entry: ObjectSnapshot = {
      id,
      type,
      x: record.get('x') as number,
      y: record.get('y') as number,
      z: record.get('z') as number,
      width: readSize(record.get('width')),
      height: readSize(record.get('height')),
      createdAt: record.get('createdAt') as number,
    };
    if (type === 'sticky') {
      const text = record.get('text');
      entry.color = record.get('color') as StickyColor;
      entry.text = text instanceof Y.Text ? text.toString() : '';
    } else if (type === 'text') {
      const text = record.get('text');
      entry.text = text instanceof Y.Text ? text.toString() : '';
      entry.size = record.get('size') as string;
      entry.widthMode = record.get('widthMode') as 'auto' | 'fixed';
      const createdBy = record.get('createdBy');
      if (typeof createdBy === 'string') entry.createdBy = createdBy;
    } else if (type === 'shape') {
      const label = record.get('label');
      entry.kind = record.get('kind') as ShapeKind;
      entry.fill = record.get('fill') as ShapeFill;
      entry.stroke = record.get('stroke') as ShapeStroke;
      entry.text = label instanceof Y.Text ? label.toString() : '';
      const createdBy = record.get('createdBy');
      if (typeof createdBy === 'string') entry.createdBy = createdBy;
    }
    result.push(entry);
  });

  // Pass 2 — the arrows. The stored `x`/`y`/`width`/`height` are zeros (the box
  // is derived), so this is where a connector gets a real bounding box: the
  // frame around its two resolved ends. An arrow whose target vanished draws at
  // the endpoint's stored fallback point instead of disappearing.
  for (const [id, record] of connectors) {
    const ends = readConnector(record);
    if (ends === null) continue;
    const resolved = resolveEndpoints(ends, rects);
    if (
      !Number.isFinite(resolved.from.x) ||
      !Number.isFinite(resolved.from.y) ||
      !Number.isFinite(resolved.to.x) ||
      !Number.isFinite(resolved.to.y)
    ) {
      continue;
    }
    const box = connectorBBox(resolved.from, resolved.to);
    const createdBy = record.get('createdBy');
    const entry: ObjectSnapshot = {
      id,
      type: 'connector',
      x: box.x,
      y: box.y,
      z: record.get('z') as number,
      width: box.width,
      height: box.height,
      createdAt: record.get('createdAt') as number,
      from: ends.from,
      to: ends.to,
      ends: resolved,
    };
    if (typeof createdBy === 'string') entry.createdBy = createdBy;
    result.push(entry);
  }

  result.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

/* ---- Story 7 · multi-object reads and group operations -------------------- */

/**
 * The set of types the current runtime can resolve: the production registry
 * plus any types a test fixture declared on `globalThis.__vidi6TestTypes`. Kept
 * out of the client registry module so `snapshot()` stays a pure Yjs read with
 * no React or DOM dependency (and no `node:fs`-free import cycle).
 */
function allowedTypes(): ReadonlySet<string> {
  const extra = (globalThis as { __vidi6TestTypes?: readonly string[] }).__vidi6TestTypes;
  if (!extra || extra.length === 0) return KNOWN_TYPES;
  const merged = new Set(KNOWN_TYPES);
  for (const type of extra) merged.add(type);
  return merged;
}

/** The world-space rectangle an object snapshot occupies. */
export function objectBounds(obj: ObjectSnapshot): Rect {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

/**
 * Every object id, in snapshot (z, id) order. Because `snapshot()` already
 * drops unregistered types, this is the select-all candidate list and never
 * offers an unresolvable object (PRD `sel.all_types`).
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.map((obj) => obj.id);
}

/**
 * The ids of objects lying **entirely** inside `rect` — the marquee's
 * fully-inside rule (PRD `sel.marquee`), implemented with the pure
 * {@link rectContains} helper so it can be unit-tested without a DOM.
 */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return snapshot.filter((obj) => rectContains(rect, objectBounds(obj))).map((obj) => obj.id);
}