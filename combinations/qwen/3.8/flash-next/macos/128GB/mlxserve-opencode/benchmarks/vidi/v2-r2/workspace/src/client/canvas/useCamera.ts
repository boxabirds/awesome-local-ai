import { useCallback, useRef, useState } from 'react';
import {
  Camera,
  Size,
  Point,
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
  gestureStart(): void;
  gestureChange(scale: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCameraDirectly(c: Camera): void;
}

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<Camera>(camera);
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const panOriginRef = useRef<Point | null>(null);
  const gestureStartZoomRef = useRef(1);

  const applyCamera = useCallback((next: Camera) => {
    if (next !== cameraRef.current) {
      cameraRef.current = next;
      setCameraState(next);
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panOriginRef.current = { x: p.x, y: p.y };
  }, []);

  const panMove = useCallback((p: Point) => {
    const origin = panOriginRef.current;
    if (origin === null) return;
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    if (dx === 0 && dy === 0) return;
    const next = panBy(cameraRef.current, dx, dy);
    applyCamera(next);
    panOriginRef.current = { x: p.x, y: p.y };
  }, [applyCamera]);

  const endPan = useCallback(() => {
    panOriginRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const next = zoomAt(cameraRef.current, e.point, factor);
      applyCamera(next);
    } else {
      const next = panBy(cameraRef.current, -e.deltaX, -e.deltaY);
      applyCamera(next);
    }
  }, [applyCamera]);

  const gestureStart = useCallback(() => {
    gestureStartZoomRef.current = cameraRef.current.zoom;
  }, []);

  const gestureChange = useCallback((scale: number, point: Point) => {
    const targetZoom = gestureStartZoomRef.current * scale;
    const cam = cameraRef.current;
    const factor = targetZoom / cam.zoom;
    const next = zoomAt(cam, point, factor);
    applyCamera(next);
  }, [applyCamera]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    const next = zoomStepFn(cameraRef.current, viewport, dir);
    applyCamera(next);
  }, [viewport, applyCamera]);

  const reset = useCallback(() => {
    const next = resetCamera(viewport);
    applyCamera(next);
  }, [viewport, applyCamera]);

  const setCameraDirectly = useCallback((c: Camera) => {
    cameraRef.current = c;
    setCameraState(c);
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureStart,
    gestureChange,
    zoomStep,
    reset,
    setCameraDirectly,
  };
}
