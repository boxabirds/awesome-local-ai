// React hook owning the board camera: camera state plus the input handlers the
// viewport calls. Camera maths lives in camera.ts; this hook only decides when
// to call it and batches updates to at most one render per animation frame.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';
import { registerCameraSetter } from './testHooks';

/** A wheel/trackpad scroll, already converted to pixels and screen coordinates. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl or Cmd held (browser reports trackpad pinch as a Ctrl wheel). */
  readonly ctrlOrMeta: boolean;
  /** Pointer position in board-area screen coordinates. */
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latches true on the first camera change of the visit; never resets. */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Trackpad pinch / Safari gesture: zoom by `factor` around `point`. */
  pinchAt(point: Point, factor: number): void;
  zoomStep(dir: ZoomDirection): void;
  reset(): void;
  /** Move the camera to an exact value (used by the test hooks). */
  setCamera(camera: Camera): void;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** Board area size before the first ResizeObserver measurement. */
export function initialViewport(): Size {
  if (typeof window === 'undefined') return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  /** Latest camera including updates not yet flushed to React state. */
  const pendingRef = useRef<Camera>(camera);
  const renderedRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  const panFromRef = useRef<Point | null>(null);

  // A window resize must not move content relative to the top-left corner of
  // the board area, so the resize only updates the size used to find the
  // centre; the camera itself is untouched.
  viewportRef.current = viewport;

  /**
   * Apply a camera change. camera.math returns the *same object* for no-ops
   * (limit reached, zero delta), so only real changes count as navigation and
   * dismiss the first-use hint. Updates are coalesced into one render per frame.
   */
  const commit = useCallback((next: Camera) => {
    const pending = pendingRef.current;
    if (next === pending || sameCamera(next, pending)) return;
    pendingRef.current = next;
    navigatedRef.current = true;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const flushed = pendingRef.current;
      if (flushed !== renderedRef.current) {
        renderedRef.current = flushed;
        setCameraState(flushed);
      }
      if (navigatedRef.current) setHasNavigated(true);
    });
  }, []);

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const from = panFromRef.current;
      if (from === null) return;
      panFromRef.current = p;
      // Pan from the pending (not yet rendered) camera so a fast drag whose
      // moves arrive between frames still follows the pointer exactly.
      commit(panBy(pendingRef.current, p.x - from.x, p.y - from.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    // The board simply stays where it was at the moment the drag ended, whether
    // that was pointerup, pointercancel or a lost pointer capture.
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(zoomAt(pendingRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        commit(panBy(pendingRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [commit],
  );

  const pinchAt = useCallback(
    (point: Point, factor: number) => {
      commit(zoomAt(pendingRef.current, point, factor));
    },
    [commit],
  );

  const stepZoom = useCallback(
    (dir: ZoomDirection) => {
      commit(zoomStep(pendingRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (next: Camera) => {
      commit(next);
    },
    [commit],
  );

  // Test hook (test builds only): jump the camera anywhere on the board.
  useEffect(() => {
    registerCameraSetter(setCamera);
    return () => registerCameraSetter(null);
  }, [setCamera]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return useMemo<CameraApi>(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      pinchAt,
      zoomStep: stepZoom,
      reset,
      setCamera,
    }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, pinchAt, stepZoom, reset, setCamera],
  );
}
