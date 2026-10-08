import React, { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { Camera } from '../canvas/camera'
import { screenToWorld } from '../canvas/camera'
import type { ShapeKind } from '../../shared/config'
import { createShape } from '../../shared/objects/shape'

export interface ShapeToolProps {
  camera: Camera
  doc: Y.Doc
  kind: ShapeKind
  identityId?: string
  /** Called with the new shape id; App selects it and returns to Select. */
  onCreated(id: string): void
}

interface DragState {
  startX: number
  startY: number
  curX: number
  curY: number
  shift: boolean
  started: boolean
}

/**
 * Shape creation. A full-screen transparent overlay owns the pointer gesture so
 * drags that start over existing objects never move them (they never reach the
 * object). One press→release creates exactly one shape, then the tool hands
 * control back to Select via `onCreated`. Escape and pointercancel create
 * nothing.
 */
export function ShapeTool({ camera, doc, kind, identityId = 'local', onCreated }: ShapeToolProps) {
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const kindRef = useRef(kind)
  kindRef.current = kind
  const onCreatedRef = useRef(onCreated)
  onCreatedRef.current = onCreated

  const [preview, setPreview] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const createdRef = useRef(false)

  function computeRect(d: DragState) {
    const cam = cameraRef.current
    const a = screenToWorld(cam, { x: d.startX, y: d.startY })
    const b = screenToWorld(cam, { x: d.curX, y: d.curY })
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    }
    return { rect, at: b }
  }

  function finish(d: DragState) {
    if (createdRef.current) return
    createdRef.current = true
    const { rect, at } = computeRect(d)
    const tiny = rect.width < 20 || rect.height < 20
    const id = createShape(
      doc,
      { kind: kindRef.current, rect: tiny ? null : rect, at, square: d.shift },
      identityId,
    )
    if (id) onCreatedRef.current(id)
  }

  // Window-level move/up listeners read the shared drag ref, so a pointer that
  // started on the overlay (or anywhere) resolves to one shape on release.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      d.curX = e.clientX
      d.curY = e.clientY
      d.shift = e.shiftKey
      setPreview({ ...d })
    }
    function onUp(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      d.curX = e.clientX
      d.curY = e.clientY
      d.shift = e.shiftKey
      dragRef.current = null
      setPreview(null)
      finish(d)
    }
    function onCancel() {
      dragRef.current = null
      setPreview(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.stopPropagation()
    createdRef.current = false
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      shift: e.shiftKey,
      started: true,
    }
    setPreview({ ...dragRef.current })
  }

  const p = preview
  let previewStyle: React.CSSProperties | null = null
  if (p) {
    previewStyle = {
      position: 'absolute',
      left: Math.min(p.startX, p.curX),
      top: Math.min(p.startY, p.curY),
      width: Math.abs(p.curX - p.startX),
      height: Math.abs(p.curY - p.startY),
      border: '1.5px dashed rgba(38,50,56,0.9)',
      background: 'rgba(38,50,56,0.08)',
      pointerEvents: 'none',
      boxSizing: 'border-box',
    }
  }

  return (
    <div
      data-testid="shape-tool-overlay"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: 'crosshair', zIndex: 5 }}
    >
      {previewStyle && <div data-testid="shape-preview" style={previewStyle} />}
    </div>
  )
}