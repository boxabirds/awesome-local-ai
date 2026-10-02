import { useCallback, useRef, useState } from 'react';
import type { Camera, Size, Point } from './camera';
import {
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
  gestureZoom(scale: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(INITIAL_CAMERA);
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const panStartRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingCameraRef = useRef<Camera | null>(null);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);

  // Keep cameraRef in sync
  cameraRef.current = pendingCameraRef.current ?? camera;

  const commitCamera = useCallback((next: Camera) => {
    if (next !== cameraRef.current) {
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
    }
    // Coalesce updates via rAF
    pendingCameraRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (pendingCameraRef.current) {
          setCameraState(pendingCameraRef.current);
          pendingCameraRef.current = null;
        }
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    panStartRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    if (!panStartRef.current) return;
    const dx = p.x - panStartRef.current.x;
    const dy = p.y - panStartRef.current.y;
    panStartRef.current = p;
    const base = pendingCameraRef.current ?? cameraRef.current;
    const next = panBy(base, dx, dy);
    commitCamera(next);
  }, [commitCamera]);

  const endPan = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    const base = pendingCameraRef.current ?? cameraRef.current;
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const next = zoomAt(base, e.point, factor);
      commitCamera(next);
    } else {
      const next = panBy(base, -e.deltaX, -e.deltaY);
      commitCamera(next);
    }
  }, [commitCamera]);

  const gestureZoom = useCallback((scale: number, point: Point) => {
    const base = pendingCameraRef.current ?? cameraRef.current;
    const next = zoomAt(base, point, scale);
    commitCamera(next);
  }, [commitCamera]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    const base = pendingCameraRef.current ?? cameraRef.current;
    const next = zoomStepFn(base, viewport, dir);
    commitCamera(next);
  }, [viewport, commitCamera]);

  const reset = useCallback(() => {
    const next = resetCamera(viewport);
    commitCamera(next);
  }, [viewport, commitCamera]);

  const setCamera = useCallback((cam: Camera) => {
    setCameraState(cam);
    pendingCameraRef.current = null;
  }, []);

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
