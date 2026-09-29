import { useState, useRef, useCallback } from 'react';
import {
  Camera,
  Point,
  Size,
  panBy,
  zoomAt,
  zoomStep as zoomStepFn,
  resetCamera,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '@shared/config';

export interface UseCameraResult {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  gestureZoom(scale: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const panStartRef = useRef<Point | null>(null);

  const tripNavigated = useCallback(() => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const updateCamera = useCallback((updater: (prev: Camera) => Camera) => {
    setCameraState((prev) => {
      const next = updater(prev);
      if (next !== prev) {
        tripNavigated();
      }
      return next;
    });
  }, [tripNavigated]);

  const setCamera = useCallback((cam: Camera) => {
    setCameraState(cam);
    tripNavigated();
  }, [tripNavigated]);

  const beginPan = useCallback((p: Point) => {
    panStartRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    if (!panStartRef.current) return;
    const dx = p.x - panStartRef.current.x;
    const dy = p.y - panStartRef.current.y;
    panStartRef.current = p;
    if (dx === 0 && dy === 0) return;
    updateCamera((prev) => panBy(prev, dx, dy));
  }, [updateCamera]);

  const endPan = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    updateCamera((prev) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        return zoomAt(prev, e.point, factor);
      } else {
        return panBy(prev, -e.deltaX, -e.deltaY);
      }
    });
  }, [updateCamera]);

  const gestureZoom = useCallback((scale: number, point: Point) => {
    updateCamera((prev) => zoomAt(prev, point, scale));
  }, [updateCamera]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    updateCamera((prev) => zoomStepFn(prev, viewport, dir));
  }, [updateCamera, viewport.width, viewport.height]);

  const reset = useCallback(() => {
    setCameraState(resetCamera(viewport));
    tripNavigated();
  }, [viewport.width, viewport.height, tripNavigated]);

  return {
    camera,
    hasNavigated,
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
