import React, { useLayoutEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { ShapeSnap } from '../../shared/objects/shape'
import { bringToFront, moveObject, resizeObject } from '../../shared/board-model'
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  DRAG_THRESHOLD_PX,
} from '../../shared/config'

export interface ShapeObjectProps {
  shape: ShapeSnap
  doc: Y.Doc
  zoom: number
  selected: boolean
  editing: boolean
  onSelect(id: string): void
  onStartEdit(id: string): void
  onEndEdit(next: 'selected' | 'unselected'): void
  onDragStart(id: string): void
  onDragEnd(id: string): void
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * Renders one shape: a `rect`, `ellipse` or `diamond` polygon sized to the
 * object with a `SHAPE_STROKE_WIDTH_WORLD` outline, plus a centred wrapping
 * label. Double-click edits the label; the whole object moves on drag; a
 * bottom-right handle resizes it. Selection / hit-testing use the bounding box.
 */
export function ShapeObject(props: ShapeObjectProps) {
  const { shape, doc, selected, editing } = props
  const shapeId = shape.id

  const zoomRef = useRef(props.zoom)
  zoomRef.current = props.zoom
  const cbRef = useRef(props)
  cbRef.current = props

  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startShapeX: number
    startShapeY: number
    startW: number
    startH: number
    startClientX: number
    startClientY: number
    active: boolean
    pendingX: number
    pendingY: number
    pendingW: number
    pendingH: number
    raf: number | null
  } | null>(null)

  // ── shared window drag handlers (move + resize) ──────────────────────────
  React.useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      if (!d.active) {
        if (dist(d.startClientX, d.startClientY, e.clientX, e.clientY) < DRAG_THRESHOLD_PX) return
        d.active = true
        if (d.mode === 'move') {
          bringToFront(doc, shapeId)
          cbRef.current.onDragStart(shapeId)
        }
      }
      const z = zoomRef.current
      if (d.mode === 'move') {
        d.pendingX = d.startShapeX + (e.clientX - d.startClientX) / z
        d.pendingY = d.startShapeY + (e.clientY - d.startClientY) / z
      } else {
        d.pendingW = Math.max(SHAPE_MIN_SIZE_WORLD, d.startW + (e.clientX - d.startClientX) / z)
        d.pendingH = Math.max(SHAPE_MIN_SIZE_WORLD, d.startH + (e.clientY - d.startClientY) / z)
      }
      if (d.raf === null) {
        d.raf = requestAnimationFrame(() => {
          const dd = dragRef.current
          if (!dd || !dd.active) return
          dd.raf = null
          const ok = dd.mode === 'move'
            ? moveObject(doc, shapeId, dd.pendingX, dd.pendingY)
            : resizeObject(doc, shapeId, dd.startShapeX, dd.startShapeY, dd.pendingW, dd.pendingH)
          if (!ok) {
            dragRef.current = null
            cbRef.current.onDragEnd(shapeId)
          }
        })
      }
    }
    function endDrag() {
      const d = dragRef.current
      if (!d) return
      if (d.raf !== null) { cancelAnimationFrame(d.raf); d.raf = null }
      dragRef.current = null
      cbRef.current.onDragEnd(shapeId)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('lostpointercapture', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('lostpointercapture', endDrag)
    }
  }, [shapeId, doc])

  function beginDrag(e: React.PointerEvent, mode: 'move' | 'resize') {
    if (editing) return
    e.stopPropagation()
    cbRef.current.onSelect(shapeId)
    dragRef.current = {
      mode,
      startShapeX: shape.x,
      startShapeY: shape.y,
      startW: shape.width,
      startH: shape.height,
      startClientX: e.clientX,
      startClientY: e.clientY,
      active: false,
      pendingX: shape.x,
      pendingY: shape.y,
      pendingW: shape.width,
      pendingH: shape.height,
      raf: null,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return
    beginDrag(e, 'move')
  }

  function handleResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (editing) return
    cbRef.current.onSelect(shapeId)
    beginDrag(e, 'resize')
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    if (!editing) cbRef.current.onStartEdit(shapeId)
  }

  // ── label editing ──────────────────────────────────────────────────────────
  const labelYText = editing
    ? (doc.getMap('objects').get(shapeId) as Y.Map<unknown> | undefined)?.get('label') as Y.Text | undefined
    : undefined

  const fill = SHAPE_FILL_COLORS[shape.fill] ?? 'transparent'
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark
  const inset = SHAPE_STROKE_WIDTH_WORLD / 2

  const shapeEl = renderShape(shape, fill, stroke, inset)

  return (
    <div
      data-testid="shape-object"
      data-shape-id={shape.id}
      data-shape-kind={shape.kind}
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={`${shape.kind}${shape.label ? ', ' + shape.label : ''}`}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        pointerEvents: 'auto',
        cursor: editing ? 'text' : 'default',
        outline: selected ? `${2 / zoomScale(props.zoom)}px solid #4285f4` : 'none',
      }}
    >
      {/* Vector shape fills the object box (pointer pass-through to the div). */}
      <svg
        width={shape.width}
        height={shape.height}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      >
        {shapeEl}
      </svg>

      {/* Label: centred horizontally + vertically, wraps to the shape width. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 4,
          boxSizing: 'border-box',
          pointerEvents: editing ? 'auto' : 'none',
          overflow: 'hidden',
        }}
      >
        {editing && labelYText ? (
          <ShapeLabelEditor
            key={shapeId}
            ytext={labelYText}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            onEnd={next => cbRef.current.onEndEdit(next)}
          />
        ) : (
          <div
            data-testid="shape-label"
            style={{
              width: '100%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              fontSize: 16,
              lineHeight: 1.25,
              color: '#263238',
              userSelect: 'none',
            }}
          >
            {shape.label}
          </div>
        )}
      </div>

      {/* Bottom-right resize handle (Select tool only). */}
      {selected && !editing && (
        <div
          data-testid="shape-resize-handle"
          role="button"
          aria-label="Resize"
          onPointerDown={handleResizeDown}
          style={{
            position: 'absolute',
            right: -5 / props.zoom,
            bottom: -5 / props.zoom,
            width: 10 / props.zoom,
            height: 10 / props.zoom,
            background: '#4285f4',
            border: '1px solid #fff',
            borderRadius: 2,
            cursor: 'nwse-resize',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  )
}

function zoomScale(zoom: number): number {
  return Math.max(zoom, 0.0001)
}

function renderShape(shape: ShapeSnap, fill: string, stroke: string, inset: number) {
  const sw = SHAPE_STROKE_WIDTH_WORLD
  const w = Math.max(0, shape.width)
  const h = Math.max(0, shape.height)
  if (shape.kind === 'ellipse') {
    return (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - inset)}
        ry={Math.max(0, h / 2 - inset)}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    )
  }
  if (shape.kind === 'diamond') {
    const pts = `${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}`
    return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
  }
  return (
    <rect
      x={inset}
      y={inset}
      width={Math.max(0, w - sw)}
      height={Math.max(0, h - sw)}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
    />
  )
}

// ── label editor ───────────────────────────────────────────────────────────

function ShapeLabelEditor({
  ytext,
  maxChars,
  onEnd,
}: {
  ytext: Y.Text
  maxChars: number
  onEnd(next: 'selected' | 'unselected'): void
}) {
  const [value, setValue] = useState(ytext.toString().slice(0, maxChars))
  const ref = useRef<HTMLTextAreaElement>(null)
  const committedRef = useRef(false)

  useLayoutEffect(() => {
    ref.current?.focus()
    const len = value.length
    ref.current?.setSelectionRange(len, len)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function apply(next: string) {
    if (next.length > maxChars) next = next.slice(0, maxChars)
    const cur = ytext.toString()
    if (cur === next) {
      setValue(next)
      return
    }
    // One transaction replaces the whole label: a single undo step.
    const doc = ytext.doc
    const oldLen = ytext.length
    doc?.transact(() => {
      if (oldLen > 0) ytext.delete(0, oldLen)
      if (next.length > 0) ytext.insert(0, next)
    })
    setValue(next)
  }

  function commitEnd(next: 'selected' | 'unselected') {
    if (committedRef.current) return
    committedRef.current = true
    onEnd(next)
  }

  return (
    <textarea
      ref={ref}
      data-testid="shape-textarea"
      aria-label="Shape label"
      value={value}
      spellCheck={false}
      onChange={e => {
        // Guard against an in-flight remote edit that grew past the limit.
        const clamped = e.target.value.length > maxChars
          ? e.target.value.slice(0, maxChars)
          : e.target.value
        apply(clamped)
      }}
      onBlur={() => commitEnd('selected')}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          commitEnd('selected')
        }
      }}
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        textAlign: 'center',
        fontSize: 16,
        lineHeight: 1.25,
        color: '#263238',
        padding: 0,
        overflow: 'hidden',
      }}
    />
  )
}