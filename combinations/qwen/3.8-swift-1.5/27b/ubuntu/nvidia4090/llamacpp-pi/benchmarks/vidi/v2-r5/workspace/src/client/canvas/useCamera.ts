// src/client/canvas/useCamera.ts
import { useCallback, useRef, useState } from 'react';
import type { Camera, Point, Size } from './camera';
import { panBy, zoomAt, zoomStep, resetCamera, canZoomIn, canZoomOut, zoomPercent } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface UseCameraResult {
  camera: Camera;
  hasNavigated: boolean;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  setCamera: (cam: Camera) => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomPercent: number;
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(INITIAL_CAMERA);
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  const panStartRef = useRef<Point | null>(null);

  const beginPan = useCallback((p: Point) => {
    panStartRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    const start = panStartRef.current;
    if (!start) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (dx === 0 && dy === 0) return;
    panStartRef.current = p;
    setCameraState(prev => {
      const newCam = panBy(prev, dx, dy);
      if (newCam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return newCam;
    });
  }, []);

  const endPan = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback(({ deltaX, deltaY, ctrlOrMeta, point }: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    setCameraState(prev => {
      let newCam: Camera;
      if (ctrlOrMeta) {
        const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
        newCam = zoomAt(prev, point, factor);
      } else {
        newCam = panBy(prev, -deltaX, -deltaY);
      }
      if (newCam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return newCam;
    });
  }, []);

  const zoomIn = useCallback(() => {
    setCameraState(prev => {
      const newCam = zoomStep(prev, viewport, 'in');
      if (newCam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return newCam;
    });
  }, [viewport]);

  const zoomOut = useCallback(() => {
    setCameraState(prev => {
      const newCam = zoomStep(prev, viewport, 'out');
      if (newCam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return newCam;
    });
  }, [viewport]);

  const reset = useCallback(() => {
    setCameraState(prev => {
      const newCam = resetCamera(viewport);
      if (newCam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return newCam;
    });
  }, [viewport]);

  const setCamera = useCallback((cam: Camera) => {
    setCameraState(prev => {
      if (cam === prev) return prev;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return cam;
    });
  }, []);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomIn,
    zoomOut,
    reset,
    setCamera,
    canZoomIn: canZoomIn(camera),
    canZoomOut: canZoomOut(camera),
    zoomPercent: zoomPercent(camera),
  };
}
