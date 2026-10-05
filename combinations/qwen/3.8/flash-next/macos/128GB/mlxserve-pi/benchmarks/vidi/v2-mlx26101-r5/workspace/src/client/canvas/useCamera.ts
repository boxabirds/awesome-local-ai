import { useCallback, useEffect, useRef, useState } from 'react';

import { WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_MIN } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';

/** A wheel/trackpad event reduced to what the camera needs. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** Partial camera accepted by the test hook (`window.__vidi6.setCamera`). */
export type CameraPatch = Readonly<Partial<Camera>>;

/** Everything the viewport, zoom controls and hint need from one camera. */
export interface CameraController {
  readonly camera: Camera;
  /** True from the first camera-changing gesture until the page reloads. */
  readonly hasNavigated: boolean;
  /** True while a drag-pan is in progress (state machine `Panning`). */
  readonly isPanning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an explicit factor (Safari gesture scale ratio) around a point. */
  zoomBy(factor: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Absolute camera set; used by the e2e test hook to jump far away. */
  setCamera(patch: CameraPatch): void;
}

/**
 * Camera state plus the input handlers that drive it.
 *
 * Camera updates are coalesced with requestAnimationFrame so a burst of
 * pointermove/wheel events causes at most one render per frame. `hasNavigated`
 * is a latch that flips the first time a gesture produces a *new* camera
 * object; no-op gestures (a click without movement, zooming past a limit) do
 * not trip it, and only a page reload resets it.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const panningRef = useRef(false);
  const panFromRef = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);
  // The starting point is centred once, as soon as a real size is known, and
  // never again — later resizes must not move content relative to the top-left.
  const centredRef = useRef(viewport.width > 0 && viewport.height > 0);

  viewportRef.current = viewport;

  const flush = useCallback(() => {
    frameRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next && next !== cameraRef.current) {
      cameraRef.current = next;
      setCameraState(next);
    }
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      flush();
      return;
    }
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  /** The camera every gesture starts from (pending update included). */
  const current = useCallback((): Camera => pendingRef.current ?? cameraRef.current, []);

  /** Applies a camera returned by camera.math; ignores no-ops (same object). */
  const apply = useCallback(
    (next: Camera) => {
      if (next === current()) return;
      pendingRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      schedule();
    },
    [current, schedule],
  );

  // Centre the starting point on the first real viewport size, without
  // tripping the navigation latch.
  useEffect(() => {
    if (centredRef.current) return;
    if (!(viewport.width > 0 && viewport.height > 0)) return;
    centredRef.current = true;
    if (navigatedRef.current) return;
    const next = resetCamera(viewport);
    pendingRef.current = null;
    cameraRef.current = next;
    setCameraState(next);
  }, [viewport.width, viewport.height]);

  // Cancel any scheduled frame on unmount.
  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    if (panningRef.current) return;
    panFromRef.current = p;
    panningRef.current = true;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panningRef.current) return;
      const from = panFromRef.current ?? p;
      panFromRef.current = p;
      apply(panBy(current(), p.x - from.x, p.y - from.y));
    },
    [apply, current],
  );

  const endPan = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    panFromRef.current = null;
    setIsPanning(false);
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(zoomAt(current(), e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(current(), -e.deltaX, -e.deltaY));
      }
    },
    [apply, current],
  );

  const zoomBy = useCallback(
    (factor: number, point: Point) => {
      apply(zoomAt(current(), point, factor));
    },
    [apply, current],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      apply(zoomStepCamera(current(), viewportRef.current, dir));
    },
    [apply, current],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCamera = useCallback(
    (patch: CameraPatch) => {
      const base = current();
      const zoom = patch.zoom ?? base.zoom;
      if (!Number.isFinite(zoom) || zoom <= 0) return;
      const x = patch.x ?? base.x;
      const y = patch.y ?? base.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      apply({ x, y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) });
    },
    [apply],
  );

  return {
    camera,
    hasNavigated,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomBy,
    zoomStep,
    reset,
    setCamera,
  };
}
