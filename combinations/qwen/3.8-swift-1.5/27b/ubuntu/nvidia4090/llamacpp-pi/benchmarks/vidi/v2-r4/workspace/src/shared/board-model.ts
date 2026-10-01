import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_COLORS, DEFAULT_STICKY_COLOR, TEXT_SIZES, type StickyColor, type TextSize } from './config';
import type { Rect, Point } from './geometry';
import type { TextSnapshot } from './objects/text';
import type { ShapeSnap } from './objects/shape';
import type { StrokeSnap } from './objects/stroke';
import type { ImageSnap } from './objects/image';
import type { ConnectorEndpointSnap, ConnectorSnap } from './geometry/connector-geometry';
import { resolveEndpoints, connectorBBox } from './geometry/connector-geometry';
import { detachConnectorsTo } from './objects/connector';

export const LOCAL_ORIGIN: unique symbol = Symbol('LOCAL_ORIGIN');

export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

export interface StickySnapshot extends ObjectSnapshot {
  type: 'sticky';
  color: StickyColor;
  text: string;
  createdAt: number;
}

/** Every object type the client knows how to render. */
export type AnySnapshot = StickySnapshot | TextSnapshot | ShapeSnap | StrokeSnap | ImageSnap | ConnectorSnap;

function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

export function initDoc(doc: Y.Doc): void {
  const meta = getMeta(doc);
  if (meta.get('schemaVersion') === undefined) {
    doc.transact(() => {
      meta.set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function isValidColor(color: string): color is StickyColor {
  return color in STICKY_COLORS;
}

function isFinitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

function isFiniteRect(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = obj.get('z') as number;
    if (typeof z === 'number' && z > maxZ) {
      maxZ = z;
    }
  });
  return maxZ;
}

export function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: StickyColor): string {
  if (!isFinitePoint(at.x, at.y)) return '';
  const id = crypto.randomUUID();
  const finalColor = color ?? DEFAULT_STICKY_COLOR;
  const x = at.x - STICKY_SIZE_WORLD / 2;
  const y = at.y - STICKY_SIZE_WORLD / 2;
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const objects = getObjects(doc);
    const text = new Y.Text();
    const obj = new Y.Map<unknown>();
    obj.set('type', 'sticky');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('color', finalColor);
    obj.set('text', text);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinitePoint(x, y)) return false;
  const count = moveObjects(doc, new Map([[id, { x, y }]]));
  return count > 0;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const count = bringObjectsToFront(doc, [id]);
  return count > 0;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!isValidColor(color)) return false;
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return false;

  const curColor = obj.get('color') as string;
  if (curColor === color) return false;

  doc.transact(() => {
    obj.set('color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const count = deleteObjects(doc, [id]);
  return count > 0;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjects(doc);
  const obj = objects.get(id);
  if (!obj) return undefined;
  const text = obj.get('text');
  if (text instanceof Y.Text) return text;
  return undefined;
}

export function snapshot(doc: Y.Doc): readonly AnySnapshot[] {
  const objects = getObjects(doc);
  const result: AnySnapshot[] = [];

  objects.forEach((obj, id) => {
    const type = obj.get('type') as string;
    if (type === 'sticky') {
      const text = obj.get('text');
      const textStr = text instanceof Y.Text ? text.toString() : '';
      const width = obj.get('width') as number | undefined;
      const height = obj.get('height') as number | undefined;

      result.push({
        id,
        type: 'sticky',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        color: obj.get('color') as StickyColor,
        text: textStr,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
      });
      return;
    }

    if (type === 'text') {
      const text = obj.get('text');
      const textStr = text instanceof Y.Text ? text.toString() : '';
      const width = obj.get('width') as number | undefined;
      const height = obj.get('height') as number | undefined;
      const size = (obj.get('size') as TextSize) ?? 'M';
      const widthMode = obj.get('widthMode') === 'fixed' ? 'fixed' : 'auto';

      result.push({
        id,
        type: 'text',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: typeof width === 'number' ? width : TEXT_SIZES.M,
        height: typeof height === 'number' ? height : TEXT_SIZES.M,
        text: textStr,
        size,
        widthMode,
        z: obj.get('z') as number,
      });
      return;
    }

    if (type === 'shape') {
      const label = obj.get('label');
      const labelStr = label instanceof Y.Text ? label.toString() : '';
      result.push({
        id,
        type: 'shape',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: (obj.get('width') as number) ?? 160,
        height: (obj.get('height') as number) ?? 160,
        kind: obj.get('kind') as 'rect' | 'ellipse' | 'diamond',
        fill: obj.get('fill') as 'none' | 'white' | 'blue' | 'green' | 'yellow' | 'pink' | 'grey',
        stroke: obj.get('stroke') as 'dark' | 'blue' | 'green' | 'orange' | 'red' | 'grey',
        label: labelStr,
        z: obj.get('z') as number,
        createdAt: obj.get('createdAt') as number,
        createdBy: obj.get('createdBy') as string,
      });
      return;
    }

    if (type === 'stroke') {
      const points = obj.get('points');
      const baseWidth = obj.get('baseWidth');
      const baseHeight = obj.get('baseHeight');
      if (
        !Array.isArray(points) ||
        typeof baseWidth !== 'number' ||
        typeof baseHeight !== 'number'
      ) {
        return; // malformed stroke; skip rather than render garbage
      }
      result.push({
        id,
        type: 'stroke',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: (obj.get('width') as number) ?? baseWidth,
        height: (obj.get('height') as number) ?? baseHeight,
        points: points as number[],
        baseWidth,
        baseHeight,
        color: obj.get('color') as StrokeSnap['color'],
        thickness: obj.get('thickness') as StrokeSnap['thickness'],
        z: obj.get('z') as number,
      });
      return;
    }

    if (type === 'image') {
      const status = obj.get('status');
      if (status !== 'uploading' && status !== 'ready' && status !== 'failed') {
        return; // malformed image; skip
      }
      result.push({
        id,
        type: 'image',
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: (obj.get('width') as number) ?? 0,
        height: (obj.get('height') as number) ?? 0,
        assetKey: (obj.get('assetKey') as string | null) ?? null,
        contentType: (obj.get('contentType') as string) ?? 'image/png',
        naturalWidth: (obj.get('naturalWidth') as number) ?? 0,
        naturalHeight: (obj.get('naturalHeight') as number) ?? 0,
        status: status as ImageSnap['status'],
        uploadStartedAt: (obj.get('uploadStartedAt') as number) ?? 0,
        uploaderId: (obj.get('uploaderId') as string) ?? '',
        z: obj.get('z') as number,
      });
      return;
    }

    if (type === 'connector') {
      // Read endpoints from the Y.Map
      const fromM = obj.get('from') as Y.Map<unknown> | undefined;
      const toM = obj.get('to') as Y.Map<unknown> | undefined;

      const readEp = (m: Y.Map<unknown> | undefined): ConnectorEndpointSnap => {
        if (!m) return { kind: 'free', x: 0, y: 0 };
        const k = m.get('kind');
        if (k === 'attached') {
          const fb = m.get('fallback') as Y.Map<unknown> | undefined;
          return {
            kind: 'attached',
            objectId: m.get('objectId') as string,
            fallback: fb ? { x: fb.get('x') as number, y: fb.get('y') as number } : { x: 0, y: 0 },
          };
        }
        return { kind: 'free', x: m.get('x') as number, y: m.get('y') as number };
      };

      const from = readEp(fromM);
      const to = readEp(toM);

      // Build rects map for resolveEndpoints
      const rects = new Map<string, Rect>();
      objects.forEach((o, oid) => {
        const ox = o.get('x') as number;
        const oy = o.get('y') as number;
        const ow = (o.get('width') as number | undefined) ?? STICKY_SIZE_WORLD;
        const oh = (o.get('height') as number | undefined) ?? STICKY_SIZE_WORLD;
        if (Number.isFinite(ox) && Number.isFinite(oy) && Number.isFinite(ow) && Number.isFinite(oh)) {
          rects.set(oid, { x: ox, y: oy, width: ow, height: oh });
        }
      });

      const { from: fromPt, to: toPt } = resolveEndpoints({ from, to }, rects);
      const bbox = connectorBBox(fromPt, toPt);

      result.push({
        id,
        type: 'connector',
        from,
        to,
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
        z: obj.get('z') as number,
      });
      return;
    }

    // Unknown types are skipped, never rendered (compatibility).
  });

  result.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  return result;
}

// ─── Story 7: Group operations ────────────────────────────────────────────────

/**
 * Returns the bounding rect of an object. For sticky notes without explicit
 * width/height, falls back to STICKY_SIZE_WORLD.
 */
export function objectBounds(obj: ObjectSnapshot): Rect {
  const width = obj.width ?? STICKY_SIZE_WORLD;
  const height = obj.height ?? STICKY_SIZE_WORLD;
  return { x: obj.x, y: obj.y, width, height };
}

/**
 * Returns the ids of all objects whose bounds are entirely inside the given rect.
 */
export function objectsInRect(snapshot: readonly ObjectSnapshot[], rect: Rect): string[] {
  const result: string[] = [];
  for (const obj of snapshot) {
    if (rectContainsLocal(rect, objectBounds(obj))) {
      result.push(obj.id);
    }
  }
  return result;
}

function rectContainsLocal(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Returns the ids of all objects with a registered type.
 * The registry is checked via a callback to avoid circular imports.
 */
let registeredTypes: Set<string> | null = null;

export function setRegisteredTypes(types: Set<string>): void {
  registeredTypes = types;
}

export function allObjectIds(snapshot: readonly ObjectSnapshot[]): string[] {
  const types = registeredTypes;
  if (!types) {
    // Fallback: include all objects if registry not initialized
    return snapshot.map((o) => o.id);
  }
  return snapshot.filter((o) => types.has(o.type)).map((o) => o.id);
}

/**
 * Moves multiple objects to absolute positions.
 * Returns the count of objects actually moved.
 * Non-finite values or empty id list → 0, no transaction.
 * Missing ids are skipped.
 */
export function moveObjects(doc: Y.Doc, positions: ReadonlyMap<string, Point>): number {
  if (positions.size === 0) return 0;

  // Validate all positions are finite
  for (const pos of positions.values()) {
    if (!isFinitePoint(pos.x, pos.y)) return 0;
  }

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    for (const [id, pos] of positions) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', pos.x);
      obj.set('y', pos.y);
      changed++;
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Resizes multiple objects to the given rects.
 * Writes width and height fields (making implicit-size stickies explicit).
 * Returns the count of objects actually resized.
 * Non-finite values or empty id list → 0, no transaction.
 */
export function resizeObjects(doc: Y.Doc, rects: ReadonlyMap<string, Rect>): number {
  if (rects.size === 0) return 0;

  // Validate all rects are finite
  for (const r of rects.values()) {
    if (!isFiniteRect(r)) return 0;
  }

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    for (const [id, r] of rects) {
      const obj = objects.get(id);
      if (!obj) continue;
      obj.set('x', r.x);
      obj.set('y', r.y);
      obj.set('width', r.width);
      obj.set('height', r.height);
      changed++;
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Brings the given objects to the front (above all unselected objects)
 * while preserving their relative stacking order.
 * Returns the count of objects whose z was changed.
 */
export function bringObjectsToFront(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  const idSet = new Set(ids);

  // Collect current z values of selected objects, sorted
  const selectedEntries: { id: string; z: number }[] = [];
  for (const id of ids) {
    const obj = objects.get(id);
    if (obj) {
      selectedEntries.push({ id, z: obj.get('z') as number });
    }
  }
  if (selectedEntries.length === 0) return 0;

  selectedEntries.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

  // Find max z of unselected objects
  let maxUnselectedZ = 0;
  objects.forEach((obj, id) => {
    if (!idSet.has(id)) {
      const z = obj.get('z') as number;
      if (typeof z === 'number' && z > maxUnselectedZ) {
        maxUnselectedZ = z;
      }
    }
  });

  let changed = 0;
  doc.transact(() => {
    for (let i = 0; i < selectedEntries.length; i++) {
      const newZ = maxUnselectedZ + 1 + i;
      const obj = objects.get(selectedEntries[i].id);
      if (obj && (obj.get('z') as number) !== newZ) {
        obj.set('z', newZ);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);

  return changed;
}

/**
 * Deletes multiple objects. Returns the count of objects actually deleted.
 * Empty id list → 0, no transaction. Missing ids are skipped.
 */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): number {
  if (ids.length === 0) return 0;

  const objects = getObjects(doc);
  let changed = 0;

  doc.transact(() => {
    // Detach connectors to deleted objects before removing them
    detachConnectorsTo(doc, ids);
    for (const id of ids) {
      if (objects.has(id)) {
        objects.delete(id);
        changed++;
      }
    }
  }, LOCAL_ORIGIN);

  return changed;
}
