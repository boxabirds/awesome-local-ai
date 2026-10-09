import { useCallback, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepAtViewport,
  type Camera,
  type Point,
  type Size
} from './camera';

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  gestureZoomAtPointer(scaleRatio: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  getCamera(): Camera;
  setCamera(next: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  const rafRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const panLastRef = useRef<Point | null>(null);

  const applyCamera = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    hasNavigatedRef.current = true;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback(
    (p: Point) => {
      panLastRef.current = p;
    },
    []
  );

  const panMove = useCallback(
    (p: Point) => {
      const last = panLastRef.current;
      if (last === null) return;
      panLastRef.current = p;
      applyCamera(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [applyCamera]
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        applyCamera(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera]
  );

  const gestureZoomAtPointer = useCallback(
    (scaleRatio: number, point: Point) => {
      applyCamera(zoomAt(cameraRef.current, point, scaleRatio));
    },
    [applyCamera]
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      applyCamera(zoomStepAtViewport(cameraRef.current, viewport, dir));
    },
    [applyCamera, viewport]
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewport));
  }, [applyCamera, viewport]);

  const getCamera = useCallback(() => cameraRef.current, []);

  const setCamera = useCallback(
    (next: Camera) => {
      applyCamera(next);
      // applyCamera batches the state update into the next frame for
      // wheel/pan smoothness. Programmatic camera changes (test helpers,
      // reset-to-board) must be visible to rendered components before the
      // caller's next action, so flush the batched state here.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setCameraState(cameraRef.current);
    },
    [applyCamera]
  );

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoomAtPointer,
    zoomStep,
    reset,
    getCamera,
    setCamera
  };
}
