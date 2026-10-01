import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  type Camera, type Point, type Size, panBy, resetCamera, zoomAt, zoomStep as stepCamera,
} from './camera';

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by an arbitrary factor around a screen point (used for Safari pinch). */
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Directly replace the camera (test hook only). */
  setCamera(camera: Camera): void;
}

/**
 * Camera state. The latest camera lives in a ref so that several events within one
 * frame compose correctly; React state is updated at most once per animation frame.
 */
export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera | null>(null);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);

  const navigatedRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);

  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    navigatedRef.current = true;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCameraState(cameraRef.current as Camera);
    });
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const current = () => cameraRef.current as Camera;

  const beginPan = useCallback((p: Point) => { lastPointRef.current = p; }, []);
  const panMove = useCallback((p: Point) => {
    const last = lastPointRef.current;
    if (!last) return;
    lastPointRef.current = p;
    commit(panBy(current(), p.x - last.x, p.y - last.y));
  }, [commit]);
  const endPan = useCallback(() => { lastPointRef.current = null; }, []);

  const wheel = useCallback((e: WheelInput) => {
    if (e.ctrlOrMeta) {
      commit(zoomAt(current(), e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
    } else {
      commit(panBy(current(), -e.deltaX, -e.deltaY));
    }
  }, [commit]);

  const zoomAtPoint = useCallback((point: Point, factor: number) => {
    commit(zoomAt(current(), point, factor));
  }, [commit]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    commit(stepCamera(current(), viewportRef.current, dir));
  }, [commit]);

  const reset = useCallback(() => {
    const target = resetCamera(viewportRef.current);
    const cam = current();
    if (cam.x === target.x && cam.y === target.y && cam.zoom === target.zoom) return;
    commit(target);
  }, [commit]);

  const setCamera = useCallback((next: Camera) => commit(next), [commit]);

  return {
    camera, hasNavigated: navigatedRef.current,
    beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset, setCamera,
  };
}
