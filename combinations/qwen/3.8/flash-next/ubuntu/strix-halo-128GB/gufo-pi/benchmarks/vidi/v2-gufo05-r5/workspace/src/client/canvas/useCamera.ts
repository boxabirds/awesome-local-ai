import { useCallback, useEffect, useRef, useState } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

/** A normalised wheel/pinch gesture in screen pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Ctrl or Cmd held (and a trackpad pinch, which browsers report as a Ctrl wheel). */
  readonly ctrlOrMeta: boolean;
  /** Pointer position in viewport coordinates. */
  readonly point: Point;
}

export interface CameraController {
  /** Camera as rendered (state, so components re-render when it changes). */
  readonly camera: Camera;
  /** True once the user has panned or zoomed during this visit. */
  readonly hasNavigated: boolean;
  /** Live camera value, including updates that have not been rendered yet. */
  getCamera(): Camera;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(direction: ZoomDirection): void;
  reset(): void;
  /** Replace the camera wholesale (used by the test-mode hook to jump far away). */
  setCamera(cam: Camera): void;
}

/**
 * Owns the board camera and turns navigation gestures into camera changes.
 *
 * Camera updates are coalesced with requestAnimationFrame so a burst of pointermove
 * events causes at most one render per frame; the underlying value is updated
 * synchronously, so no distance is ever lost.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  // Latches true on the first camera change that actually produced a new object, and
  // never resets during the visit (only a page reload shows the hint again).
  const hasNavigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const panRef = useRef<{ active: boolean; last: Point }>({
    active: false,
    last: { x: 0, y: 0 },
  });

  const flush = useCallback(() => {
    frameRef.current = null;
    setCameraState(cameraRef.current);
  }, []);

  const apply = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      hasNavigatedRef.current = true;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    panRef.current = { active: true, last: p };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const pan = panRef.current;
      if (!pan.active) return;
      const dx = p.x - pan.last.x;
      const dy = p.y - pan.last.y;
      pan.last = p;
      if (dx === 0 && dy === 0) return;
      apply(panBy(cameraRef.current, dx, dy));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panRef.current = { active: false, last: { x: 0, y: 0 } };
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

  const zoomStep = useCallback(
    (direction: ZoomDirection) => {
      apply(zoomStepCamera(cameraRef.current, viewportRef.current, direction));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCamera = useCallback((cam: Camera) => apply(cam), [apply]);

  const getCamera = useCallback(() => cameraRef.current, []);

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    getCamera,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    setCamera,
  };
}
