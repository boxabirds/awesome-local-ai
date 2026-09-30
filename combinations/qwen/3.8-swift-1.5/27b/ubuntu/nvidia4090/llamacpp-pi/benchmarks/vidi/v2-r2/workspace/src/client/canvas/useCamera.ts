import { useRef, useCallback, useState, useEffect } from 'react';
import { Camera, Point, Size, panBy, zoomAt, zoomStep, resetCamera } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface UseCameraReturn {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomStepFn(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): UseCameraReturn {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const prevCameraRef = useRef<Camera>(camera);

  const panStateRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Detect camera changes and mark navigated
  useEffect(() => {
    if (camera !== prevCameraRef.current) {
      prevCameraRef.current = camera;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
    }
  }, [camera]);

  const beginPan = useCallback((p: Point) => {
    panStateRef.current = { lastX: p.x, lastY: p.y };
  }, []);

  const panMove = useCallback((p: Point) => {
    const state = panStateRef.current;
    if (!state) return;
    const dx = p.x - state.lastX;
    const dy = p.y - state.lastY;
    state.lastX = p.x;
    state.lastY = p.y;
    setCamera((prev) => panBy(prev, dx, dy));
  }, []);

  const endPan = useCallback(() => {
    panStateRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      setCamera((prev) => {
        if (e.ctrlOrMeta) {
          const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
          return zoomAt(prev, e.point, factor);
        }
        return panBy(prev, -e.deltaX, -e.deltaY);
      });
    },
    []
  );

  const zoomStepFn = useCallback((dir: 'in' | 'out') => {
    setCamera((prev) => zoomStep(prev, viewportRef.current, dir));
  }, []);

  const reset = useCallback(() => {
    setCamera(() => resetCamera(viewportRef.current));
  }, []);

  const setCameraDirect = useCallback((cam: Camera) => {
    setCamera(cam);
  }, []);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStepFn,
    reset,
    setCamera: setCameraDirect,
  };
}
