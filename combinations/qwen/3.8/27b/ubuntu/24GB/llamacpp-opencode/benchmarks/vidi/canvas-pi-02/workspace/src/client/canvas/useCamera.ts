import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera, Point, Size } from './camera';
import { panBy, resetCamera, zoomAt, zoomStep as zoomStepMath } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { installTestHook, removeTestHook } from './testHooks';

/** Camera API shared by BoardViewport, ZoomControls and NavigationHint. */
export interface CameraApi {
  /** Current committed camera. */
  camera: Camera;
  /** Latches true on the first camera change during the visit; reset only by reload. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  /** Zoom by `factor` keeping the world point under `p` fixed (Safari pinch). */
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Camera state + navigation actions.
 *
 * Camera updates are coalesced with requestAnimationFrame so at most one
 * render happens per frame. A no-op update (camera.math returns the same
 * object: zero delta, limit reached, invalid factor) does not schedule a
 * render and does not trip `hasNavigated`.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const pendingRef = useRef<Camera | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const dragRef = useRef<{ start: Point; base: Camera } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const applyCamera = useCallback((next: Camera) => {
    if (next === cameraRef.current) return; // no-op: skip render and hint dismissal
    if (!hasNavigatedRef.current) hasNavigatedRef.current = true;
    cameraRef.current = next;
    pendingRef.current = next;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        setCamera(pendingRef.current as Camera);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    dragRef.current = { start: p, base: cameraRef.current };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const drag = dragRef.current;
      if (!drag) return;
      applyCamera(panBy(drag.base, p.x - drag.start.x, p.y - drag.start.y));
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    dragRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyCamera(zoomAt(cameraRef.current, e.point, factor));
      } else {
        // Content moves opposite to the scroll direction, matching native scrolling.
        applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number) => {
      applyCamera(zoomAt(cameraRef.current, p, factor));
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      applyCamera(zoomStepMath(cameraRef.current, viewportRef.current, direction));
    },
    [applyCamera],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  // Test-only hook (dead-code-eliminated from production builds). Jumping the
  // camera is a test convenience, not user navigation: it does not trip the
  // hasNavigated latch.
  useEffect(() => {
    installTestHook((cam: Camera) => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
        pendingRef.current = null;
      }
      cameraRef.current = cam;
      setCamera(cam);
    });
    return removeTestHook;
  }, []);

  // Drop a pending frame on unmount.
  useEffect(
    () => () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    },
    [],
  );

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep,
    reset,
  };
}
