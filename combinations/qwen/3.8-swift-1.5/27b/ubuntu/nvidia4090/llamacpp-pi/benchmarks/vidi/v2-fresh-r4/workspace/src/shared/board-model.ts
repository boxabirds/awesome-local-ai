import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from './config';
import { isKnownType } from './known-types';
import type { Rect, Point } from './geometry';
import type { TextSize } from './config';

/** Origin symbol for local transactions (used by story 8 undo and story 3 to avoid echo). */
export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

/**
 * Generic object snapshot: the common fields shared by all board object types.
 * Sticky notes extend this with color and text.
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
  /** Optional explicit size; falls back to type default if absent. */
  width?: number;
  height?: number;
  /** Sticky-note specific (present when type === 'sticky'). */
  color?: string;
  text?: string;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
}

/** Type guard for sticky snapshots. */
export function isStickySnapshot(obj: ObjectSnapshot): obj is StickySnapshot {
  return obj.type === 'sticky';
}

/** Text object snapshot (story 9). */
export interface TextSnapshot extends ObjectSnapshot {
  type: 'text';
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

/** Type guard for text snapshots. */
export function isTextSnapshot(obj: ObjectSnapshot): obj is TextSnapshot {
  return obj.type === 'text';
}

/**
 * Get the bounding rect of an object in world units.
 * Uses explicit width/height if present, otherwise falls back to STICKY_SIZE_WORLD.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const w = obj.width ?? STICKY_SIZE_WORLD;
  const h = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width: w, height: h };
}

/**
 * Return ids of objects whose bounds are entirely within the given rect.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    const bounds = objectBounds(obj);
    if (
      bounds.x >= rect.x &&
      bounds.y >= rect.y &&
      bounds.x + bounds.width <= rect.x + rect.width &&
      bounds.y + bounds.height <= rect.y + rect.height
    ) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Return ids of all objects with a registered type.
 */
export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  return snapshot.filter((obj) => isKnownType(obj.type)).map((obj) => obj.id);
}

/**
 * Initialise the document schema. Sets meta.schemaVersion if absent.
 * Safe to call multiple times.
 */
export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function isFinitePair(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  );
}

function isValidColor(c: string): c is StickyColor {
  return c in STICKY_COLORS;
}

/**
 * Create a new sticky note centred at the given world point.
 * Returns the new note's id.
 */
export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color: StickyColor = DEFAULT_STICKY_COLOR): string {
  if (!isFinitePair(at.x, at.y)) return '';
  const objects = getObjects(doc);
  const id = crypto.randomUUID();
  const halfSize = STICKY_SIZE_WORLD / 2;
  const x = at.x - halfSize;
  const y = at.y - halfSize;

  // Compute max z
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  const text = new Y.Text();
  const note = new Y.Map<unknown>();
  note.set('type', 'sticky');
  note.set('x', x);
  note.set('y', y);
  note.set('color', color);
  note.set('text', text);
  note.set('z', maxZ + 1);
  note.set('createdAt', Date.now());

  doc.transact(() => {
    objects.set(id, note);
  }, LOCAL_ORIGIN);

  return id;
}

// --- Group operations (story 7) ---

/**
 * Move multiple objects to absolute world positions.
 * Returns the count of objects actually moved.
 * Missing ids are skipped. Non-finite positions cause 0 return with no transaction.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;

  // Validate all positions are finite
  for (const [, p] of positions) {
    if (!isFinitePair(p.x, p.y)) return 0;
  }

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, pos] of positions) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', pos.x);
      obj.set('y', pos.y);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Resize multiple objects to the given rects (absolute world units).
 * Writes both width and height, making implicit-size objects explicit.
 * Returns the count of objects actually resized.
 * Missing ids are skipped. Non-finite rects cause 0 return with no transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  // Validate all rects are finite
  for (const [, r] of rects) {
    if (!isFiniteRect(r)) return 0;
  }

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const [id, rect] of rects) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', rect.x);
      obj.set('y', rect.y);
      obj.set('width', rect.width);
      obj.set('height', rect.height);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Bring multiple objects to the front, above all unselected objects,
 * while preserving their relative z-order among themselves.
 * Returns the count of objects whose z changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  const idSet = new Set(ids);

  // Find max z among non-selected objects
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (idSet.has(id)) return;
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxUnselectedZ) maxUnselectedZ = z;
  });

  // Get current z of selected objects, sorted by (z, id) to preserve order
  const selectedEntries: { id: string; z: number }[] = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    selectedEntries.push({ id, z: (obj.get('z') as number) ?? 0 });
  }
  selectedEntries.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selectedEntries.length; i++) {
      const obj = objects.get(selectedEntries[i].id);
      if (!obj) continue;
      const newZ = maxUnselectedZ + i + 1;
      if (newZ !== selectedEntries[i].z) {
        obj.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);

  return count;
}

/**
 * Delete multiple objects by id.
 * Returns the count of objects actually deleted.
 * Missing ids are skipped.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  let count = 0;

  doc.transact(() => {
    for (const id of ids) {
      if (!objects.has(id)) continue;
      objects.delete(id);
      count++;
    }
  }, LOCAL_ORIGIN);

  return count;
}

// --- Single-object wrappers (story 2 compatibility) ---

/**
 * Move an object to new world coordinates (top-left).
 * Returns true if the move was applied, false if the id is unknown or coords are non-finite.
 */
export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePair(x, y)) return false;
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;
  const count = moveObjects(doc, new Map([[id, { x, y }]]));
  return count > 0;
}

/**
 * Bring an object to the front (highest z).
 * Returns true if z changed, false if already topmost or id unknown.
 */
export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  if (!objects.has(id)) return false;

  const currentZ = (objects.get(id)!.get('z') as number) ?? 0;
  let maxZ = 0;
  objects.forEach((o) => {
    const z = (o.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });

  if (currentZ >= maxZ) return false;

  const count = bringObjectsToFront(doc, [id]);
  return count > 0;
}

/**
 * Set the colour of a sticky note.
 * Returns true if applied, false if colour is unknown or id is stale.
 */
export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

/**
 * Delete an object by id.
 * Returns true if deleted, false if id not found.
 */
export function deleteObject(doc: Y.Doc, id: string): boolean {
  const count = deleteObjects(doc, [id]);
  return count > 0;
}

/**
 * Get the Y.Text for a sticky note, or undefined if not found.
 */
export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  return (obj.get('text') as Y.Text) ?? undefined;
}

/**
 * Return a snapshot of all objects, sorted by (z, id).
 * Unknown object types are skipped.
 */
export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = getObjects(doc);
  const result: ObjectSnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (!isKnownType(type)) return;

    const x = (obj.get('x') as number) ?? 0;
    const y = (obj.get('y') as number) ?? 0;
    const z = (obj.get('z') as number) ?? 0;
    const createdAt = (obj.get('createdAt') as number) ?? 0;
    const width = obj.has('width') ? (obj.get('width') as number) : undefined;
    const height = obj.has('height') ? (obj.get('height') as number) : undefined;

    const base: ObjectSnapshot = { id, type, x, y, z, createdAt };
    if (width !== undefined) base.width = width;
    if (height !== undefined) base.height = height;

    if (type === 'sticky') {
      const color = (obj.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR;
      const text = (obj.get('text') as Y.Text)?.toString() ?? '';
      result.push({ ...base, type: 'sticky' as const, color, text });
    } else if (type === 'text') {
      const text = (obj.get('text') as Y.Text)?.toString() ?? '';
      const size = (obj.get('size') as TextSize) ?? 'M';
      const widthMode = (obj.get('widthMode') as 'auto' | 'fixed') ?? 'auto';
      const textSnap: TextSnapshot = { ...base, type: 'text', text, size, widthMode };
      result.push(textSnap);
    } else {
      result.push(base);
    }
  });

  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  return result;
}

/**
 * Return a snapshot of all sticky notes only, sorted by (z, id).
 * Kept for backward compatibility with story 2 code.
 */
export function snapshotSticky(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc).filter(isStickySnapshot);
}
