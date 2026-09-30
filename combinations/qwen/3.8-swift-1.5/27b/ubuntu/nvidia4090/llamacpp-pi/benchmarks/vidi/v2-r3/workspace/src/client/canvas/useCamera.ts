import { useState, useRef, useCallback, useEffect } from 'react';
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
import { registerTestHooks } from './testHooks';

export function useCamera(viewport: Size): {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
} {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<Camera>(camera);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const lastPanPointRef = useRef<Point | null>(null);
  const rafIdRef = useRef<number>(0);

  const applyCamera = useCallback((newCam: Camera) => {
    if (newCam === cameraRef.current) return;
    cameraRef.current = newCam;
    // Also expose on window for E2E test reliability (avoids module duplication issues)
    (window as any).__vidi6CameraState = newCam;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = 0;
        setCamera(cameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPanPointRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    const last = lastPanPointRef.current;
    if (!last) return;
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx === 0 && dy === 0) return;
    lastPanPointRef.current = p;
    applyCamera(panBy(cameraRef.current, dx, dy));
  }, [applyCamera]);

  const endPan = useCallback(() => {
    lastPanPointRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      applyCamera(zoomAt(cameraRef.current, e.point, factor));
    } else {
      applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    }
  }, [applyCamera]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    applyCamera(zoomStepFn(cameraRef.current, viewport, dir));
  }, [applyCamera, viewport]);

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewport));
  }, [applyCamera, viewport]);

  // Register test hooks
  useEffect(() => {
    registerTestHooks(
      (cam: Camera) => { applyCamera(cam); },
      () => (window as any).__vidi6CameraState ?? cameraRef.current,
    );
  }, [applyCamera]);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset };
}
