import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy, resetCamera, zoomAt, zoomStep as stepCamera, type Camera, type Point, type Size,
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
  panning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomByFactor(factor: number, point: Point): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera>(null as unknown as Camera);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setRendered] = useState<Camera>(cameraRef.current);
  const [panning, setPanning] = useState(false);
  const hasNavigatedRef = useRef(false);
  const panLast = useRef<Point | null>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Latest camera is kept synchronously in a ref; rendering is coalesced to one per frame.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    hasNavigatedRef.current = true;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setRendered(cameraRef.current);
    });
  }, []);

  const beginPan = useCallback((p: Point) => {
    panLast.current = p;
    setPanning(true);
  }, []);

  const panMove = useCallback((p: Point) => {
    const last = panLast.current;
    if (!last) return;
    panLast.current = p;
    commit(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
  }, [commit]);

  const endPan = useCallback(() => {
    panLast.current = null;
    setPanning(false);
  }, []);

  const zoomByFactor = useCallback((factor: number, point: Point) => {
    commit(zoomAt(cameraRef.current, point, factor));
  }, [commit]);

  const wheel = useCallback((e: WheelInput) => {
    if (e.ctrlOrMeta) {
      zoomByFactor(Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY), e.point);
    } else {
      commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    }
  }, [commit, zoomByFactor]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    commit(stepCamera(cameraRef.current, viewportRef.current, dir));
  }, [commit]);

  const reset = useCallback(() => {
    const target = resetCamera(viewportRef.current);
    const cur = cameraRef.current;
    if (cur.x === target.x && cur.y === target.y && cur.zoom === target.zoom) return;
    commit(target);
  }, [commit]);

  const setCamera = useCallback((cam: Camera) => commit(cam), [commit]);
  const getCamera = useCallback(() => cameraRef.current, []);

  return {
    camera, hasNavigated: hasNavigatedRef.current, panning, beginPan, panMove, endPan, wheel,
    zoomByFactor, zoomStep, reset, setCamera, getCamera,
  };
}
