import * as Y from 'yjs';
import {
  TEXT_MAX_CHARS,
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
} from '../config';
import type { Point } from '../../client/canvas/camera';
import type { TextSize } from '../config';
import { LOCAL_ORIGIN } from '../board-model';

// ─── Types ────────────────────────────────────────────────────────────────

export interface TextSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  z: number;
  createdAt: number;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
  width?: number;
  height?: number;
  createdBy?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function getMaxZ(objects: any): number {
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number((val as any).get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

/** Check if an object exists and is a text type. Returns its data map or null. */
function getTextField(objs: any, id: string): { dm: any; textYText: Y.Text | null } | null {
  const dm = getDataMap(objs, id);
  if (!dm) return null;
  const type = String(dm.get('type') ?? '');
  if (type !== 'text') return null;
  const val = dm.get('text');
  return { dm, textYText: val instanceof Y.Text ? val : null };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Create a text object at world coordinates `at`, return its id or null if point is non-finite.
 * Created with size 'M', widthMode 'auto', empty Y.Text, z above all existing objects.
 */
export function createText(
  doc: Y.Doc,
  at: Point,
  createdBy: string,
): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) {
    return null;
  }

  const objects = getDocObjects(doc);
  const maxZ = getMaxZ(objects);

  const id = crypto.randomUUID();
  const dataMap = new Y.Map();
  dataMap.set('type', 'text');
  dataMap.set('x', at.x);
  dataMap.set('y', at.y);
  dataMap.set('size', DEFAULT_TEXT_SIZE);
  dataMap.set('widthMode', 'auto');
  dataMap.set('z', maxZ + 1);
  dataMap.set('createdAt', Date.now());
  dataMap.set('createdBy', createdBy);
  dataMap.set('text', new Y.Text());

  // Initial estimate so bounds exist before first measure
  // Rough estimate: average char ~12px at M size (20) × 1.3 line-height
  const estWidth = 90;
  const estHeight = 20 * 1.3;
  dataMap.set('width', estWidth);
  dataMap.set('height', estHeight);

  doc.transact(() => {
    objects.set(id, dataMap);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Change text size preset. Returns false for stale id or unknown size key.
 */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  const knownSizes = ['S', 'M', 'L', 'XL'];
  if (!knownSizes.includes(size)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const info = getTextField(objects, id);
  if (!info) return false;

  doc.transact(() => {
    info.dm.set('size', size as TextSize);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Set fixed width (clamped to TEXT_MIN_WIDTH_WORLD), switch to 'fixed' mode.
 * Returns false for stale id, non-finite width, or below minimum.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  if (!Number.isFinite(width)) {
    return false;
  }

  const clamped = Math.max(width, TEXT_MIN_WIDTH_WORLD);

  const objects = getDocObjects(doc);
  const info = getTextField(objects, id);
  if (!info) return false;

  doc.transact(() => {
    info.dm.set('width', clamped);
    info.dm.set('widthMode', 'fixed');
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Set stored box dimensions. Returns false for stale id or non-finite values.
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    return false;
  }

  const objects = getDocObjects(doc);
  const dm = getDataMap(objects, id);
  if (!dm) return false;
  const type = String(dm.get('type') ?? '');
  if (type !== 'text') return false;

  doc.transact(() => {
    dm.set('width', box.width);
    dm.set('height', box.height);
  }, LOCAL_ORIGIN);

  return true;
}

/**
 * Get the Y.Text content of a text object by id.
 */
export function getTextContent(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getDocObjects(doc);
  const info = getTextField(objects, id);
  return info?.textYText ?? undefined;
}

/**
 * Check if text has zero characters (whitespace-only counts as non-empty).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const objects = getDocObjects(doc);
  const info = getTextField(objects, id);
  if (!info || !info.textYText) return false;
  return info.textYText.length === 0;
}

/**
 * Return text object snapshots sorted by (z, id). Skips unknown ids.
 */
export function allTextSnapshots(
  doc: Y.Doc,
): readonly TextSnapshot[] {
  const objects = getDocObjects(doc);
  const result: TextSnapshot[] = [];

  for (const [id, val] of objects) {
    if (!(val instanceof Y.Map)) continue;
    const dm = val as any;
    const type = String(dm.get('type') ?? '');
    if (type !== 'text') continue;

    const textVal = dm.get('text');
    const textStr = textVal instanceof Y.Text ? textVal.toString() : '';

    result.push({
      id,
      type: 'text' as const,
      x: Number(dm.get('x') ?? 0),
      y: Number(dm.get('y') ?? 0),
      z: Number(dm.get('z') ?? 0),
      createdAt: Number(dm.get('createdAt') ?? 0),
      text: textStr,
      size: (dm.get('size') as TextSize) || DEFAULT_TEXT_SIZE,
      widthMode: (dm.get('widthMode') as 'auto' | 'fixed') || 'auto',
      createdBy: dm.has('createdBy') ? String(dm.get('createdBy')) : undefined,
      width: dm.has('width') ? Number(dm.get('width')) : undefined,
      height: dm.has('height') ? Number(dm.get('height')) : undefined,
    });
  }

  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  return Object.freeze(result);
}

/**
 * Delete the text object if it is empty. Returns true if deleted.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false;
  const objects = getDocObjects(doc);
  if (!objects.has(id)) return false;
  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

// ─── Internal helpers (duplicated to avoid circular deps with board-model) ───

export function getDocObjects(doc: Y.Doc): any {
  return doc.getMap('objects');
}

function getDataMap(objs: any, id: string): any {
  const val = objs.get(id);
  return val instanceof Y.Map ? val : null;
}
