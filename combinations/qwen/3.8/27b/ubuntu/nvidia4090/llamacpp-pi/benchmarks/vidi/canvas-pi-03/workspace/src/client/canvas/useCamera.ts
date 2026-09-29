import { useCallback, useRef, useState } from 'react';
import { Camera, Point, Size, panBy, zoomAt, zoomStep, resetCamera } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '@/shared/config';
import { registerTestHooks } from './testHooks';

export interface UseCameraResult {
  camera: Camera;
  hasNavigated: boolean;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomStep: (dir: 'in' | 'out') => void;
  reset: () => void;
}

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);

  // Register test hooks
  const setCameraExternal = useCallback((cam: Camera) => {
    setCameraState(cam);
  }, []);
  const getCameraExternal = useCallback(() => cameraRef.current, []);
  registerTestHooks(setCameraExternal, getCameraExternal);

  const markNavigated = useCallback(() => {
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panRef.current = { lastX: p.x, lastY: p.y };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panRef.current) return;
      const dx = p.x - panRef.current.lastX;
      const dy = p.y - panRef.current.lastY;
      panRef.current = { lastX: p.x, lastY: p.y };
      if (dx === 0 && dy === 0) return;
      setCameraState(prev => {
        const next = panBy(prev, dx, dy);
        if (next !== prev) markNavigated();
        return next;
      });
    },
    [markNavigated],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      setCameraState(prev => {
        let next: Camera;
        if (e.ctrlOrMeta) {
          const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
          next = zoomAt(prev, e.point, factor);
        } else {
          next = panBy(prev, -e.deltaX, -e.deltaY);
        }
        if (next !== prev) markNavigated();
        return next;
      });
    },
    [markNavigated],
  );

  const zoomStepFn = useCallback(
    (dir: 'in' | 'out') => {
      setCameraState(prev => {
        const next = zoomStep(prev, viewport, dir);
        if (next !== prev) markNavigated();
        return next;
      });
    },
    [viewport.width, viewport.height, markNavigated],
  );

  const reset = useCallback(() => {
    setCameraState(prev => {
      const next = resetCamera(viewport);
      if (next !== prev) markNavigated();
      return next;
    });
  }, [viewport.width, viewport.height, markNavigated]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep: zoomStepFn,
    reset,
  };
}
