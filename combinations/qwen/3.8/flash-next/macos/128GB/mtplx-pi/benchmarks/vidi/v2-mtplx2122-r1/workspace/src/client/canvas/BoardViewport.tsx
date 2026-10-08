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
   *  significant drag.  Used to clear selection / end editing. */
  onEmptyClick?: (p: Point) => void
  /** Fired on a double-click on empty viewport space. */
  onDoubleClick?: (p: Point) => void
  onWheel: (data: WheelData) => void
  onGesture: (scale: number, point: Point) => void
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
  children,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)

  // Keep latest callbacks in a ref so the effect closure always uses the
  // latest versions without re-registering DOM listeners.
  const cbRef = useRef({
    onBeginPan, onPanMove, onEndPan, onEmptyClick, onDoubleClick, onWheel, onGesture,
  })
  cbRef.current = {
    onBeginPan, onPanMove, onEndPan, onEmptyClick, onDoubleClick, onWheel, onGesture,
  }

  // ── DOM event listeners (set up once) ─────────────────────────────────────

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    let panning = false
    let panMoved = false       // true once the pointer has moved far enough to count as a drag
    let downClientX = 0
    let downClientY = 0

    const DRAG_PX = 3 // viewport-level "this is a drag, not a click" threshold

    function localToViewport(clientX: number, clientY: number): Point {
      const rect = el!.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    function setPanning(val: boolean) {
      panning = val
      el!.dataset.state = val ? 'panning' : 'idle'
      el!.style.cursor = val ? 'grabbing' : 'default'
    }

    // ── pointerdown ──────────────────────────────────────────────────────────
    function onPointerDown(e: globalThis.PointerEvent) {
      // Only interact with the viewport itself – children (notes, toolbars)
      // handle their own pointer events and call stopPropagation.
      if (e.target !== el) return
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return

      // Record the starting position for click-vs-drag detection.
      downClientX = e.clientX
      downClientY = e.clientY
      panMoved = false

      setPanning(true)
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onBeginPan(p)
    }

    // ── pointermove ──────────────────────────────────────────────────────────
    function onPointerMove(e: globalThis.PointerEvent) {
      if (!panning) return
      const dx = Math.abs(e.clientX - downClientX)
      const dy = Math.abs(e.clientY - downClientY)
      if (dx > DRAG_PX || dy > DRAG_PX) panMoved = true
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onPanMove(p)
    }

    // ── pointerup / pointercancel / lostpointercapture ───────────────────────
    function onPointerEnd(e: globalThis.PointerEvent) {
      if (!panning) return
      setPanning(false)
      // If the pointer never moved beyond DRAG_PX the user just clicked on
      // the empty background – fire onEmptyClick so the app can deselect.
      if (!panMoved) {
        const p = localToViewport(e.clientX, e.clientY)
        cbRef.current.onEmptyClick?.(p)
      }
    }

    // ── dblclick ─────────────────────────────────────────────────────────────
    function onDblClick(e: MouseEvent) {
      // Only on the viewport itself; double-clicks on notes or toolbars are
      // handled by those components (they stopPropagation on the underlying
      // pointer events but not on dblclick, so we also guard by target here).
      if (e.target !== el) return
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onDoubleClick?.(p)
    }

    // ── wheel ────────────────────────────────────────────────────────────────
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

    // ── Safari gesture ───────────────────────────────────────────────────────
    function onGestureStart(e: Event) { e.preventDefault() }

    function onGestureChange(e: Event) {
      e.preventDefault()
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number }
      if (typeof ge.scale !== 'number' || !Number.isFinite(ge.scale) || ge.scale <= 0) return
      const p = localToViewport(ge.clientX ?? 0, ge.clientY ?? 0)
      cbRef.current.onGesture(ge.scale, p)
    }

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

  // ── render ─────────────────────────────────────────────────────────────────

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
        backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.35) 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        touchAction: 'none',
      }}
    >
      {/*
        World layer: renders children in board coordinate space.
        pointerEvents: 'none' so clicks on the empty layer fall through to
        the viewport; individual children opt-in with pointerEvents: 'auto'.
      */}
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
