import { useState, useRef, useCallback, useReducer } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep as zoomStepFn,
  resetCamera,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface UseCameraResult {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const hasNavigatedRef = useRef(false);
  const [, forceUpdate] = useReducer((c: boolean) => !c, false);

  const lastPanPointRef = useRef<Point | null>(null);
  const rafRef = useRef<number>(0);

  const applyCamera = useCallback((newCam: Camera, prevCam: Camera) => {
    if (newCam !== prevCam) {
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        forceUpdate();
      }
      return newCam;
    }
    return prevCam;
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPanPointRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    const last = lastPanPointRef.current;
    if (!last) return;
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    lastPanPointRef.current = p;

    if (dx === 0 && dy === 0) return;

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setCameraState((prev) => applyCamera(panBy(prev, dx, dy), prev));
    });
  }, [applyCamera]);

  const endPan = useCallback(() => {
    lastPanPointRef.current = null;
    cancelAnimationFrame(rafRef.current);
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        setCameraState((prev) => applyCamera(zoomAt(prev, e.point, factor), prev));
      } else {
        setCameraState((prev) => applyCamera(panBy(prev, -e.deltaX, -e.deltaY), prev));
      }
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      setCameraState((prev) => applyCamera(zoomStepFn(prev, viewport, dir), prev));
    },
    [viewport, applyCamera],
  );

  const reset = useCallback(() => {
    setCameraState((prev) => applyCamera(resetCamera(viewport), prev));
  }, [viewport, applyCamera]);

  const setCamera = useCallback((cam: Camera) => {
    setCameraState((prev) => applyCamera(cam, prev));
  }, [applyCamera]);

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    setCamera,
  };
}
