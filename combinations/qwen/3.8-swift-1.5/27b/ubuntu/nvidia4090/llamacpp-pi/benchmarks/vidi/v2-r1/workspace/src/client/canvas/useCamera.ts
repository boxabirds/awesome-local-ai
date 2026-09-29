import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Point, Size, panBy, zoomAt, zoomStep, resetCamera } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '@shared/config';

export function useCamera(viewport: Size) {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef<Point | null>(null);
  const panStartCameraRef = useRef<Camera | null>(null);
  const panCameraRef = useRef<Camera | null>(null);

  const rafRef = useRef<number>(0);

  const applyCamera = useCallback((newCam: Camera) => {
    if (newCam === cameraRef.current) return;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    cameraRef.current = newCam;
    setCameraState(newCam);
  }, []);

  const beginPan = useCallback((p: Point) => {
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = p;
    panStartCameraRef.current = cameraRef.current;
    panCameraRef.current = cameraRef.current;
  }, []);

  const panMove = useCallback((p: Point) => {
    if (!isPanningRef.current || !panStartRef.current || !panStartCameraRef.current) return;
    const dx = p.x - panStartRef.current.x;
    const dy = p.y - panStartRef.current.y;
    if (dx === 0 && dy === 0) return;
    const newCam = panBy(panStartCameraRef.current, dx, dy);
    if (newCam === panCameraRef.current) return;
    panCameraRef.current = newCam;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      cameraRef.current = newCam;
      setCameraState(newCam);
    });
  }, []);

  const endPan = useCallback(() => {
    if (!isPanningRef.current) return;
    cancelAnimationFrame(rafRef.current);
    if (panCameraRef.current && panCameraRef.current !== cameraRef.current) {
      cameraRef.current = panCameraRef.current;
      setCameraState(panCameraRef.current);
    }
    isPanningRef.current = false;
    setIsPanning(false);
    panStartRef.current = null;
    panStartCameraRef.current = null;
    panCameraRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const newCam = zoomAt(cameraRef.current, e.point, factor);
      applyCamera(newCam);
    } else {
      const newCam = panBy(cameraRef.current, -e.deltaX, -e.deltaY);
      applyCamera(newCam);
    }
  }, [applyCamera]);

  const zoomAtPointer = useCallback((point: Point, factor: number) => {
    const newCam = zoomAt(cameraRef.current, point, factor);
    applyCamera(newCam);
  }, [applyCamera]);

  const zoomStepCb = useCallback((dir: 'in' | 'out') => {
    const newCam = zoomStep(cameraRef.current, viewport, dir);
    applyCamera(newCam);
  }, [viewport, applyCamera]);

  const reset = useCallback(() => {
    const newCam = resetCamera(viewport);
    applyCamera(newCam);
  }, [viewport, applyCamera]);

  const setCamera = useCallback((newCam: Camera) => {
    cameraRef.current = newCam;
    setCameraState(newCam);
  }, []);

  // Clean up rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return {
    camera,
    hasNavigated,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPointer,
    zoomStep: zoomStepCb,
    reset,
    setCamera,
  };
}
