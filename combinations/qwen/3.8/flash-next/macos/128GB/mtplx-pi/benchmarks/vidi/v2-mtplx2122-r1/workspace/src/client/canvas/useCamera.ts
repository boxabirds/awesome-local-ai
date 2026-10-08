import { useCallback, useRef, useState } from 'react'
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
} from './camera'
import { WHEEL_ZOOM_SENSITIVITY, WHEEL_LINE_TO_PX, WHEEL_PAGE_TO_PX } from '../../shared/config'

export interface WheelData {
  deltaX: number
  deltaY: number
  deltaMode: number // 0=PIXEL, 1=LINE, 2=PAGE
  ctrlOrMeta: boolean
  point: Point
}

export interface UseCameraResult {
  camera: Camera
  hasNavigated: boolean
  beginPan(p: Point): void
  panMove(p: Point): void
  endPan(): void
  wheel(e: WheelData): void
  /** Zoom at a specific screen point by a raw factor (used by gesture events). */
  zoomAtPoint(point: Point, factor: number): void
  zoomStep(dir: 'in' | 'out'): void
  reset(): void
  setCamera(cam: Camera): void
}

export function useCamera(viewport: Size): UseCameraResult {
  const [state, setState] = useState<{ camera: Camera; hasNavigated: boolean }>(() => ({
    camera: resetCamera(viewport),
    hasNavigated: false,
  }))

  const dragOrigin = useRef<Point | null>(null)
  const viewportRef = useRef<Size>(viewport)
  viewportRef.current = viewport

  // ── pan drag ───────────────────────────────────────────────────────────────

  const beginPan = useCallback((p: Point) => {
    dragOrigin.current = p
  }, [])

  const panMove = useCallback((p: Point) => {
    const origin = dragOrigin.current
    if (origin === null) return
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    if (dx === 0 && dy === 0) return
    dragOrigin.current = p
    setState(prev => {
      const next = panBy(prev.camera, dx, dy)
      if (next === prev.camera) return prev
      return { camera: next, hasNavigated: true }
    })
  }, [])

  const endPan = useCallback(() => {
    dragOrigin.current = null
  }, [])

  // ── wheel ──────────────────────────────────────────────────────────────────

  const wheel = useCallback((e: WheelData) => {
    let { deltaX, deltaY } = e
    if (e.deltaMode === 1) {
      deltaX *= WHEEL_LINE_TO_PX
      deltaY *= WHEEL_LINE_TO_PX
    } else if (e.deltaMode === 2) {
      deltaX *= WHEEL_PAGE_TO_PX
      deltaY *= WHEEL_PAGE_TO_PX
    }
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
      setState(prev => {
        const next = zoomAt(prev.camera, e.point, factor)
        if (next === prev.camera) return prev
        return { camera: next, hasNavigated: true }
      })
    } else {
      setState(prev => {
        const next = panBy(prev.camera, -deltaX, -deltaY)
        if (next === prev.camera) return prev
        return { camera: next, hasNavigated: true }
      })
    }
  }, [])

  // ── zoomAtPoint (gesture) ──────────────────────────────────────────────────

  const zoomAtPoint = useCallback((point: Point, factor: number) => {
    setState(prev => {
      const next = zoomAt(prev.camera, point, factor)
      if (next === prev.camera) return prev
      return { camera: next, hasNavigated: true }
    })
  }, [])

  // ── button / key zoom ──────────────────────────────────────────────────────

  const doZoomStep = useCallback((dir: 'in' | 'out') => {
    setState(prev => {
      const next = zoomStep(prev.camera, viewportRef.current, dir)
      if (next === prev.camera) return prev
      return { camera: next, hasNavigated: true }
    })
  }, [])

  // ── reset ──────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    const cam = resetCamera(viewportRef.current)
    setState(prev => {
      if (cam === prev.camera) return prev
      return { camera: cam, hasNavigated: true }
    })
  }, [])

  const setCamera = useCallback((cam: Camera) => {
    setState(prev => {
      if (cam === prev.camera) return prev
      return { camera: cam, hasNavigated: true }
    })
  }, [])

  return {
    camera: state.camera,
    hasNavigated: state.hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep: doZoomStep,
    reset,
    setCamera,
  }
}