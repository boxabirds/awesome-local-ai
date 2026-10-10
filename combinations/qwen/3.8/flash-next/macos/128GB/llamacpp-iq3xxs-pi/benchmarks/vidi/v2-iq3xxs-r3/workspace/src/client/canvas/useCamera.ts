import { useCallback, useEffect, useRef, useState } from 'react';

import { WHEEL_ZOOM_SENSITIVITY, ZOOM_MAX, ZOOM_MIN } from '../../shared/config';
import { DEFAULT_CAMERA, panBy, resetCamera, zoomAt, zoomStep } from './camera';
import type { Camera, Point, Size } from './camera';
import { installTestHooks } from './testHooks';

/** A wheel/trackpad event reduced to what the board needs. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** True when Ctrl (Windows/Linux pinch, Ctrl + wheel) or Cmd (macOS pinch) is held. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position in board-area (screen) coordinates. */
  readonly point: Point;
}

export interface CameraController {
  readonly camera: Camera;
  /** Latches to true on the first camera change caused by user input. */
  readonly hasNavigated: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Zoom by a factor around a screen point (pinch/gesture support). */
  zoomAt(point: Point, factor: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_CAMERA.zoom;
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}

/**
 * Camera state plus the input handlers that drive it.
 *
 * Camera updates are coalesced with `requestAnimationFrame` so a burst of
 * pointermove/wheel events causes at most one render per frame. Handlers have
 * stable identities (they read the viewport size and camera from refs) so the
 * input listeners are attached once.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(DEFAULT_CAMERA);
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const viewportRef = useRef<Size>(viewport);
  const panFromRef = useRef<Point | null>(null);
  /** Latch: set by the first user-driven camera change; never reset. */
  const hasNavigatedRef = useRef(false);
  /** True once the user has interacted, so the initial view is not clobbered. */
  const interactedRef = useRef(false);
  const initialViewAppliedRef = useRef(false);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const currentCamera = useCallback(
    (): Camera => pendingRef.current ?? cameraRef.current,
    [],
  );

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  /** Apply an already-computed camera, dropping any queued frame. */
  const applyNow = useCallback((next: Camera): void => {
    pendingRef.current = null;
    cancelFrame();
    cameraRef.current = next;
    setCameraState(next);
  }, [cancelFrame]);

  /** Queue a camera change; at most one render per animation frame. */
  const applyNextFrame = useCallback(
    (next: Camera, base: Camera): void => {
      if (next === base) return;
      pendingRef.current = next;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (!pending) return;
          cameraRef.current = pending;
          setCameraState(pending);
        });
      }
    },
    [],
  );

  /**
   * Run a camera.math mutation; if it produced a new camera, latch the
   * navigation hint and schedule the render. A no-op mutation (limit reached,
   * zero-length drag) changes nothing at all.
   */
  const change = useCallback(
    (mutate: (base: Camera) => Camera): void => {
      const base = currentCamera();
      const next = mutate(base);
      if (next === base) return;
      interactedRef.current = true;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      applyNextFrame(next, base);
    },
    [applyNextFrame, currentCamera],
  );

  // The first view is the standard view: 100% with the board start centred, so
  // "Reset view" is a no-op on a freshly opened board. This is not user input,
  // so it does not trip the navigation latch.
  useEffect(() => {
    if (initialViewAppliedRef.current || interactedRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    initialViewAppliedRef.current = true;
    const target = resetCamera(viewport);
    const base = currentCamera();
    if (sameCamera(base, target)) return;
    applyNow(target);
  }, [applyNow, currentCamera, viewport]);

  useEffect(() => cancelFrame, [cancelFrame]);

  const beginPan = useCallback((point: Point) => {
    panFromRef.current = point;
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const from = panFromRef.current;
      if (!from) return;
      panFromRef.current = point;
      change((base) => panBy(base, point.x - from.x, point.y - from.y));
    },
    [change],
  );

  const endPan = useCallback(() => {
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (input: WheelInput) => {
      if (input.ctrlOrMeta) {
        const factor = Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY);
        change((base) => zoomAt(base, input.point, factor));
        return;
      }
      change((base) => panBy(base, -input.deltaX, -input.deltaY));
    },
    [change],
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      change((base) => zoomAt(base, point, factor));
    },
    [change],
  );

  const stepZoom = useCallback(
    (direction: 'in' | 'out') => {
      const size = viewportRef.current;
      change((base) => zoomStep(base, size, direction));
    },
    [change],
  );

  const reset = useCallback(() => {
    const size = viewportRef.current;
    change((base) => {
      const target = resetCamera(size);
      return sameCamera(base, target) ? base : target;
    });
  }, [change]);

  // Test-only hook, present only in test builds (see testHooks.ts).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({
      setCamera: (next: Camera) => {
        applyNow({ x: next.x, y: next.y, zoom: clampZoom(next.zoom) });
      },
      getCamera: () => currentCamera(),
      reset: () => applyNow(resetCamera(viewportRef.current)),
    });
  }, [applyNow, currentCamera]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAt: zoomAtPoint,
    zoomStep: stepZoom,
    reset,
  };
}
