import { useCallback, useRef, useState } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep as zoomStepAt,
  resetCamera,
} from '@client/canvas/camera';
import { WHEEL_ZOOM_SENSITIVITY } from '@shared/config';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by a Safari gesture scale ratio around a screen point. */
  gestureZoom(point: Point, ratio: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test-only: jump to an absolute camera. */
  setCamera(next: Camera): void;
}

// Camera lives in React state only (discarded on reload, per PRD). A mutation
// that produces the same object (camera.math returns the input for no-ops) is a
// no-op: it neither re-renders nor latches hasNavigated (TC-29). React 18/19
// batches updates within an event handler to a single render.
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const hasNavigatedRef = useRef(false);

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const panOriginRef = useRef<Point | null>(null);

  const apply = useCallback((next: Camera) => {
    setCameraState((prev) => {
      if (next === prev) return prev;
      hasNavigatedRef.current = true;
      return next;
    });
  }, []);

  const applyTransform = useCallback((fn: (prev: Camera) => Camera) => {
    setCameraState((prev) => {
      const next = fn(prev);
      if (next === prev) return prev;
      hasNavigatedRef.current = true;
      return next;
    });
  }, []);

  const beginPan = useCallback((p: Point) => {
    panOriginRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const origin = panOriginRef.current;
      if (!origin) return;
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      panOriginRef.current = p;
      applyTransform((prev) => panBy(prev, dx, dy));
    },
    [applyTransform],
  );

  const endPan = useCallback(() => {
    panOriginRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyTransform((prev) => zoomAt(prev, e.point, factor));
      } else {
        applyTransform((prev) => panBy(prev, -e.deltaX, -e.deltaY));
      }
    },
    [applyTransform],
  );

  const gestureZoom = useCallback(
    (point: Point, ratio: number) => {
      applyTransform((prev) => zoomAt(prev, point, ratio));
    },
    [applyTransform],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      applyTransform((prev) => zoomStepAt(prev, viewportRef.current, dir));
    },
    [applyTransform],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const setCamera = useCallback(
    (next: Camera) => {
      apply(next);
    },
    [apply],
  );

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  };
}
