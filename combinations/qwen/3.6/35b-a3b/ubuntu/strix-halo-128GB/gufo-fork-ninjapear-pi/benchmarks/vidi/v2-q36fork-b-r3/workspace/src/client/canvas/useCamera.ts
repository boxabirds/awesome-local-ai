import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera, Size, Point } from './camera';
import { panBy, zoomAt, resetCamera as resetCameraImpl, zoomStep as zoomStepImpl } from './camera';
import { WHEEL_ZOOM_SENSITIVITY, LINE_DELTA, PAGE_DELTA } from '@shared/config';

export function useCamera(initialViewport: Size) {
  const initialCam = resetCameraImpl(initialViewport);
  const [camera, setCamera] = useState<Camera>(initialCam);

  // Latched to true once any *new* camera object is produced
  const hasNavigatedRef = useRef(false);
  const hasNavigated = hasNavigatedRef.current;

  const setCameraAndMark = useCallback(
    (next: Camera) => {
      if (next !== camera) {
        hasNavigatedRef.current = true;
      }
      setCamera(next);
    },
    [camera],
  );

  const beginPan = useCallback(
    (_p: Point) => {
      setCamera(camera);
    },
    [camera],
  );

  const panMove = useCallback(
    (dx: number, dy: number) => {
      setCameraAndMark(panBy(camera, dx, dy));
    },
    [camera, setCameraAndMark],
  );

  const endPan = useCallback(() => {
    // No-op: camera stays at its last value
  }, []);

  const wheel = useCallback(
    ({
      deltaX,
      deltaY,
      ctrlOrMeta,
      point,
    }: {
      deltaX: number;
      deltaY: number;
      ctrlOrMeta: boolean;
      point: Point;
    }) => {
      if (ctrlOrMeta) {
        const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
        const newCam = zoomAt(camera, point, factor);
        setCameraAndMark(newCam);
      } else {
        setCameraAndMark(panBy(camera, -deltaX, -deltaY));
      }
    },
    [camera, setCameraAndMark],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      const vp = { width: initialViewport.width, height: initialViewport.height };
      const newCam = zoomStepImpl(camera, vp, direction);
      setCameraAndMark(newCam);
    },
    [camera, initialViewport, setCameraAndMark],
  );

  const reset = useCallback(() => {
    setCameraAndMark(resetCameraImpl(initialViewport));
  }, [initialViewport, setCameraAndMark]);

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
  };
}
