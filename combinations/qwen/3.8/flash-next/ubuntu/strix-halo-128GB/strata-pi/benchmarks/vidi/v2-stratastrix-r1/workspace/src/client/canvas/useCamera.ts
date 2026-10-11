import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  INITIAL_CAMERA,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';

/** A wheel/pinch gesture in screen space, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** True for a trackpad pinch (delivered as a Ctrl+wheel) or a Cmd/Ctrl+wheel. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the top-left of the board area. */
  readonly point: Point;
}

export interface UseCamera {
  camera: Camera;
  /** Latches true on the first camera change of the visit and never resets. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
  /**
   * Replace the camera outright. Used by the test-only `window.__vidi6` hook to
   * jump to a position a user could never drag to in a test.
   */
  setCamera(next: Camera): void;
}

/**
 * Camera state plus the navigation actions that change it.
 *
 * Camera updates are produced by the pure functions in `camera.ts` and
 * coalesced with requestAnimationFrame, so a burst of pointermove or wheel
 * events causes at most one render per frame. `hasNavigated` latches only when a
 * camera maths call returns a *different* object, so a click without movement or
 * a no-op zoom at a limit leaves the navigation hint alone.
 */
export function useCamera(viewport: Size): UseCamera {
  const [camera, setCameraState] = useState<Camera>(() => INITIAL_CAMERA);
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  const centredRef = useRef(false);
  const panRef = useRef<{ last: Point } | null>(null);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  // The first measured board area centres the board's starting point in it.
  useLayoutEffect(() => {
    if (centredRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    centredRef.current = true;
    const initial = resetCamera(viewport);
    cameraRef.current = initial;
    setCameraState(initial);
  }, [viewport.width, viewport.height]);

  const applyCamera = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panRef.current = { last: p };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const pan = panRef.current;
      if (!pan) return;
      const next = panBy(cameraRef.current, p.x - pan.last.x, p.y - pan.last.y);
      pan.last = p;
      applyCamera(next);
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Trackpad pinch and Ctrl/Cmd+wheel zoom around the pointer.
        applyCamera(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
        return;
      }
      // A plain scroll moves the board with the scroll.
      applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (direction: ZoomDirection) => {
      applyCamera(zoomStepCamera(cameraRef.current, viewportRef.current, direction));
    },
    [applyCamera],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCamera = useCallback(
    (next: Camera) => {
      applyCamera(next);
    },
    [applyCamera],
  );

  return useMemo(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomStep,
      reset,
      setCamera,
    }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera],
  );
}
