import { useCallback, useEffect, useRef, useState } from 'react';
import { type Camera, type Point, type Size, panBy, resetCamera, zoomAt, zoomStep as stepCamera } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraController {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by a raw factor around a screen point (Safari gestures). */
  zoomBy(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Direct camera replacement; used only by the test hook. */
  setCamera(cam: Camera): void;
  /** Latest camera, including updates not yet flushed to React state. */
  getCamera(): Camera;
}

export function useCamera(viewport: Size): CameraController {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera | null>(null);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setRenderedCamera] = useState<Camera>(cameraRef.current);
  const [hasNavigated, setHasNavigated] = useState(false);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastPanPoint = useRef<Point | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    setRenderedCamera(cameraRef.current as Camera);
    setHasNavigated(navigatedRef.current);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const update = useCallback(
    (fn: (cam: Camera) => Camera) => {
      const current = cameraRef.current as Camera;
      const next = fn(current);
      if (next === current) return;
      cameraRef.current = next;
      navigatedRef.current = true;
      schedule();
    },
    [schedule],
  );

  const beginPan = useCallback((p: Point) => {
    lastPanPoint.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPanPoint.current;
      if (!last) return;
      lastPanPoint.current = p;
      update((cam) => panBy(cam, p.x - last.x, p.y - last.y));
    },
    [update],
  );

  const endPan = useCallback(() => {
    lastPanPoint.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        update((cam) => zoomAt(cam, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        update((cam) => panBy(cam, -e.deltaX, -e.deltaY));
      }
    },
    [update],
  );

  const zoomBy = useCallback((point: Point, factor: number) => update((cam) => zoomAt(cam, point, factor)), [update]);

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => update((cam) => stepCamera(cam, viewportRef.current, dir)),
    [update],
  );

  const reset = useCallback(() => {
    update((cam) => {
      const next = resetCamera(viewportRef.current);
      return next.x === cam.x && next.y === cam.y && next.zoom === cam.zoom ? cam : next;
    });
  }, [update]);

  const setCamera = useCallback((cam: Camera) => update(() => cam), [update]);
  const getCamera = useCallback(() => cameraRef.current as Camera, []);

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomBy, zoomStep, reset, setCamera, getCamera };
}
