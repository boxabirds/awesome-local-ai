import React, { useEffect, useRef } from 'react'
import { type Camera, type Point } from './camera'
import { GRID_SPACING_WORLD } from '../../shared/config'
import type { WheelData } from './useCamera'

export interface BoardViewportProps {
  camera: Camera
  onBeginPan: (p: Point) => void
  onPanMove: (p: Point) => void
  onEndPan: () => void
  /** Fired when a pointerup occurs on empty viewport space with no
   *  significant drag.  Used to clear selection / end editing / place text. */
  onEmptyClick?: (p: Point) => void
  /** Fired on a double-click on empty viewport space. */
  onDoubleClick?: (p: Point) => void
  onWheel: (data: WheelData) => void
  onGesture: (scale: number, point: Point) => void
  /** Custom cursor style for the viewport (e.g. 'text' when Text tool active). */
  cursor?: string
  /** When true the viewport is in a non-panning tool mode (e.g. Text). */
  toolMode?: boolean
  children?: React.ReactNode
}

export function BoardViewport({
  camera,
  onBeginPan,
  onPanMove,
  onEndPan,
  onEmptyClick,
  onDoubleClick,
  onWheel,
  onGesture,
  cursor,
  toolMode,
  children,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)

  const cbRef = useRef({
    onBeginPan, onPanMove, onEndPan, onEmptyClick, onDoubleClick, onWheel, onGesture, toolMode,
  })
  cbRef.current = {
    onBeginPan, onPanMove, onEndPan, onEmptyClick, onDoubleClick, onWheel, onGesture, toolMode,
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    let panning = false
    let panMoved = false
    let downClientX = 0
    let downClientY = 0

    const DRAG_PX = 3

    function localToViewport(clientX: number, clientY: number): Point {
      const rect = el!.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    function setPanning(val: boolean) {
      panning = val
      el!.dataset.state = val ? 'panning' : 'idle'
      el!.style.cursor = val ? 'grabbing' : (cursor ?? 'default')
    }

    function onPointerDown(e: globalThis.PointerEvent) {
      if (e.target !== el) return
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return

      downClientX = e.clientX
      downClientY = e.clientY
      panMoved = false

      // In tool mode (e.g. Text tool) don't start panning.
      if (cbRef.current.toolMode) {
        // Still capture pointer so pointerup can be detected for tool-action
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        // Do NOT set panning – tool mode doesn't pan
        return
      }

      setPanning(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onBeginPan(p)
    }

    function onPointerMove(e: globalThis.PointerEvent) {
      if (!panning && !cbRef.current.toolMode) return
      const dx = Math.abs(e.clientX - downClientX)
      const dy = Math.abs(e.clientY - downClientY)
      if (dx > DRAG_PX || dy > DRAG_PX) panMoved = true
      if (panning) {
        const p = localToViewport(e.clientX, e.clientY)
        cbRef.current.onPanMove(p)
      }
    }

    function onPointerEnd(e: globalThis.PointerEvent) {
      if (!panning && !cbRef.current.toolMode) return

      if (panning) setPanning(false)
      else el!.style.cursor = cursor ?? 'default'

      if (!panMoved) {
        const p = localToViewport(e.clientX, e.clientY)
        cbRef.current.onEmptyClick?.(p)
      }
    }

    function onDblClick(e: MouseEvent) {
      if (e.target !== el) return
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onDoubleClick?.(p)
    }

    function onWheelNative(e: WheelEvent) {
      e.preventDefault()
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onWheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: p,
      })
    }

    function onGestureStart(e: Event) { e.preventDefault() }

    function onGestureChange(e: Event) {
      e.preventDefault()
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number }
      if (typeof ge.scale !== 'number' || !Number.isFinite(ge.scale) || ge.scale <= 0) return
      const p = localToViewport(ge.clientX ?? 0, ge.clientY ?? 0)
      cbRef.current.onGesture(ge.scale, p)
    }

    // Set initial cursor
    el.style.cursor = cursor ?? 'default'

    el.addEventListener('pointerdown', onPointerDown as EventListener)
    el.addEventListener('pointermove', onPointerMove as EventListener)
    el.addEventListener('pointerup', onPointerEnd as EventListener)
    el.addEventListener('pointercancel', onPointerEnd as EventListener)
    el.addEventListener('lostpointercapture', onPointerEnd as EventListener)
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('wheel', onWheelNative, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown as EventListener)
      el.removeEventListener('pointermove', onPointerMove as EventListener)
      el.removeEventListener('pointerup', onPointerEnd as EventListener)
      el.removeEventListener('pointercancel', onPointerEnd as EventListener)
      el.removeEventListener('lostpointercapture', onPointerEnd as EventListener)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('wheel', onWheelNative)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update cursor when tool changes.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.style.cursor = cursor ?? 'default'
  }, [cursor])

  const spacing = GRID_SPACING_WORLD * camera.zoom
  const bgX = -camera.x * camera.zoom
  const bgY = -camera.y * camera.zoom

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      data-state="idle"
      role="application"
      aria-label="Board"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: cursor ?? 'default',
        backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.35) 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        touchAction: 'none',
      }}
    >
      <div
        data-testid="world-layer"
        data-camera={`${camera.x},${camera.y},${camera.zoom}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    </div>
  )
}