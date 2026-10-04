import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep as stepCamera,
  resetCamera,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

/**
 * API returned by {@link useCamera}: the current camera plus the input
 * handlers that mutate it. Camera updates that come from high-frequency input
 * (drag) are coalesced to at most one render per animation frame.
 */
export interface CameraApi {
  camera: Camera;
  /** Latches true on the first camera change that produces a new object. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  /** Zoom by an arbitrary positive factor around a screen point. */
  zoomAtFactor(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test hook: jump to an arbitrary camera (does not count as navigation). */
  setCamera(cam: Camera): void;
}

/**
 * Owns the board camera. `viewport` is the board area size in CSS pixels; a
 * change to it never moves the camera (content stays fixed to the top-left
 * corner of the board area), except to centre the board the first time a real
 * size is known.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  // Centre the board once a real viewport size is first available. This is not
  // user navigation, so it must not latch `hasNavigated`.
  const centeredRef = useRef(viewport.width > 0 && viewport.height > 0);
  useEffect(() => {
    if (!centeredRef.current && viewport.width > 0 && viewport.height > 0) {
      centeredRef.current = true;
      const c = resetCamera(viewport);
      cameraRef.current = c;
      setCameraState(c);
    }
  }, [viewport]);

  /** Commit a new camera, latching `hasNavigated` only when it actually changed. */
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return; // no-op: same object, keep the hint
    cameraRef.current = next;
    setCameraState(next);
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  // ---- Drag panning, coalesced with requestAnimationFrame ----
  const workingRef = useRef<Camera>(camera);
  const panLastRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    commit(workingRef.current);
  }, [commit]);

  const beginPan = useCallback((p: Point) => {
    workingRef.current = cameraRef.current;
    panLastRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panLastRef.current;
      if (!last) return;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      panLastRef.current = p;
      if (dx === 0 && dy === 0) return;
      workingRef.current = panBy(workingRef.current, dx, dy);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          commit(workingRef.current);
        });
      }
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
    flush();
  }, [flush]);

  // ---- Wheel, step and reset (applied immediately) ----
  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cameraRef.current, e.point, factor));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const zoomAtFactor = useCallback(
    (point: Point, factor: number) => {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(stepCamera(cameraRef.current, viewport, dir));
    },
    [commit, viewport],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewport));
  }, [commit, viewport]);

  const setCamera = useCallback((c: Camera) => {
    cameraRef.current = c;
    setCameraState(c);
  }, []);

  // Cancel any pending frame if the component unmounts mid-drag.
  useEffect(() => () => flush(), [flush]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtFactor,
    zoomStep,
    reset,
    setCamera,
  };
}
