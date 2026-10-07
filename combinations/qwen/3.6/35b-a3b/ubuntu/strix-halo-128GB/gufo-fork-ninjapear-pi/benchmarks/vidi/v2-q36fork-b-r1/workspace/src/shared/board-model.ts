import * as Y from 'yjs';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
} from './config';
import type { StickyColor } from './config';

export const LOCAL_ORIGIN = 'local-origin';

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

/** Initialise the document meta if absent. */
export function initDoc(doc: Y.Doc): void {
  if (!doc.getMap('meta').get('schemaVersion')) {
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
  }
}

function getObjectsMap(doc: Y.Doc): unknown {
  return doc.getMap('objects');
}

function getField(inner: any, key: string): any {
  try {
    return inner.get(key);
  } catch {
    return undefined;
  }
}

function setField(inner: any, key: string, val: any): void {
  inner.set(key, val);
}

function getMaxZ(objects: unknown): number {
  let max = 0;
  const objMap = objects as Y.Map<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (objMap as any).forEach((inner: any) => {
    if (typeof inner?.get === 'function') {
      const z = Number(getField(inner, 'z'));
      if (z > max) max = z;
    }
  });
  return max;
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color?: StickyColor,
): string {
  if (!isFinite(at.x) || !isFinite(at.y)) {
    return '';
  }
  const objects = getObjectsMap(doc);
  const maxZ = getMaxZ(objects);
  const id = crypto.randomUUID();
  const inner = new Y.Map() as Y.Map<unknown>;

  doc.transact(() => {
    setField(inner, 'type', 'sticky');
    setField(inner, 'x', at.x);
    setField(inner, 'y', at.y);
    setField(inner, 'color', color ?? DEFAULT_STICKY_COLOR);
    setField(inner, 'text', new Y.Text());
    setField(inner, 'z', maxZ + 1);
    setField(inner, 'createdAt', Date.now());
    (objects as any).set(id, inner);
  }, LOCAL_ORIGIN);

  return id;
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!isFinite(x) || !isFinite(y)) return false;
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    setField(inner, 'x', x);
    setField(inner, 'y', y);
  }, LOCAL_ORIGIN);
  return true;
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  const currentZ = getField(inner, 'z') ?? 0;
  const maxZ = getMaxZ(objects);
  if (currentZ === maxZ) return false;

  doc.transact(() => {
    setField(inner, 'z', maxZ + 1);
  }, LOCAL_ORIGIN);
  return true;
}

export function setStickyColor(doc: Y.Doc, id: string, color: string): boolean {
  if (!(color in STICKY_COLORS)) return false;
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return false;

  doc.transact(() => {
    setField(inner, 'color', color);
  }, LOCAL_ORIGIN);
  return true;
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  if (!(objects as any).has(id)) return false;

  doc.transact(() => {
    objects.delete(id);
  }, LOCAL_ORIGIN);
  return true;
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const inner = objects.get(id);
  if (!inner || typeof inner.get !== 'function') return undefined;
  const textVal = getField(inner, 'text');
  if (textVal instanceof Y.Text) return textVal;
  return undefined;
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc) as Y.Map<any>;
  const result: StickySnapshot[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (objects as any).forEach((raw: any, key: string) => {
    if (!raw || typeof raw.get !== 'function') return;
    const inner = raw;
    const type = getField(inner, 'type');
    if (type !== 'sticky') return;

    result.push({
      id: key,
      type: 'sticky' as const,
      x: Number(getField(inner, 'x')) ?? 0,
      y: Number(getField(inner, 'y')) ?? 0,
      color: (getField(inner, 'color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: (() => {
        const t = getField(inner, 'text');
        if (t instanceof Y.Text) return t.toString();
        return String(t ?? '');
      })(),
      z: Number(getField(inner, 'z')) ?? 0,
      createdAt: Number(getField(inner, 'createdAt')) ?? 0,
    });
  });

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return Object.freeze(result);
}
