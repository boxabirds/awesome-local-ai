import * as Y from 'yjs'
import { STICKY_SIZE_WORLD, DEFAULT_STICKY_COLOR } from './config'
import type { StickyColor } from './config'
import { detachConnectorsTo } from './objects/connector'

export const LOCAL_ORIGIN: unique symbol = Symbol('local')

export interface StickySnapshot {
  id: string
  type: 'sticky'
  x: number
  y: number
  color: StickyColor
  text: string
  z: number
  createdAt: number
}

// ── internal helpers ──────────────────────────────────────────────────────────

function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>
}

function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta')
}

function isValidColor(c: string): c is StickyColor {
  return ['yellow','orange','green','blue','pink','violet'].includes(c)
}

function maxZ(doc: Y.Doc): number {
  const objects = getObjectsMap(doc)
  let max = 0
  objects.forEach((ymap: Y.Map<unknown>) => {
    const z = ymap.get('z') as number | undefined
    if (typeof z === 'number' && z > max) max = z
  })
  return max
}

// ── exported API ──────────────────────────────────────────────────────────────

export function initDoc(doc: Y.Doc): void {
  const meta = getMetaMap(doc)
  if (!meta.get('schemaVersion')) {
    doc.transact(() => {
      meta.set('schemaVersion', 1)
    }, LOCAL_ORIGIN)
  }
}

export function createSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  color: StickyColor = DEFAULT_STICKY_COLOR,
): string {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return ''

  const id = crypto.randomUUID()
  const half = STICKY_SIZE_WORLD / 2

  doc.transact(() => {
    const objects = getObjectsMap(doc)
    const z = maxZ(doc) + 1

    const ymap = new Y.Map<unknown>()
    ymap.set('type', 'sticky')
    ymap.set('x', at.x - half)
    ymap.set('y', at.y - half)
    ymap.set('color', color)
    ymap.set('text', new Y.Text())
    ymap.set('z', z)
    ymap.set('createdAt', Date.now())
    objects.set(id, ymap)
  }, LOCAL_ORIGIN)

  return id
}

export function moveObject(doc: Y.Doc, id: string, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false

  const objects = getObjectsMap(doc)
  const ymap = objects.get(id)
  if (!ymap) return false
  const t = ymap.get('type')
  if (t !== 'sticky' && t !== 'text' && t !== 'shape') return false

  doc.transact(() => {
    ymap.set('x', x)
    ymap.set('y', y)
  }, LOCAL_ORIGIN)

  return true
}

export function bringToFront(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc)
  const ymap = objects.get(id)
  if (!ymap) return false
  const t = ymap.get('type')
  if (t !== 'sticky' && t !== 'text' && t !== 'shape') return false

  const currentZ = ymap.get('z') as number
  const topZ = maxZ(doc)
  if (currentZ >= topZ) return false

  doc.transact(() => {
    ymap.set('z', topZ + 1)
  }, LOCAL_ORIGIN)

  return true
}

/**
 * Resize a shape (used by ShapeObject's resize handles). Sticky notes are a
 * fixed size, so only shape objects accept a resize. One LOCAL_ORIGIN
 * transaction; non-finite or negative dimensions return false (no write).
 */
export function resizeObject(
  doc: Y.Doc,
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (![x, y, width, height].every(n => Number.isFinite(n))) return false
  if (width <= 0 || height <= 0) return false

  const objects = getObjectsMap(doc)
  const ymap = objects.get(id)
  if (!ymap || ymap.get('type') !== 'shape') return false

  doc.transact(() => {
    ymap.set('x', x)
    ymap.set('y', y)
    ymap.set('width', width)
    ymap.set('height', height)
  }, LOCAL_ORIGIN)

  return true
}

export function setStickyColor(
  doc: Y.Doc,
  id: string,
  color: string,
): boolean {
  if (!isValidColor(color)) return false

  const objects = getObjectsMap(doc)
  const ymap = objects.get(id)
  if (!ymap || ymap.get('type') !== 'sticky') return false

  doc.transact(() => {
    ymap.set('color', color)
  }, LOCAL_ORIGIN)

  return true
}

export function deleteObject(doc: Y.Doc, id: string): boolean {
  const objects = getObjectsMap(doc)
  if (!objects.has(id)) return false

  doc.transact(() => {
    // Arrows keep their place: any end attached to a deleted object is fixed
    // at the point where it was attached (connector.target_deleted).
    detachConnectorsTo(doc, [id])
    objects.delete(id)
  }, LOCAL_ORIGIN)

  return true
}

export function getStickyText(doc: Y.Doc, id: string): Y.Text | undefined {
  const objects = getObjectsMap(doc)
  const ymap = objects.get(id)
  if (!ymap || ymap.get('type') !== 'sticky') return undefined
  const text = ymap.get('text')
  return text instanceof Y.Text ? text : undefined
}

export function snapshot(doc: Y.Doc): readonly StickySnapshot[] {
  const objects = getObjectsMap(doc)
  const result: StickySnapshot[] = []

  objects.forEach((ymap: Y.Map<unknown>, id: string) => {
    const type = ymap.get('type')
    if (type !== 'sticky') return

    const text = ymap.get('text')
    const textStr = text instanceof Y.Text ? (text as Y.Text).toString() : ''

    result.push({
      id,
      type: 'sticky' as const,
      x: ymap.get('x') as number,
      y: ymap.get('y') as number,
      color: (ymap.get('color') as StickyColor) ?? DEFAULT_STICKY_COLOR,
      text: textStr,
      z: (ymap.get('z') as number) ?? 0,
      createdAt: (ymap.get('createdAt') as number) ?? 0,
    })
  })

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return Object.freeze(result)
}
