import * as Y from 'yjs'
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../config'
import type { TextSize } from '../config'
import { LOCAL_ORIGIN } from '../board-model'

// ── Snapshot type for rendering ──────────────────────────────────────────────

export interface TextSnapshot {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  text: string
  size: TextSize
  widthMode: 'auto' | 'fixed'
  z: number
  createdAt: number
  createdBy: string
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>
}

function maxZ(doc: Y.Doc): number {
  const objects = objectsMap(doc)
  let max = 0
  objects.forEach((ymap: Y.Map<unknown>) => {
    const z = ymap.get('z') as number | undefined
    if (typeof z === 'number' && z > max) max = z
  })
  return max
}

function isText(id: string, doc: Y.Doc): Y.Map<unknown> | null {
  const ymap = objectsMap(doc).get(id)
  if (!ymap || ymap.get('type') !== 'text') return null
  return ymap
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new text object at world-space point `at`.
 * Returns the new id or `null` if the point is not finite.
 * Top-left is at `at`; default size is M, default width mode is auto.
 */
export function createText(
  doc: Y.Doc,
  at: { x: number; y: number },
  createdBy: string,
): string | null {
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return null

  const id = crypto.randomUUID()

  doc.transact(() => {
    const objects = objectsMap(doc)
    const z = maxZ(doc) + 1
    const ymap = new Y.Map<unknown>()
    ymap.set('type', 'text')
    ymap.set('x', at.x)
    ymap.set('y', at.y)
    // Initial box is a rough single-line M default; useTextBoxSync will
    // immediately remeasure after the first keystroke.
    ymap.set('width', 0)
    ymap.set('height', 0)
    ymap.set('z', z)
    ymap.set('createdAt', Date.now())
    ymap.set('createdBy', createdBy)
    ymap.set('text', new Y.Text())
    ymap.set('size', DEFAULT_TEXT_SIZE)
    ymap.set('widthMode', 'auto')
    objects.set(id, ymap)
  }, LOCAL_ORIGIN)

  return id
}

/**
 * Set the size preset.
 * Returns false for unknown size keys (error path) and leaves the object unchanged.
 */
export function setTextSize(
  doc: Y.Doc,
  id: string,
  size: string,
): boolean {
  if (!size || !(size in TEXT_SIZES)) return false
  const ymap = isText(id, doc)
  if (!ymap) return false

  doc.transact(() => {
    ymap.set('size', size)
  }, LOCAL_ORIGIN)
  return true
}

/**
 * Set a fixed width, clamped to at least TEXT_MIN_WIDTH_WORLD.
 * Also sets widthMode to 'fixed'.
 */
export function setTextWidthFixed(
  doc: Y.Doc,
  id: string,
  width: number,
): boolean {
  const ymap = isText(id, doc)
  if (!ymap) return false

  const clamped = Math.max(TEXT_MIN_WIDTH_WORLD, width)

  doc.transact(() => {
    ymap.set('widthMode', 'fixed')
    ymap.set('width', clamped)
  }, LOCAL_ORIGIN)
  return true
}

/**
 * Store the computed width and height.
 * Returns false if the box hasn't changed (negative path to avoid redundant writes).
 */
export function setTextBox(
  doc: Y.Doc,
  id: string,
  box: { width: number; height: number },
): boolean {
  const ymap = isText(id, doc)
  if (!ymap) return false

  const curW = ymap.get('width') as number
  const curH = ymap.get('height') as number
  if (curW === box.width && curH === box.height) return false

  doc.transact(() => {
    ymap.set('width', box.width)
    ymap.set('height', box.height)
  }, LOCAL_ORIGIN)
  return true
}

/** Return the Y.Text of a text object, or undefined if not a text object. */
export function getTextContent(
  doc: Y.Doc,
  id: string,
): Y.Text | undefined {
  const ymap = isText(id, doc)
  if (!ymap) return undefined
  const text = ymap.get('text')
  return text instanceof Y.Text ? text : undefined
}

/**
 * Returns true when the object contains zero characters.
 * Whitespace-only content is NOT considered empty (only zero-length counts).
 */
export function isEmptyText(doc: Y.Doc, id: string): boolean {
  const ytext = getTextContent(doc, id)
  if (!ytext) return true
  return ytext.length === 0
}

/**
 * Delete the text object if it is empty (zero characters).
 * Returns true when the object was deleted, false otherwise.
 */
export function deleteIfEmpty(doc: Y.Doc, id: string): boolean {
  if (!isEmptyText(doc, id)) return false
  const objects = objectsMap(doc)
  if (!objects.has(id)) return false
  doc.transact(() => {
    objects.delete(id)
  }, LOCAL_ORIGIN)
  return true
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────

/**
 * Take a snapshot of all text objects in the document.
 */
export function snapshotText(doc: Y.Doc): readonly TextSnapshot[] {
  const objects = objectsMap(doc)
  const result: TextSnapshot[] = []

  objects.forEach((ymap: Y.Map<unknown>, id: string) => {
    const type = ymap.get('type')
    if (type !== 'text') return

    const text = ymap.get('text')
    const textStr = text instanceof Y.Text ? text.toString() : ''

    result.push({
      id,
      type: 'text' as const,
      x: ymap.get('x') as number,
      y: ymap.get('y') as number,
      width: (ymap.get('width') as number) ?? 0,
      height: (ymap.get('height') as number) ?? 0,
      text: textStr,
      size: (ymap.get('size') as TextSize) ?? DEFAULT_TEXT_SIZE,
      widthMode: (ymap.get('widthMode') as 'auto' | 'fixed') ?? 'auto',
      z: (ymap.get('z') as number) ?? 0,
      createdAt: (ymap.get('createdAt') as number) ?? 0,
      createdBy: (ymap.get('createdBy') as string) ?? '',
    })
  })

  result.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return Object.freeze(result)
}
