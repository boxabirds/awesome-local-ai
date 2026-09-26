/**
 * The board document model (stories 2 and 7).
 *
 * Sticky notes live in a Yjs document from day one: the same document story 3
 * puts on the network and story 4 persists. That is why the shape below is
 * deliberately boring and versioned - it becomes the wire and the storage
 * format - and why every rejection is expressed as `false` instead of an
 * exception.
 *
 * The module is framework-free and free of DOM access so the Durable Object
 * (story 4) can import the very same validation and migration code.
 *
 * Schema:
 * ```
 * Y.Doc
 *   meta: Y.Map { schemaVersion: 1 }
 *   objects: Y.Map<string, Y.Map>
 *     <id>: Y.Map {
 *       type: 'sticky'
 *       x: number, y: number   // top-left corner, world units
 *       color: StickyColor
 *       text: Y.Text
 *       z: number              // stacking, higher is on top
 *       createdAt: number      // epoch ms
 *       width?: number         // added in story 7; default STICKY_SIZE_WORLD
 *       height?: number        // added in story 7; default STICKY_SIZE_WORLD
 *     }
 * ```
 */
import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  type StickyColor,
  type PenColor,
  type PenThickness,
} from './config';
import type { Rect, Point } from './geometry';
import { rectContains } from './geometry';
import type { ShapeKind, FillColor, StrokeColor } from './config';
import { detachConnectorsTo } from './objects/connector';
import type { ConnectorSnap, Endpoint } from './objects/connector';
import type { ShapeSnap } from './objects/shape';
import type { StrokeSnap } from './objects/stroke';

export type { Rect, Point };
export type { ShapeSnap, FillColor, StrokeColor, ShapeKind };
export type { ConnectorSnap, Endpoint };
export type { StrokeSnap };

/**
 * Transaction origin for local mutations. Story 8 uses it to build undo
 * stacks and story 3 to avoid echoing a change back to its author.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6:local');

/** Written to `meta.schemaVersion`; bumped when the shape above changes. */
export const SCHEMA_VERSION = 1;

const META_KEY = 'meta';
const OBJECTS_KEY = 'objects';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
  /** Width (story 7); undefined means implicit STICKY_SIZE_WORLD. */
  width?: number;
  /** Height (story 7); undefined means implicit STICKY_SIZE_WORLD. */
  height?: number;
}

/** Generic object snapshot for group operations. */
export type ObjectSnapshot =
  | StickySnapshot
  | import('./objects/text').TextSnapshot
  | import('./objects/shape').ShapeSnap
  | import('./objects/connector').ConnectorSnap
  | import('./objects/stroke').StrokeSnap;

type NoteMap = Y.Map<unknown>;

/** The one `objects` map every board object lives in. */
export function objectsMap(doc: Y.Doc): Y.Map<NoteMap | unknown> {
  return doc.getMap<NoteMap | unknown>(OBJECTS_KEY);
}

function isSticky(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'sticky';
}

function isTextObj(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'text';
}

function isShapeObj(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'shape';
}

function isConnectorObj(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'connector';
}

function isStrokeObj(value: unknown): value is NoteMap {
  return value instanceof Y.Map && value.get('type') === 'stroke';
}

/** True for any recognised board object. */
export function isBoardObject(value: unknown): value is NoteMap {
  return (
    isSticky(value) ||
    isTextObj(value) ||
    isShapeObj(value) ||
    isConnectorObj(value) ||
    isStrokeObj(value)
  );
}

function readNote(doc: Y.Doc, id: string): NoteMap | undefined {
  const value = objectsMap(doc).get(id);
  return isSticky(value) ? value : undefined;
}

function finite(...values: unknown[]): boolean {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

/** Highest `z` currently in the document; new notes and drags start above it. */
function maxZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((value) => {
    if (!isBoardObject(value)) return;
    const z = value.get('z');
    if (typeof z === 'number' && Number.isFinite(z) && z > max) max = z;
  });
  return max;
}

/** Prepare a document for use, recording the schema version exactly once. */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(META_KEY);
  if (meta.get('schemaVersion') !== undefined) return;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
  }, LOCAL_ORIGIN);
}

/**
 * Create a sticky note centred on `at` (the coordinates are the centre, not
 * the top-left corner: `x, y` stored on the note is `at` minus half the note
 * size). Returns the new id, or `''` when the point is unusable.
 */
export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!finite(at?.x, at?.y)) return '';
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `sticky-${Math.random().toString(36).slice(2)}`;
  const z = maxZ(doc) + 1;
  const objects = objectsMap(doc);
  const fill = color in STICKY_COLORS ? color : DEFAULT_STICKY_COLOR;

  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x - STICKY_SIZE_WORLD / 2);
    note.set('y', at.y - STICKY_SIZE_WORLD / 2);
    note.set('color', fill);
    note.set('text', new Y.Text());
    note.set('z', z);
    note.set('createdAt', Date.now());
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

/** Move a note to a new top-left corner. False for a stale id or bad numbers. */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  if (!finite(x, y)) return false;
  doc.transact(() => {
    note.set('x', x);
    note.set('y', y);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Raise a note above every other one. False when it is already on top, which
 * keeps a pointless update off the wire in story 3.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  const z = note.get('z');
  if (typeof z !== 'number' || !Number.isFinite(z)) return false;
  const top = maxZ(doc);
  if (z >= top) return false;
  doc.transact(() => {
    note.set('z', top + 1);
  }, LOCAL_ORIGIN);
  return true;
}

/** Recolour a note. False for a stale id, an unknown colour or no change. */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  const note = readNote(doc, id);
  if (!note) return false;
  if (!(color in STICKY_COLORS)) return false;
  if (note.get('color') === color) return false;
  doc.transact(() => {
    note.set('color', color as StickyColor);
  }, LOCAL_ORIGIN);
  return true;
}

/** Remove a note and its text. False for a stale id. */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = objectsMap(doc);
  if (!readNote(doc, id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

/** The note's text type, or undefined when the note is gone. */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const note = readNote(doc, id);
  if (!note) return undefined;
  const text = note.get('text');
  return text instanceof Y.Text ? text : undefined;
}

/**
 * Read the whole board as plain data, in render order: by `z` ascending, then
 * by `id`. Painting the array in order therefore puts the highest `z` last,
 * which is what the browser draws on top. The `id` tie-break makes an
 * equal-`z` race (possible once story 3 syncs) resolve to the same order on
 * every client. Objects of an unknown `type` are skipped so a newer client can
 * open a document written by an older one.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = objectsMap(doc);
  const result: ObjectSnapshot[] = [];
  objects.forEach((value, id) => {
    if (!isBoardObject(value)) return;
    const x = value.get('x');
    const y = value.get('y');
    const z = value.get('z');
    const createdAt = value.get('createdAt');
    if (!finite(x, y, z)) return;
    const type = value.get('type');
    if (type === 'sticky') {
      const storedColor = value.get('color');
      const text = value.get('text');
      result.push({
        id,
        type: 'sticky' as const,
        x: x as number,
        y: y as number,
        color:
          typeof storedColor === 'string' && storedColor in STICKY_COLORS
            ? (storedColor as StickyColor)
            : DEFAULT_STICKY_COLOR,
        text: text instanceof Y.Text ? text.toString() : '',
        z: z as number,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        width: typeof value.get('width') === 'number' ? (value.get('width') as number) : undefined,
        height: typeof value.get('height') === 'number' ? (value.get('height') as number) : undefined,
      });
    } else if (type === 'text') {
      const text = value.get('text');
      const size = value.get('size');
      const widthMode = value.get('widthMode');
      result.push({
        id,
        type: 'text' as const,
        x: x as number,
        y: y as number,
        width: typeof value.get('width') === 'number' ? (value.get('width') as number) : 80,
        height: typeof value.get('height') === 'number' ? (value.get('height') as number) : 26,
        z: z as number,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        createdBy: typeof value.get('createdBy') === 'string' ? (value.get('createdBy') as string) : '',
        text: text instanceof Y.Text ? text.toString() : '',
        size: typeof size === 'string' && ['S','M','L','XL'].includes(size) ? (size as import('./objects/text').TextSnapshot['size']) : 'M',
        widthMode: widthMode === 'fixed' ? 'fixed' as const : 'auto' as const,
      });
    } else if (type === 'shape') {
      const label = value.get('label');
      const kind = value.get('kind');
      const fill = value.get('fill');
      const stroke = value.get('stroke');
      const w = value.get('width');
      const h = value.get('height');
      result.push({
        id,
        type: 'shape' as const,
        x: x as number,
        y: y as number,
        width: typeof w === 'number' ? w : 160,
        height: typeof h === 'number' ? h : 160,
        z: z as number,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        createdBy: typeof value.get('createdBy') === 'string' ? (value.get('createdBy') as string) : '',
        kind: typeof kind === 'string' && ['rect','ellipse','diamond'].includes(kind) ? (kind as ShapeKind) : 'rect',
        fill: typeof fill === 'string' && fill in SHAPE_FILL_COLORS ? (fill as FillColor) : 'white',
        stroke: typeof stroke === 'string' && stroke in SHAPE_STROKE_COLORS ? (stroke as StrokeColor) : 'dark',
        label: label instanceof Y.Text ? label.toString() : '',
      });
    } else if (type === 'connector') {
      const fromRaw = value.get('from');
      const toRaw = value.get('to');
      const w = value.get('width');
      const h = value.get('height');
      result.push({
        id,
        type: 'connector' as const,
        x: x as number,
        y: y as number,
        width: typeof w === 'number' ? w : 0,
        height: typeof h === 'number' ? h : 0,
        z: z as number,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        createdBy: typeof value.get('createdBy') === 'string' ? (value.get('createdBy') as string) : '',
        from: fromRaw && typeof fromRaw === 'object' ? (fromRaw as Endpoint) : { kind: 'free', x: x as number, y: y as number },
        to: toRaw && typeof toRaw === 'object' ? (toRaw as Endpoint) : { kind: 'free', x: x as number, y: y as number },
      });
    } else if (type === 'stroke') {
      // A stroke is only worth drawing when there is a line to draw: the
      // flattened point list has to be real numbers, at least two of them.
      const rawPoints = value.get('points');
      if (!Array.isArray(rawPoints) || rawPoints.length < 2 || !rawPoints.every((v) => finite(v))) return;
      const w = value.get('width');
      const h = value.get('height');
      const baseW = value.get('baseWidth');
      const baseH = value.get('baseHeight');
      const color = value.get('color');
      const thickness = value.get('thickness');
      result.push({
        id,
        type: 'stroke' as const,
        x: x as number,
        y: y as number,
        width: typeof w === 'number' && finite(w) ? w : 0,
        height: typeof h === 'number' && finite(h) ? h : 0,
        z: z as number,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        createdBy: typeof value.get('createdBy') === 'string' ? (value.get('createdBy') as string) : '',
        points: rawPoints as number[],
        baseWidth: typeof baseW === 'number' && finite(baseW) && baseW > 0 ? baseW : 1,
        baseHeight: typeof baseH === 'number' && finite(baseH) && baseH > 0 ? baseH : 1,
        color: typeof color === 'string' && color in PEN_COLORS ? (color as PenColor) : DEFAULT_PEN_COLOR,
        thickness:
          typeof thickness === 'string' && thickness in PEN_THICKNESS_WORLD
            ? (thickness as PenThickness)
            : DEFAULT_PEN_THICKNESS,
        closed: value.get('closed') === true,
      });
    }
  });
  result.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}

/* --------------------------------------------------------------------- *
 * Story 7: group operations.
 * --------------------------------------------------------------------- */

/** Read an object's rect, using STICKY_SIZE_WORLD for implicit sizes (sticky only). */
export function objectBounds(obj: ObjectSnapshot): Rect {
  if (obj.type === 'text') {
    return {
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
    };
  }
  if (obj.type === 'shape') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  if (obj.type === 'connector') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  if (obj.type === 'stroke') {
    // The box a stroke reports is the box of its ink. The *clickable* area is
    // wider than that by the pen's half-width plus the click tolerance (that is
    // what `strokeHit` builds, and it is why a click in the empty middle of a
    // ring reaches the board), but keeping the box itself the ink box is what
    // lets a resize keep the drawn ratio exactly: the resize gesture measures
    // this box and writes it back, so any padding here would land in the ratio.
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  return {
    x: obj.x,
    y: obj.y,
    width: (obj as StickySnapshot).width ?? STICKY_SIZE_WORLD,
    height: (obj as StickySnapshot).height ?? STICKY_SIZE_WORLD,
  };
}

/** Return ids of objects whose bounds lie entirely within `rect`. */
export function objectsInRect(
  snapshot: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return snapshot
    .filter((obj) => rectContains(rect, objectBounds(obj)))
    .map((obj) => obj.id);
}

/** Return ids of every recognised object (only registered types in snapshot). */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  // Snapshot already excludes unknown types; return all ids.
  return snapshot.map((obj) => obj.id);
}

/**
 * Move objects to absolute positions (world-unit top-left corners).
 * Returns the count applied; non-finite values or missing ids are skipped.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, Point>,
): number {
  if (positions.size === 0) return 0;
  // Validate: all positions must be finite.
  for (const p of positions.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  }
  const objects = objectsMap(doc);
  let count = 0;
  // Gather the notes first to verify they exist.
  const updates: Array<{ note: NoteMap; x: number; y: number }> = [];
  for (const [id, pos] of positions) {
    const note = objects.get(id);
    if (!isBoardObject(note)) continue;
    updates.push({ note, x: pos.x, y: pos.y });
  }
  if (updates.length === 0) return 0;
  doc.transact(() => {
    for (const { note, x, y } of updates) {
      note.set('x', x);
      note.set('y', y);
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Resize objects to absolute rects. Writes width and height.
 * Returns the count applied.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  // Validate: all rects must have finite positive dimensions.
  for (const r of rects.values()) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height) ||
      r.width <= 0 ||
      r.height <= 0
    ) {
      return 0;
    }
  }
  const objects = objectsMap(doc);
  let count = 0;
  const updates: Array<{ note: NoteMap; r: Rect }> = [];
  for (const [id, r] of rects) {
    const note = objects.get(id);
    if (!isBoardObject(note)) continue;
    updates.push({ note, r });
  }
  if (updates.length === 0) return 0;
  doc.transact(() => {
    for (const { note, r } of updates) {
      // A stroke carries its drawing with it: the box is only where the ink sits,
      // so resizing has to rescale the ink in the same transaction or the box
      // grows around a line that stayed where it was (pen.resize, 3.4). The ink
      // is written as one array, in the same transaction as the box: a peer gets
      // either the old stroke or the new one, never a box without its ink.
      if (note.get('type') === 'stroke') {
        const beforeWidth = Number(note.get('width') ?? 0);
        const beforeHeight = Number(note.get('height') ?? 0);
        const ink = note.get('points');
        if (
          Array.isArray(ink) &&
          ink.length >= 4 &&
          beforeWidth > 0 &&
          beforeHeight > 0
        ) {
          const sx = Math.min(r.width, MAX_OBJECT_SIZE_WORLD) / beforeWidth;
          const sy = Math.min(r.height, MAX_OBJECT_SIZE_WORLD) / beforeHeight;
          if (sx !== 1 || sy !== 1) {
            const scaled = new Array<number>(ink.length);
            for (let i = 0; i < ink.length; i += 2) {
              scaled[i] = Math.round(Number(ink[i]) * sx * 1000) / 1000;
              scaled[i + 1] = Math.round(Number(ink[i + 1]) * sy * 1000) / 1000;
            }
            note.set('points', scaled);
          }
        }
      }
      note.set('x', r.x);
      note.set('y', r.y);
      note.set('width', Math.min(r.width, MAX_OBJECT_SIZE_WORLD));
      note.set('height', Math.min(r.height, MAX_OBJECT_SIZE_WORLD));
      count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Raise selected objects above all unselected ones, preserving their relative
 * z order. Returns the count changed.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const selected = new Set(ids);

  type Entry = { id: string; note: NoteMap; z: number };
  const selectedEntries: Entry[] = [];
  let maxUnselected = 0;

  objects.forEach((value, key) => {
    if (!isBoardObject(value)) return;
    const z = value.get('z');
    if (typeof z !== 'number' || !Number.isFinite(z)) return;
    if (selected.has(key)) {
      selectedEntries.push({ id: key, note: value, z });
    } else {
      if (z > maxUnselected) maxUnselected = z;
    }
  });

  if (selectedEntries.length === 0) return 0;

  // Sort by current z to preserve relative order.
  selectedEntries.sort((a, b) => a.z - b.z);

  // Check if any actually need to move.
  const needsChange = selectedEntries.some((e) => e.z <= maxUnselected);
  if (!needsChange) return 0;

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selectedEntries.length; i++) {
      const newZ = maxUnselected + i + 1;
      selectedEntries[i]!.note.set('z', newZ);
      if (selectedEntries[i]!.z !== newZ) count++;
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete multiple objects in one transaction. Returns the count deleted.
 * If any connector has endpoints attached to a deleted id, those ends are
 * detached to `free` within the same transaction (one undo step).
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const existing = ids.filter((id) => isBoardObject(objects.get(id)));
  if (existing.length === 0) return 0;
  // Detach connectors BEFORE removing the objects so their anchors are still resolvable.
  doc.transact(() => {
    detachConnectorsTo(doc, existing);
    for (const id of existing) {
      objects.delete(id);
    }
  }, LOCAL_ORIGIN);
  return existing.length;
}