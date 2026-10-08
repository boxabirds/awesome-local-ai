import React, { useEffect, useRef } from 'react'
import { type Camera, type Point } from './camera'
import { GRID_SPACING_WORLD } from '../../shared/config'
import type { WheelData } from './useCamera'

export interface BoardViewportProps {
  camera: Camera
  onBeginPan: (p: Point) => void
  onPanMove: (p: Point) => void
  onEndPan: () => void
  onWheel: (data: WheelData) => void
  onGesture: (scale: number, point: Point) => void
  children?: React.ReactNode
}

export function BoardViewport({
  camera,
  onBeginPan,
  onPanMove,
  onEndPan,
  onWheel,
  onGesture,
  children,
}: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  // Keep latest callbacks in a ref so the effect closure uses the latest ones
  const cbRef = useRef({ onBeginPan, onPanMove, onEndPan, onWheel, onGesture })
  cbRef.current = { onBeginPan, onPanMove, onEndPan, onWheel, onGesture }

  // We keep the panning flag on a ref + update the DOM attribute directly so
  // the test assertions see the correct state without waiting for React to re-render.
  const draggingRef = useRef(false)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    let pointerId: number | null = null

    function localToViewport(clientX: number, clientY: number): Point {
      const rect = el!.getBoundingClientRect()
      return { x: clientX - rect.left, y: clientY - rect.top }
    }

    function setPanning(val: boolean) {
      draggingRef.current = val
      el!.dataset.state = val ? 'panning' : 'idle'
      el!.style.cursor = val ? 'grabbing' : 'default'
    }

    function onPointerDown(e: globalThis.PointerEvent) {
      // Only start drag on the viewport element itself (not children)
      if (e.target !== el) return
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      pointerId = e.pointerId
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      setPanning(true)
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onBeginPan(p)
    }

    function onPointerMove(e: globalThis.PointerEvent) {
      if (!draggingRef.current) return
      const p = localToViewport(e.clientX, e.clientY)
      cbRef.current.onPanMove(p)
    }

    function onPointerEnd(_e: globalThis.PointerEvent) {
      if (!draggingRef.current) return
      setPanning(false)
      pointerId = null
      cbRef.current.onEndPan()
    }

    // Wheel: always preventDefault and either pan or zoom
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

    // Safari gesturestart/gesturechange
    function onGestureStart(e: Event) {
      e.preventDefault()
    }

    function onGestureChange(e: Event) {
      e.preventDefault()
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number }
      if (typeof ge.scale !== 'number' || !Number.isFinite(ge.scale) || ge.scale <= 0) return
      const p = localToViewport(ge.clientX ?? 0, ge.clientY ?? 0)
      cbRef.current.onGesture(ge.scale, p)
    }

    // Keyboard shortcuts on window
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        cbRef.current.onWheel // placeholder – not used here; see App.tsx
      }
    }

    // Pointer events
    el.addEventListener('pointerdown', onPointerDown as EventListener)
    el.addEventListener('pointermove', onPointerMove as EventListener)
    el.addEventListener('pointerup', onPointerEnd as EventListener)
    el.addEventListener('pointercancel', onPointerEnd as EventListener)
    el.addEventListener('lostpointercapture', onPointerEnd as EventListener)
    // Wheel (non-passive)
    el.addEventListener('wheel', onWheelNative, { passive: false })
    // Safari gesture events
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    // Suppress ctrl+click context menu that can interfere
    void onKeyDown

    return () => {
      el.removeEventListener('pointerdown', onPointerDown as EventListener)
      el.removeEventListener('pointermove', onPointerMove as EventListener)
      el.removeEventListener('pointerup', onPointerEnd as EventListener)
      el.removeEventListener('pointercancel', onPointerEnd as EventListener)
      el.removeEventListener('lostpointercapture', onPointerEnd as EventListener)
      el.removeEventListener('wheel', onWheelNative)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {/* World layer – renders children in board coordinate space */}
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