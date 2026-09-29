import { useState, useRef, useCallback } from 'react';
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface UseCameraResult {
  camera: Camera;
  hasNavigated: boolean;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomStepIn: () => void;
  zoomStepOut: () => void;
  reset: () => void;
  setCamera: (cam: Camera) => void;
}

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const panStateRef = useRef<{ lastPoint: Point } | null>(null);

  const applyCamera = useCallback((next: Camera) => {
    const prev = cameraRef.current;
    if (next === prev) return;
    cameraRef.current = next;
    setCameraState(next);
    setHasNavigated(true);
  }, []);

  const beginPan = useCallback((p: Point) => {
    panStateRef.current = { lastPoint: p };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const state = panStateRef.current;
      if (!state) return;
      const dx = p.x - state.lastPoint.x;
      const dy = p.y - state.lastPoint.y;
      state.lastPoint = p;
      if (dx === 0 && dy === 0) return;
      const next = panBy(cameraRef.current, dx, dy);
      applyCamera(next);
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    panStateRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      const cam = cameraRef.current;
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        const next = zoomAt(cam, e.point, factor);
        applyCamera(next);
      } else {
        const next = panBy(cam, -e.deltaX, -e.deltaY);
        applyCamera(next);
      }
    },
    [applyCamera],
  );

  const zoomStepIn = useCallback(() => {
    const next = zoomStep(cameraRef.current, viewportRef.current, 'in');
    applyCamera(next);
  }, [applyCamera]);

  const zoomStepOut = useCallback(() => {
    const next = zoomStep(cameraRef.current, viewportRef.current, 'out');
    applyCamera(next);
  }, [applyCamera]);

  const reset = useCallback(() => {
    const next = resetCamera(viewportRef.current);
    applyCamera(next);
  }, [applyCamera]);

  const setCamera = useCallback(
    (newCam: Camera) => {
      const prev = cameraRef.current;
      if (newCam === prev) return;
      cameraRef.current = newCam;
      setCameraState(newCam);
      setHasNavigated(true);
    },
    [],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStepIn,
    zoomStepOut,
    reset,
    setCamera,
  };
}
