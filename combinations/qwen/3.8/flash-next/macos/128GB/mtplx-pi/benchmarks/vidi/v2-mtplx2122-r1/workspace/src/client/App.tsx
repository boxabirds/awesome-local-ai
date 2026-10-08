import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BoardViewport } from './canvas/BoardViewport'
import { ZoomControls } from './canvas/ZoomControls'
import { NavigationHint } from './canvas/NavigationHint'
import { useCamera, type WheelData } from './canvas/useCamera'
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera'
import { GRID_SPACING_WORLD } from '../shared/config'
import type { Point } from './canvas/camera'

const INITIAL_VIEWPORT = { width: 1280, height: 800 }

declare global {
  // eslint-disable-next-line no-var
  var __vidi6:
    | {
        setCamera(cam: { x: number; y: number; zoom: number }): void
      }
    | undefined
}

export function App() {
  const [viewportSize, setViewportSize] = useState(INITIAL_VIEWPORT)
  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewportSize)

  // ── Keyboard shortcuts on window ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomStep('in')
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomStep('out')
      } else if (e.key === '0') {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomStep, reset])

  // ── Test hook (DEV / test builds only) ─────────────────────────────────────
  const setCameraRef = useRef(setCamera)
  setCameraRef.current = setCamera

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__vidi6 = {
      setCamera(cam: { x: number; y: number; zoom: number }) {
        setCameraRef.current(cam)
      },
    }
    return () => {
      delete window.__vidi6
    }
  }, [])

  // ── Viewport size via ResizeObserver ───────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setViewportSize(s =>
          s.width === width && s.height === height ? s : { width, height },
        )
      }
    }
    update()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update)
      ro.observe(el)
      return () => ro.disconnect()
    }
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleBeginPan = useCallback((p: Point) => beginPan(p), [beginPan])
  const handlePanMove = useCallback((p: Point) => panMove(p), [panMove])
  const handleEndPan = useCallback(() => endPan(), [endPan])
  const handleWheel = useCallback((d: WheelData) => wheel(d), [wheel])
  const handleGesture = useCallback(
    (scale: number, point: Point) => {
      zoomAtPoint(point, scale)
    },
    [zoomAtPoint],
  )

  return (
    <div
      ref={rootRef}
      data-testid="app-root"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <BoardViewport
        camera={camera}
        onBeginPan={handleBeginPan}
        onPanMove={handlePanMove}
        onEndPan={handleEndPan}
        onWheel={handleWheel}
        onGesture={handleGesture}
      >
        {/* Origin crosshair at world (0,0) */}
        <div
          data-testid="origin-marker"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -6,
            top: -6,
            width: 12,
            height: 12,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 5,
              width: 12,
              height: 2,
              background: 'rgba(255,0,0,0.7)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 5,
              top: 0,
              width: 2,
              height: 12,
              background: 'rgba(255,0,0,0.7)',
            }}
          />
        </div>
        {/* Grid dot landmarks at k*GRID_SPACING_WORLD for e2e tests */}
        {Array.from({ length: 5 }, (_, k) => (
          <div
            key={k}
            data-testid={`grid-dot-${k}`}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: (k + 1) * GRID_SPACING_WORLD - 3,
              top: -3,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'rgba(0,0,255,0.5)',
              pointerEvents: 'none',
            }}
          />
        ))}
      </BoardViewport>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  )
}

export default App