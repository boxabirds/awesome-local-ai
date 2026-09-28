import * as Y from 'yjs';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
  type TextSize,
  type ShapeKind,
  type FillColor,
  type StrokeColor,
} from './config';
import { type Rect, rectContains } from './geometry';
import {
  sideAnchor,
  nearestSide,
  type Endpoint,
  resolveEndpoints,
  connectorBBox,
} from './geometry/connector-geometry';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  width?: number;
  height?: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

export interface TextObjectSnapshot {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

export interface ShapeObjectSnapshot {
  id: string;
  type: 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  kind: ShapeKind;
  fill: FillColor;
  stroke: StrokeColor;
  label: string;
  text: string; // alias for label, for union compatibility
}

/** Generic object snapshot - any type that can appear on the board */
export type ObjectSnapshot = StickySnapshot | TextObjectSnapshot | ShapeObjectSnapshot | ConnectorObjectSnapshot;

export interface ConnectorObjectSnapshot {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  createdAt: number;
  createdBy: string;
  from: Endpoint;
  to: Endpoint;
  text: string; // empty, for union compatibility
}

const COLOR_KEYS: Set<string> = new Set(Object.keys(STICKY_COLORS));

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function isValidFinite(n: number): boolean {
  return Number.isFinite(n);
}

export function initDoc(doc: Y.Doc): void {
  const meta = doc.getMap('meta');
  if (!meta.has('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    });
  }
  // Ensure objects map exists
  doc.getMap('objects');
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!isValidFinite(at.x) || !isValidFinite(at.y)) {
    throw new Error('createSticky requires finite coordinates');
  }
  const id = crypto.randomUUID();
  const chosenColor: StickyColor = color ?? DEFAULT_STICKY_COLOR;
  const objects = objectsMap(doc);
  doc.transact(() => {
    // Compute max z
    let maxZ = 0;
    objects.forEach((obj) => {
      const z = obj.get('z') as number;
      if (z > maxZ) maxZ = z;
    });
    const yMap = new Y.Map<unknown>();
    yMap.set('type', 'sticky');
    yMap.set('x', at.x - STICKY_SIZE_WORLD / 2);
    yMap.set('y', at.y - STICKY_SIZE_WORLD / 2);
    yMap.set('color', chosenColor);
    yMap.set('text', new Y.Text(''));
    yMap.set('z', maxZ + 1);
    yMap.set('createdAt', Date.now());
    objects.set(id, yMap);
  }, LOCAL_ORIGIN);
  return id;
}

// ─── Story 2 single-object functions (wrappers) ─────────────────────────────

export function moveObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
): boolean {
  if (!isValidFinite(x) || !isValidFinite(y)) return false;
  const positions = new Map<string, { x: number; y: number }>([[id, { x, y }]]);
  return moveObjects(doc, positions) > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  return bringObjectsToFront(doc, [id]) > 0;
}

export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!COLOR_KEYS.has(color)) return false;
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return false;
  if (obj.get('color') === color) return false;
  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  return deleteObjects(doc, [id]) > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = objectsMap(doc);
  const obj = objects.get(id);
  if (!obj || obj.get('type') !== 'sticky') return undefined;
  return obj.get('text') as Y.Text;
}

export function snapshot(doc: Y.Doc): readonly ObjectSnapshot[] {
  const objects = objectsMap(doc);
  const result: ObjectSnapshot[] = [];
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'sticky') {
      const snap: StickySnapshot = {
        id,
        type: 'sticky',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        color: obj.get('color') as StickyColor,
        text: (obj.get('text') as Y.Text).toString(),
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
      };
      const w = obj.get('width') as number | undefined;
      const h = obj.get('height') as number | undefined;
      if (w != null && h != null) {
        snap.width = w;
        snap.height = h;
      }
      result.push(snap);
    } else if (type === 'text') {
      const snap: TextObjectSnapshot = {
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        createdBy: (obj.get('createdBy') as string) ?? '',
        text: (obj.get('text') as Y.Text).toString(),
        size: obj.get('size') as TextSize,
        widthMode: obj.get('widthMode') as 'auto' | 'fixed',
      };
      result.push(snap);
    } else if (type === 'shape') {
      const labelYText = obj.get('label');
      if (!labelYText || !(labelYText instanceof Y.Text)) {
        // Malformed shape object (missing required fields) - skip
        return;
      }
      const snap: ShapeObjectSnapshot = {
        id,
        type: 'shape',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        createdBy: (obj.get('createdBy') as string) ?? '',
        kind: obj.get('kind') as ShapeKind,
        fill: obj.get('fill') as FillColor,
        stroke: obj.get('stroke') as StrokeColor,
        label: (obj.get('label') as Y.Text).toString(),
        text: (obj.get('label') as Y.Text).toString(),
      };
      result.push(snap);
    } else if (type === 'connector') {
      // Connector bbox derived from resolved endpoints - handled after loop
    }
  });
  // Second pass: resolve connector bboxes
  const rects = new Map<string, Rect>();
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'connector') return;
    const x = obj.get('x') as number;
    const y = obj.get('y') as number;
    let w = obj.get('width') as number | undefined;
    let h = obj.get('height') as number | undefined;
    if (w == null || h == null) {
      w = STICKY_SIZE_WORLD;
      h = STICKY_SIZE_WORLD;
    }
    rects.set(id, { x, y, width: w, height: h });
  });
  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type !== 'connector') return;
    const from = obj.get('from') as Endpoint;
    const to = obj.get('to') as Endpoint;
    const resolved = resolveEndpoints(from, to, rects);
    const bbox = connectorBBox(resolved.from, resolved.to);
    const snap: ConnectorObjectSnapshot = {
      id,
      type: 'connector',
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height,
      z: obj.get('z') as number,
      createdAt: obj.get('createdAt') as number,
      createdBy: (obj.get('createdBy') as string) ?? '',
      from,
      to,
      text: '',
    };
    result.push(snap);
  });
  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return result;
}

// ─── Story 7: Group operations ───────────────────────────────────────────────

/**
 * Get the bounding rect of an object snapshot, falling back to STICKY_SIZE_WORLD
 * for stickies without explicit width/height.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  if (obj.type === 'connector') {
    return { x: obj.x, y: obj.y, width: obj.width || 1, height: obj.height || 1 };
  }
  if (obj.type === 'text') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  if (obj.type === 'shape') {
    return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
  }
  return {
    x: obj.x,
    y: obj.y,
    width: (obj as StickySnapshot).width ?? STICKY_SIZE_WORLD,
    height: (obj as StickySnapshot).height ?? STICKY_SIZE_WORLD,
  };
}

/**
 * Return ids of objects entirely inside the given rect.
 */
export function objectsInRect(
  snapshotArr: readonly ObjectSnapshot[],
  rect: Rect,
): string[] {
  const result: string[] = [];
  for (const obj of snapshotArr) {
    const bounds = objectBounds(obj);
    if (rectContains(rect, bounds)) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Return all registered object ids (currently 'sticky' and 'text').
 */
export function allObjectIds(
  snapshotArr: readonly ObjectSnapshot[],
): string[] {
  const knownTypes = new Set(['sticky', 'text', 'shape']);  const result: string[] = [];
  for (const obj of snapshotArr) {
    if (knownTypes.has(obj.type)) {
      result.push(obj.id);
    }
  }
  return result;
}

/**
 * Move objects to absolute positions. Non-finite values are rejected.
 * Missing ids are skipped. Returns count of objects actually moved.
 * One transaction per call.
 */
export function moveObjects(
  doc: Y.Doc,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): number {
  if (positions.size === 0) return 0;
  const objects = objectsMap(doc);

  // Validate: all positions must be finite
  for (const [, pos] of positions) {
    if (!isValidFinite(pos.x) || !isValidFinite(pos.y)) return 0;
  }

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
 * Resize objects to absolute rects. Writes width and height (making implicit-size stickies explicit).
 * Non-finite values are rejected. Missing ids are skipped. Returns count of objects actually resized.
 * One transaction per call.
 */
export function resizeObjects(
  doc: Y.Doc,
  rects: ReadonlyMap<string, Rect>,
): number {
  if (rects.size === 0) return 0;
  const objects = objectsMap(doc);

  // Validate: all rects must have finite values
  for (const [, rect] of rects) {
    if (!isValidFinite(rect.x) || !isValidFinite(rect.y) ||
        !isValidFinite(rect.width) || !isValidFinite(rect.height)) return 0;
  }

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
 * Bring objects to front: all selected ids get z values above all unselected objects,
 * preserving their relative order. Returns count of objects whose z changed.
 */
export function bringObjectsToFront(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  const idSet = new Set(ids);

  // Find max z among unselected
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (!idSet.has(id)) {
      const z = obj.get('z') as number;
      if (z > maxUnselectedZ) maxUnselectedZ = z;
    }
  });

  // Sort selected by current z to preserve relative order
  const selected: Array<{ id: string; z: number }> = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (!obj) continue;
    selected.push({ id, z: obj.get('z') as number });
  }
  selected.sort((a, b) => a.z - b.z);

  let count = 0;
  doc.transact(() => {
    for (let i = 0; i < selected.length; i++) {
      const newZ = maxUnselectedZ + i + 1;
      const obj = objects.get(selected[i].id);
      if (!obj) continue;
      if (obj.get('z') !== newZ) {
        obj.set('z', newZ);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}

/**
 * Delete objects by id. Missing ids are skipped. Returns count actually deleted.
 * One transaction per call.
 */
export function deleteObjects(
  doc: Y.Doc,
  ids: readonly string[],
): number {
  if (ids.length === 0) return 0;
  const objects = objectsMap(doc);
  let count = 0;
  doc.transact(() => {
    // Detach connector endpoints pointing at deleted ids
    const idSet = new Set(ids);
    const rects = new Map<string, Rect>();
    objects.forEach((obj, oid) => {
      const t = obj.get('type') as string;
      if (t === 'connector') return;
      const x = obj.get('x') as number;
      const y = obj.get('y') as number;
      let w = obj.get('width') as number | undefined;
      let h = obj.get('height') as number | undefined;
      if (w == null || h == null) { w = STICKY_SIZE_WORLD; h = STICKY_SIZE_WORLD; }
      rects.set(oid, { x, y, width: w, height: h });
    });
    objects.forEach((obj) => {
      if (obj.get('type') !== 'connector') return;
      const from = obj.get('from') as Endpoint | undefined;
      const to = obj.get('to') as Endpoint | undefined;
      if (!from || !to) return;
      if (from.kind === 'attached' && idSet.has(from.objectId)) {
        const r = rects.get(from.objectId);
        if (r) {
          const otherPt = to.kind === 'free' ? { x: to.x, y: to.y } : (() => { const or2 = rects.get(to.objectId); return or2 ? { x: or2.x + or2.width / 2, y: or2.y + or2.height / 2 } : { x: to.fallback.x, y: to.fallback.y }; })();
          const anchor = sideAnchor(r, nearestSide(r, otherPt));
          obj.set('from', { kind: 'free', x: anchor.x, y: anchor.y });
        } else {
          obj.set('from', { kind: 'free', x: from.fallback.x, y: from.fallback.y });
        }
      }
      if (to.kind === 'attached' && idSet.has(to.objectId)) {
        const r = rects.get(to.objectId);
        if (r) {
          const otherPt = from.kind === 'free' ? { x: from.x, y: from.y } : (() => { const or2 = rects.get(from.objectId); return or2 ? { x: or2.x + or2.width / 2, y: or2.y + or2.height / 2 } : { x: from.fallback.x, y: from.fallback.y }; })();
          const anchor = sideAnchor(r, nearestSide(r, otherPt));
          obj.set('to', { kind: 'free', x: anchor.x, y: anchor.y });
        } else {
          obj.set('to', { kind: 'free', x: to.fallback.x, y: to.fallback.y });
        }
      }
    });
    // Delete the objects
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        count++;
      }
    }
  }, LOCAL_ORIGIN);
  return count;
}
