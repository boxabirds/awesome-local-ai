import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canZoomIn as mathCanZoomIn,
  canZoomOut as mathCanZoomOut,
  panBy,
  resetCamera,
  zoomAt,
  zoomPercent,
  zoomStep as mathZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import {
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_PAGE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import { installTestHooks, isTestMode, type TestCamera } from '../testHooks';

/** A wheel / trackpad scroll, already normalised to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** True when Ctrl (pinch on Windows/Linux trackpads) or Cmd is held. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the board area, in screen pixels. */
  readonly point: Point;
}

/** Camera state plus every navigation action the board supports. */
export interface CameraController {
  readonly camera: Camera;
  /** Latches true on the first camera change of the visit; drives the hint. */
  readonly hasNavigated: boolean;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly zoomPercent: number;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by a pinch `scaleRatio` (Safari `gesturechange`) around a point. */
  pinchAt(point: Point, scaleRatio: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

/** Convert a wheel delta in LINE or PAGE units to CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === WHEEL_DELTA_MODE_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === WHEEL_DELTA_MODE_PAGE) return delta * WHEEL_PAGE_HEIGHT_PX;
  return delta;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/**
 * Holds the board camera and turns navigation input into camera updates.
 *
 * Camera updates are coalesced to at most one React render per animation
 * frame: the authoritative camera lives in a ref so a burst of `pointermove`
 * or `wheel` events composes against the latest value while a single render is
 * scheduled.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panFromRef = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      setCameraState(cameraRef.current);
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCameraState(cameraRef.current);
    });
  }, []);

  /** Apply a camera returned by camera.math; a no-op update is ignored. */
  const commit = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current || sameCamera(next, cameraRef.current)) return;
      cameraRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      scheduleRender();
    },
    [scheduleRender],
  );

  // Centre the board's starting point as soon as the board area is measured.
  // This is the initial view, not user navigation, so it does not trip the
  // `hasNavigated` latch. Later resizes leave the camera alone: content stays
  // put relative to the top-left of the board area.
  const initialisedRef = useRef(false);
  useEffect(() => {
    if (initialisedRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    initialisedRef.current = true;
    const initial = resetCamera(viewport);
    if (sameCamera(cameraRef.current, initial)) return;
    cameraRef.current = initial;
    setCameraState(initial);
  }, [viewport.width, viewport.height]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const from = panFromRef.current;
      if (from === null) return;
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      if (dx === 0 && dy === 0) return;
      panFromRef.current = p;
      commit(panBy(cameraRef.current, dx, dy));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Pinch (Chromium/Firefox deliver trackpad pinch as a Ctrl-wheel).
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, factor));
      } else {
        // Plain scroll: the board moves in the scroll direction.
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const pinchAt = useCallback(
    (point: Point, scaleRatio: number) => {
      commit(zoomAt(cameraRef.current, point, scaleRatio));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      commit(mathZoomStep(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    const next = resetCamera(viewportRef.current);
    if (sameCamera(cameraRef.current, next)) return;
    commit(next);
  }, [commit]);

  const controllerRef = useRef<CameraController | null>(null);
  const controller: CameraController = {
    camera,
    hasNavigated,
    canZoomIn: mathCanZoomIn(camera),
    canZoomOut: mathCanZoomOut(camera),
    zoomPercent: zoomPercent(camera),
    beginPan,
    panMove,
    endPan,
    wheel,
    pinchAt,
    zoomStep,
    reset,
  };
  controllerRef.current = controller;

  // Test-only escape hatch (dropped from production builds) so e2e can travel
  // a million pixels without dragging them.
  useEffect(() => {
    if (!isTestMode()) return;
    installTestHooks({
      getCamera: () => cameraRef.current,
      setCamera: (next: TestCamera) => {
        const current = cameraRef.current;
        const pick = (value: number | undefined, fallback: number): number =>
          typeof value === 'number' && Number.isFinite(value) ? value : fallback;
        const merged: Camera = {
          x: pick(next.x, current.x),
          y: pick(next.y, current.y),
          zoom: pick(next.zoom, current.zoom),
        };
        if (sameCamera(current, merged)) return;
        cameraRef.current = merged;
        scheduleRender();
      },
    });
    return () => installTestHooks(null);
  }, [scheduleRender]);

  return controller;
}
