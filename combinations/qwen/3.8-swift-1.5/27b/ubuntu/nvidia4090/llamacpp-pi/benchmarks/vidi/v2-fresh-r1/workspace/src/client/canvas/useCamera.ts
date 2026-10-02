// React hook holding the board camera state plus input handlers.
//
// Camera updates are coalesced with requestAnimationFrame (at most one
// render per frame). The `hasNavigated` latch flips the first time a
// camera operation returns a *new* camera object; no-op updates (same
// object) do not trip it, so a click without movement keeps the hint.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

/** Normalised wheel input handed to the camera. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  isPanning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an explicit factor (Safari gesture scale ratio). */
  zoomByFactor(factor: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test-only: jump the camera (window.__vidi6 hook, test mode only). */
  setCamera(cam: Camera): void;
}

/**
 * Track an element's content size with a ResizeObserver. Camera x,y
 * (top-left) are unchanged by resize, so this only feeds the viewport
 * size used for centring (reset, step zoom).
 *
 * The first measurement happens synchronously in a layout effect (before
 * paint) so the very first painted frame already knows the viewport size
 * and the origin is centred — no flash of the top-left, and no late reset
 * that could clobber early user input.
 */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const setSizeFrom = (width: number, height: number) => {
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    setSizeFrom(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSizeFrom(width, height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, commitCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const cameraRef = useRef(camera);
  const pendingCameraRef = useRef(camera);
  const frameRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);

  const isPanningRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);

  // Centre the origin once the viewport has a real size (the first render
  // happens before the size is known). Done during render — not in an
  // effect — so the centred camera is committed before paint and no later
  // effect can clobber early user input.
  const initialisedRef = useRef(viewport.width > 0 && viewport.height > 0);
  if (!initialisedRef.current && viewport.width > 0 && viewport.height > 0) {
    initialisedRef.current = true;
    const centred = resetCamera(viewport);
    cameraRef.current = centred;
    pendingCameraRef.current = centred;
    commitCamera(centred);
  }

  const apply = useCallback((next: Camera) => {
    if (next !== cameraRef.current && !navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    cameraRef.current = next;
    pendingCameraRef.current = next;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        commitCamera(pendingCameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    if (isPanningRef.current) return;
    isPanningRef.current = true;
    lastPointRef.current = p;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!isPanningRef.current || lastPointRef.current === null) return;
      const dx = p.x - lastPointRef.current.x;
      const dy = p.y - lastPointRef.current.y;
      lastPointRef.current = p;
      if (dx === 0 && dy === 0) return;
      apply(panBy(cameraRef.current, dx, dy));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    lastPointRef.current = null;
    setIsPanning(false);
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomByFactor = useCallback(
    (factor: number, point: Point) => {
      apply(zoomAt(cameraRef.current, point, factor));
    },
    [apply],
  );

  const zoomStepCb = useCallback(
    (dir: 'in' | 'out') => {
      apply(zoomStep(cameraRef.current, viewport, dir));
    },
    [apply, viewport],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewport));
  }, [apply, viewport]);

  const setCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    pendingCameraRef.current = cam;
    commitCamera(cam);
  }, []);

  // Release any scheduled frame on unmount.
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return {
    camera,
    hasNavigated,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomByFactor,
    zoomStep: zoomStepCb,
    reset,
    setCamera,
  };
}
