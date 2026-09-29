// React camera hook: camera state + input handlers (see spec: viewport.input).
//
// The camera lives only in React state and is discarded on reload (no
// persistence in story 1). Camera updates are coalesced with
// requestAnimationFrame so there is at most one render per frame; the
// authoritative value lives in a ref so fast input events (e.g. a burst of
// pointermove) never read a stale camera.

import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';

/** Normalised wheel input handed to the hook. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latched true on the first camera change; reset only by page reload. */
  readonly hasNavigated: boolean;
  /** True while a pointer drag pan is in progress. */
  readonly panning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Safari pinch: begin a gesture (resets the scale baseline). */
  gestureStart(): void;
  /** Safari pinch: zoom by the absolute scale ratio around a screen point. */
  gestureChange(scale: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test-only: jump the camera (see testHooks.ts). */
  setCamera(cam: Camera): void;
}

/** Scale value of a freshly started Safari pinch. */
const GESTURE_START_SCALE = 1;

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [panning, setPanning] = useState(false);
  const initialisedRef = useRef(viewport.width > 0 && viewport.height > 0);
  const lastPanPointRef = useRef<Point | null>(null);
  const gestureScaleRef = useRef(GESTURE_START_SCALE);
  const pendingCameraRef = useRef<Camera | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Once the viewport has a real size, centre the board's starting point.
  // Subsequent resizes intentionally leave the camera untouched.
  useEffect(() => {
    if (!initialisedRef.current && viewport.width > 0 && viewport.height > 0) {
      initialisedRef.current = true;
      const cam = resetCamera(viewport);
      cameraRef.current = cam;
      setCameraState(cam);
    }
  }, [viewport]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const applyCamera = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    pendingCameraRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingCameraRef.current !== null) {
          setCameraState(pendingCameraRef.current);
          pendingCameraRef.current = null;
        }
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPanPointRef.current = p;
    setPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPanPointRef.current;
      if (last === null) return;
      lastPanPointRef.current = p;
      applyCamera(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    lastPanPointRef.current = null;
    setPanning(false);
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        applyCamera(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera],
  );

  const gestureStart = useCallback(() => {
    gestureScaleRef.current = GESTURE_START_SCALE;
  }, []);

  const gestureChange = useCallback(
    (scale: number, point: Point) => {
      const last = gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (!Number.isFinite(scale) || scale <= 0 || last <= 0) return;
      applyCamera(zoomAt(cameraRef.current, point, scale / last));
    },
    [applyCamera],
  );

  const zoomStepIn = useCallback(
    (dir: 'in' | 'out') => {
      applyCamera(zoomStep(cameraRef.current, viewportRef.current, dir));
    },
    [applyCamera],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCamera = useCallback((cam: Camera) => applyCamera(cam), [applyCamera]);

  return {
    camera,
    hasNavigated,
    panning,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureStart,
    gestureChange,
    zoomStep: zoomStepIn,
    reset,
    setCamera,
  };
}
