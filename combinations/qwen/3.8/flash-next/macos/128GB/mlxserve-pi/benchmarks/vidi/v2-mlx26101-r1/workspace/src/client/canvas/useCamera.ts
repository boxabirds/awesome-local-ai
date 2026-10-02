import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
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
import { installTestHooks } from './testHooks';

/** The subset of a wheel / synthetic-gesture event the hook needs. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** True once any real navigation (a camera change) has happened this visit. */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  zoomPercent(): number;
  canZoomIn(): boolean;
  canZoomOut(): boolean;
}

/**
 * Owns the camera for a viewport of the given size and turns high-level input
 * intents into camera state. The camera reference only changes when a mutation
 * actually moves it, which is what latches `hasNavigated` (a no-op such as a
 * click without movement must not dismiss the first-use hint).
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() =>
    resetCamera(viewport),
  );
  const [hasNavigated, setHasNavigated] = useState(false);

  // Mirror of the camera + a navigation latch. Keeping the source of truth in
  // refs lets every handler compute from the latest camera without stale
  // closures and keeps React state updaters free of side effects.
  const cameraRef = useRef<Camera>(camera);
  const navigatedRef = useRef(false);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  // A drag is described by the camera and pointer position captured when the
  // press began; panning always computes the total pointer delta from that
  // snapshot so a multi-event drag tracks the pointer exactly (each event is
  // idempotent for its position rather than incrementally accumulating).
  const panStartRef = useRef<{ camera: Camera; pointer: Point } | null>(null);

  const apply = useCallback((next: Camera) => {
    if (next === cameraRef.current) return; // no-op: same object, no re-render
    cameraRef.current = next;
    setCameraState(next);
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panStartRef.current = { camera: cameraRef.current, pointer: p };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const start = panStartRef.current;
      if (start === null) return; // not panning
      const dx = p.x - start.pointer.x;
      const dy = p.y - start.pointer.y;
      if (dx === 0 && dy === 0) return;
      // Move content by the total pointer delta from the pan-start snapshot.
      apply(panBy(start.camera, dx, dy));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        apply(zoomAt(cameraRef.current, e.point, factor));
      } else {
        apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      apply(cameraZoomStep(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const getZoomPercent = useCallback(() => zoomPercent(cameraRef.current), []);
  const getCanZoomIn = useCallback(() => cameraCanZoomIn(cameraRef.current), []);
  const getCanZoomOut = useCallback(
    () => cameraCanZoomOut(cameraRef.current),
    [],
  );

  // e2e tests may jump the camera directly; no-op outside test mode.
  useEffect(
    () =>
      installTestHooks(
        () => cameraRef.current,
        (cam) => apply(cam),
      ),
    [apply],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    zoomPercent: getZoomPercent,
    canZoomIn: getCanZoomIn,
    canZoomOut: getCanZoomOut,
  };
}
