import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canZoomIn as cameraCanZoomIn,
  canZoomOut as cameraCanZoomOut,
  panBy,
  resetCamera,
  zoomAt,
  zoomPercent,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

/**
 * Camera state + navigation handlers for the board.
 *
 * The camera is the single source of truth for the viewport. Handlers return
 * updated cameras via the pure `camera` module and only trip the `hasNavigated`
 * latch when the camera object actually changes (a no-op pan or a zoom at a
 * limit leaves both the camera and the latch untouched — see TC-29).
 *
 * Updates are applied synchronously to an internal ref so that rapid successive
 * gestures compose correctly, and React state is updated once per call. React's
 * automatic batching keeps this to at most one render per event/frame; a manual
 * rAF queue was omitted to keep component tests deterministic (see NOTES.md).
 */
export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  panning: boolean;
  zoomPercent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(next: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const initializedRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const lastPanPointRef = useRef<Point | null>(null);

  const commit = useCallback((next: Camera, navigated = true) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    setCameraState(next);
    if (navigated && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  // Centre the board's starting point once a real viewport size is measured.
  // This is NOT a user navigation, so it must not trip the hint latch.
  useEffect(() => {
    if (initializedRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    initializedRef.current = true;
    commit(resetCamera(viewport), false);
  }, [viewport, commit]);

  const beginPan = useCallback((p: Point) => {
    lastPanPointRef.current = p;
    panningRef.current = true;
    setPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panningRef.current || !lastPanPointRef.current) return;
      const last = lastPanPointRef.current;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      lastPanPointRef.current = p;
      commit(panBy(cameraRef.current, dx, dy));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    lastPanPointRef.current = null;
    setPanning(false);
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (e.ctrlOrMeta) {
        // Pinch / Ctrl(+Cmd)-wheel: zoom around the pointer.
        // deltaY is in pixels (deltaMode already converted by the caller).
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, factor));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(cameraZoomStep(cameraRef.current, viewport, dir));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, viewport.width, viewport.height],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewport));
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, viewport.width, viewport.height],
  );

  const setCamera = useCallback(
    (next: Camera) => {
      commit(next);
    },
    [commit],
  );

  return {
    camera,
    hasNavigated,
    panning,
    zoomPercent: zoomPercent(camera),
    canZoomIn: cameraCanZoomIn(camera),
    canZoomOut: cameraCanZoomOut(camera),
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
    setCamera,
  };
}
