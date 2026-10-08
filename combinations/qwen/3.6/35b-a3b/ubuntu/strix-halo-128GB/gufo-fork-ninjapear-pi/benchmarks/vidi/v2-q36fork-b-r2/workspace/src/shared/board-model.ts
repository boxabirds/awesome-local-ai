import * as Y from 'yjs';
import {
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  DEFAULT_STICKY_COLOR,
  STICKY_TEXT_MAX_CHARS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
} from './config';
import { getObjectType } from '../client/objects/registry';
import { objectBounds, normalizeRect as normRect } from './geometry';
import type { Rect } from './geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('localOrigin');

export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: string;
  text: string;
  createdAt: number;
}

// Schema helpers
function ensureMeta(doc: Y.Doc): void {
  if (!doc.getMap('meta').get('schemaVersion')) {
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<any>> {
  return doc.getMap('objects') as Y.Map<Y.Map<any>>;
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((v) => {
    const z = v.get('z');
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });
  return maxZ;
}

function isValidColor(color: string): boolean {
  return color in STICKY_COLORS;
}

function isFiniteCoord(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

export function initDoc(doc: Y.Doc): void {
  ensureMeta(doc);
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: string,
): string {
  // Validate coordinates before creating anything
  if (!isFiniteCoord(at.x, at.y)) {
    return '';
  }

  const noteColor = color || DEFAULT_STICKY_COLOR;
  if (!isValidColor(noteColor)) {
    return '';
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;
  const halfSize = STICKY_SIZE_WORLD / 2;

  doc.transact(() => {
    const objects = getObjects(doc);
    const noteMap = new Y.Map();
    noteMap.set('type', 'sticky');
    noteMap.set('x', at.x - halfSize);
    noteMap.set('y', at.y - halfSize);
    noteMap.set('color', noteColor);
    noteMap.set('text', '');
    noteMap.set('z', z);
    noteMap.set('createdAt', Date.now());
    objects.set(id, noteMap);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!isFiniteCoord(x, y)) {
    return false;
  }

  const objects = getObjects(doc);
  const noteMap = objects.get(id);
  if (!noteMap) {
    return false;
  }

  doc.transact(() => {
    noteMap.set('x', x);
    noteMap.set('y', y);
  }, LOCAL_ORIGIN);

  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const noteMap = objects.get(id);
  if (!noteMap) {
    return false;
  }

  const currentZ = noteMap.get('z') as number;
  const maxZ = getMaxZ(doc);

  // No-op if already topmost
  if (currentZ >= maxZ) {
    return false;
  }

  doc.transact(() => {
    noteMap.set('z', maxZ + 1);
  }, LOCAL_ORIGIN);

  return true;
}

export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  // Resolve colour name to hex value
  const hexColor = STICKY_COLORS[color as keyof typeof STICKY_COLORS];
  if (!hexColor) {
    return false;
  }

  const objects = getObjects(doc);
  const noteMap = objects.get(id);
  if (!noteMap) {
    return false;
  }

  doc.transact(() => {
    noteMap.set('color', hexColor);
  }, LOCAL_ORIGIN);

  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjects(doc);
  const noteMap = objects.get(id);
  if (!noteMap) {
    return false;
  }

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);

  return true;
}

export function getStickyText(
  doc: Y.Doc,
  id: string,
): Y.Text | undefined {
  const objects = getObjects(doc);
  const noteMap = objects.get(id);
  if (!noteMap) {
    return undefined;
  }
  const textVal = noteMap.get('text');
  return textVal instanceof Y.Text ? textVal : undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjects(doc);
  const result: StickySnapshot[] = [];

  objects.forEach((value) => {
    const type = value.get('type');
    if (type !== 'sticky') {
      return; // skip unknown types (forward compatibility)
    }

    const id = Array.from(objects.keys()).find(
      (k) => objects.get(k) === value,
    )!;

    result.push({
      id,
      type: 'sticky' as const,
      x: value.get('x') as number,
      y: value.get('y') as number,
      color: value.get('color') as string,
      text: (value.get('text') as Y.Text)?.toString() ?? '',
      z: value.get('z') as number,
      createdAt: value.get('createdAt') as number,
    });
  });

  // Sort by (z, id) for deterministic order
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return Object.freeze(result);
}

// --- Generic group operations (story 7) ---


/** Return ids of objects fully contained within a rectangle. */
export function objectsInRect(
  snapshots: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  return snapshots
    .filter((s) => {
      const bounds = objectBounds(s);
      // Must be fully inside; not merely touching from outside
      if (bounds.width <= 0 || bounds.height <= 0) return false;
      return (
        bounds.x >= rect.x &&
        bounds.y >= rect.y &&
        bounds.x + bounds.width <= rect.x + rect.width &&
        bounds.y + bounds.height <= rect.y + rect.height
      );
    })
    .map((s) => s.id);
}

/** Return all registered object ids (excludes unknown types). */
export function allObjectIds(snapshots: readonly ObjectSnapshot[]): string[] {
  return snapshots.filter((s) => getObjectType(s.type)).map((s) => s.id);
}

/** Move multiple objects atomically. Returns count changed. */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  // Validate: reject non-finite values or empty list
  if (positions.size === 0) return 0;
  for (const [id, pos] of positions) {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      return 0; // reject entire transaction
    }
  }

  const objects = getObjects(doc);
  let count = 0;
  try {
    doc.transact(() => {
      for (const [id, pos] of positions) {
        const noteMap = objects.get(id);
        if (!noteMap) continue; // skip missing ids
        noteMap.set('x', pos.x);
        noteMap.set('y', pos.y);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }
  return count;
}

/** Resize multiple objects by writing new width/height+position. Returns count changed. */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  for (const [id, r] of rects) {
    if (
      !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.height)
    ) {
      return 0; // reject non-finite
    }
  }

  const objects = getObjects(doc);
  let count = 0;
  try {
    doc.transact(() => {
      for (const [id, r] of rects) {
        const noteMap = objects.get(id);
        if (!noteMap) continue; // skip missing ids
        noteMap.set('x', r.x);
        noteMap.set('y', r.y);
        noteMap.set('width', r.width);
        noteMap.set('height', r.height);
        count++;
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }
  return count;
}

/** Raise selected objects above unselected ones. Preserves relative order among selected.
 * Returns count changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  const idSet = new Set(ids);
  
  // Find max z among unselected objects
  let maxUnselectedZ = 0;
  let selectedMaxRank = 0;
  
  // First pass: determine max unselected z and max current selected rank
  for (const [objectId, value] of objects) {
    const z = value.get('z') as number;
    if (!idSet.has(objectId)) {
      if (typeof z === 'number' && z > maxUnselectedZ) {
        maxUnselectedZ = z;
      }
    } else {
      if (typeof z === 'number' && z > selectedMaxRank) {
        selectedMaxRank = z;
      }
    }
  }
  
  // Reassign z: use increasing ranks from maxUnselectedZ+1 for each selected id in sorted order
  const sortedSelected = [...ids].sort();
  try {
    doc.transact(() => {
      for (let i = 0; i < sortedSelected.length; i++) {
        const noteMap = objects.get(sortedSelected[i]);
        if (!noteMap) continue;
        noteMap.set('z', maxUnselectedZ + 1 + i);
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }
  return sortedSelected.length;
}

/** Delete multiple objects. Returns count deleted. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const objects = getObjects(doc);
  let count = 0;
  try {
    doc.transact(() => {
      for (const id of ids) {
        if (objects.has(id)) {
          objects.delete(id);
          count++;
        }
      }
    }, LOCAL_ORIGIN);
  } catch {
    return 0;
  }
  return count;
}

// --- Single-object wrappers (backward compat for story 2) ---

export function bringToFrontSingle(doc: Y.Doc, id: string): boolean {
  const result = bringObjectsToFront(doc, [id]);
  return result > 0;
}

// --- Sticky text utilities ---

/** Clamp string to max characters */
export function clampToLimit(next: string, max: number = STICKY_TEXT_MAX_CHARS): string {
  if (next.length <= max) {
    return next;
  }
  return next.slice(0, max);
}

/**
 * Apply minimal diff between current Y.Text content and next string.
 * Uses common prefix + common suffix to preserve concurrent edits.
 * Works on UTF-16 code units (which is what Yjs uses internally).
 */
export function applyTextDiff(ytext: Y.Text, next: string, origin: unknown): void {
  const current = ytext.toString();

  // Find common prefix length (UTF-16 code units)
  let prefixLen = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefixLen < minLen && current.charCodeAt(prefixLen) === next.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  // Find common suffix length (from end, UTF-16 code units)
  let suffixLen = 0;
  const currRemaining = current.length - prefixLen;
  const nextRemaining = next.length - prefixLen;

  while (
    suffixLen < currRemaining &&
    suffixLen < nextRemaining &&
    current.charCodeAt(current.length - 1 - suffixLen) === next.charCodeAt(next.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  // Delete range: from prefixLen to (current.length - suffixLen) in UTF-16 units
  const deleteStart = prefixLen;
  const deleteLength = current.length - prefixLen - suffixLen;

  // Insert: the middle part of next
  const insertStart = prefixLen;
  const insertEnd = next.length - suffixLen;
  const insertStr = next.slice(insertStart, insertEnd);

  // Try to find parent doc; apply in transaction if available
  try {
    const parentDoc = (ytext as any)._parent?._parent as Y.Doc | undefined;
    if (parentDoc) {
      parentDoc.transact(() => {
        if (deleteLength > 0) {
          ytext.delete(deleteStart, deleteLength);
        }
        if (insertStr.length > 0) {
          ytext.insert(deleteStart, insertStr);
        }
      }, origin);
    } else {
      // Direct application (for tests / detached Y.Texts)
      if (deleteLength > 0) {
        ytext.delete(deleteStart, deleteLength);
      }
      if (insertStr.length > 0) {
        ytext.insert(deleteStart, insertStr);
      }
    }
  } catch {
    // Fallback: direct application
    if (deleteLength > 0) {
      ytext.delete(deleteStart, deleteLength);
    }
    if (insertStr.length > 0) {
      ytext.insert(deleteStart, insertStr);
    }
  }
}

/** Counter visible when remaining chars <= threshold */
export function counterVisible(length: number): boolean {
  const remaining = STICKY_TEXT_MAX_CHARS - length;
  return remaining <= STICKY_COUNTER_THRESHOLD_CHARS;
}

/**
 * Binary search for the largest font size where scrollHeight fits within box height.
 * Returns fontPx (in board units) and overflow flag.
 * Called on text changes; zoom scales uniformly so this is called only on mount
 * or text change (not on zoom).
 */
export function fitFontSize(el: HTMLElement, box: number): { fontPx: number; overflow: boolean } {
  // Set up temporary styles for measurement
  const origStyle = el.getAttribute('style') || '';
  const origFontSize = parseFloat(window.getComputedStyle(el).fontSize) || 0;

  // Temporarily set inline styles
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordWrap = 'break-word';

  // Binary search in [STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]
  let lo = STICKY_FONT_MIN_PX;
  let hi = STICKY_FONT_MAX_PX;
  let best = STICKY_FONT_MIN_PX;

  // First check if even max font fits
  el.style.fontSize = `${hi}px`;
  if (el.scrollHeight <= box) {
    // All sizes fit — use max
    return { fontPx: hi, overflow: false };
  }

  // Check if even min font overflows
  el.style.fontSize = `${lo}px`;
  if (el.scrollHeight > box) {
    // Can't fit even at minimum
    return { fontPx: lo, overflow: true };
  }

  // Binary search
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= box) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const overflow = best < STICKY_FONT_MAX_PX;
  return { fontPx: best, overflow };
}
