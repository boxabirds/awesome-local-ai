import * as Y from 'yjs'
import { LOCAL_ORIGIN } from '../board-model'
import {
  SHAPE_KINDS,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from '../config'
import type { ShapeKind, FillColor, StrokeColor } from '../config'
import type { Point, Rect } from '../geometry/types'

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface ShapeSnap {
  id: string
  type: 'shape'
  x: number
  y: number
  width: number
  height: number
  kind: ShapeKind
  fill: FillColor
  stroke: StrokeColor
  label: string
  z: number
  createdAt: number
  createdBy: string
}

// ── helpers ─────────────────────────────────────────────────────────────────

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>
}

function maxZ(doc: Y.Doc): number {
  let max = 0
  objectsMap(doc).forEach((ymap: Y.Map<unknown>) => {
    const z = ymap.get('z') as number | undefined
    if (typeof z === 'number' && z > max) max = z
  })
  return max
}

function isFiniteRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height)
  )
}

// ── createShape ─────────────────────────────────────────────────────────────

/**
 * Create a shape covering `rect` (drag) or a standard-size shape centred on
 * `at` (click / tiny drag).
 *
 * Returns the new id, or `null` for an unknown kind or a non-finite rect/point
 * (no transaction is written on error). `square: true` (Shift held) makes both
 * dimensions equal to the larger dragged dimension, anchored at the drag origin.
 */
export function createShape(
  doc: Y.Doc,
  a: { kind: ShapeKind; rect: Rect | null; at: Point; square?: boolean },
  by: string,
): string | null {
  if (!SHAPE_KINDS.includes(a.kind)) return null
  if (!Number.isFinite(a.at.x) || !Number.isFinite(a.at.y)) return null
  if (a.rect !== null && !isFiniteRect(a.rect)) return null

  let x: number
  let y: number
  let width: number
  let height: number

  const useDefault =
    a.rect === null ||
    a.rect.width < SHAPE_MIN_SIZE_WORLD ||
    a.rect.height < SHAPE_MIN_SIZE_WORLD

  if (useDefault) {
    // A click, or a drag smaller than the minimum shape size in either
    // direction: drop a standard 160×160 shape centred on the point.
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2
    x = a.at.x - half
    y = a.at.y - half
    width = SHAPE_DEFAULT_SIZE_WORLD
    height = SHAPE_DEFAULT_SIZE_WORLD
  } else if (a.square) {
    const side = Math.max(a.rect.width, a.rect.height)
    x = a.rect.x
    y = a.rect.y
    width = side
    height = side
  } else {
    x = a.rect.x
    y = a.rect.y
    width = a.rect.width
    height = a.rect.height
  }

  const id = crypto.randomUUID()

  doc.transact(() => {
    const objects = objectsMap(doc)
    const ymap = new Y.Map<unknown>()
    ymap.set('type', 'shape')
    ymap.set('kind', a.kind)
    ymap.set('x', x)
    ymap.set('y', y)
    ymap.set('width', width)
    ymap.set('height', height)
    ymap.set('fill', DEFAULT_SHAPE_FILL)
    ymap.set('stroke', DEFAULT_SHAPE_STROKE)
    ymap.set('label', new Y.Text())
    ymap.set('z', maxZ(doc) + 1)
    ymap.set('createdAt', Date.now())
    ymap.set('createdBy', by)
    objects.set(id, ymap)
  }, LOCAL_ORIGIN)

  return id
}

// ── setShapeStyle ───────────────────────────────────────────────────────────

function isFillColor(c: string): c is FillColor {
  return Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, c)
}
function isStrokeColor(c: string): c is StrokeColor {
  return Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, c)
}

/**
 * Recolour a shape. Only `fill` and/or `stroke` keys are touched — the label,
 * size, position and z are untouched, and the call is a single transaction.
 *
 * Returns false (no transaction) for a stale id, a non-shape object, an
 * unknown colour, or when neither colour key is supplied.
 */
export function setShapeStyle(
  doc: Y.Doc,
  id: string,
  s: { fill?: string; stroke?: string },
): boolean {
  const ymap = objectsMap(doc).get(id)
  if (!ymap || ymap.get('type') !== 'shape') return false

  const hasFill = s.fill !== undefined
  const hasStroke = s.stroke !== undefined
  if (!hasFill && !hasStroke) return false
  if (hasFill && !isFillColor(s.fill!)) return false
  if (hasStroke && !isStrokeColor(s.stroke!)) return false

  doc.transact(() => {
    if (hasFill) ymap.set('fill', s.fill!)
    if (hasStroke) ymap.set('stroke', s.stroke!)
  }, LOCAL_ORIGIN)

  return true
}

// ── getShapeLabel ─────────────────────────────────────────────────────────────

/** Return the label `Y.Text` of a shape, or undefined for a non-shape/stale id. */
export function getShapeLabel(doc: Y.Doc, id: string): Y.Text | undefined {
  const ymap = objectsMap(doc).get(id)
  if (!ymap || ymap.get('type') !== 'shape') return undefined
  const label = ymap.get('label')
  return label instanceof Y.Text ? label : undefined
}

// ── snapshot ──────────────────────────────────────────────────────────────────

export function snapshotShapes(doc: Y.Doc): readonly ShapeSnap[] {
  const result: ShapeSnap[] = []

  objectsMap(doc).forEach((ymap: Y.Map<unknown>, id: string) => {
    if (ymap.get('type') !== 'shape') return

    const label = ymap.get('label')
    result.push({
      id,
      type: 'shape' as const,
      kind: (ymap.get('kind') as ShapeKind) ?? 'rect',
      x: ymap.get('x') as number,
      y: ymap.get('y') as number,
      width: (ymap.get('width') as number) ?? 0,
      height: (ymap.get('height') as number) ?? 0,
      fill: (ymap.get('fill') as FillColor) ?? DEFAULT_SHAPE_FILL,
      stroke: (ymap.get('stroke') as StrokeColor) ?? DEFAULT_SHAPE_STROKE,
      label: label instanceof Y.Text ? label.toString() : '',
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