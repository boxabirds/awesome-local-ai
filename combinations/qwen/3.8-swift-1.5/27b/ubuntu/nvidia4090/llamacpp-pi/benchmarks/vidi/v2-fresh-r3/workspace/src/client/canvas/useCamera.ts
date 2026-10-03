import { useCallback, useRef, useState, useEffect } from 'react';
import {
  Camera,
  Point,
  Size,
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

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(INITIAL_CAMERA);
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const hasNavigatedRef = useRef(false);
  const panState = useRef<{ lastPoint: Point } | null>(null);

  // Keep refs in sync
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const applyCamera = useCallback((newCam: Camera) => {
    const prev = cameraRef.current;
    if (newCam === prev) return;
    cameraRef.current = newCam;
    setCameraState(newCam);
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panState.current = { lastPoint: p };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panState.current) return;
      const { lastPoint } = panState.current;
      const dx = p.x - lastPoint.x;
      const dy = p.y - lastPoint.y;
      panState.current = { lastPoint: p };
      if (dx === 0 && dy === 0) return;
      const newCam = panBy(cameraRef.current, dx, dy);
      applyCamera(newCam);
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    panState.current = null;
  }, []);

  const wheel = useCallback(
    (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (e.ctrlOrMeta) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        const newCam = zoomAt(cameraRef.current, e.point, factor);
        applyCamera(newCam);
      } else {
        const newCam = panBy(cameraRef.current, -e.deltaX, -e.deltaY);
        applyCamera(newCam);
      }
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      const newCam = zoomStepFn(cameraRef.current, viewport, dir);
      applyCamera(newCam);
    },
    [applyCamera, viewport],
  );

  const reset = useCallback(() => {
    const newCam = resetCamera(viewport);
    applyCamera(newCam);
  }, [applyCamera, viewport]);

  const setCamera = useCallback(
    (cam: Camera) => {
      applyCamera(cam);
    },
    [applyCamera],
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
    setCamera,
  };
}
