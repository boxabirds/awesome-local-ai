import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy, resetCamera, zoomAt, zoomStep as cameraZoomStep, type Camera, type Point, type Size,
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
  isPanning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const cameraRef = useRef<Camera>(null as unknown as Camera);
  if (cameraRef.current === null) cameraRef.current = resetCamera(viewport);
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);

  const navigatedRef = useRef(false);
  const panRef = useRef<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const frameRef = useRef<number | null>(null);

  // Camera updates are applied to the ref immediately (so successive events compose
  // exactly) and flushed to React state at most once per animation frame.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    navigatedRef.current = true;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const api = useMemo(() => ({
    beginPan(p: Point) {
      panRef.current = p;
      setIsPanning(true);
    },
    panMove(p: Point) {
      const last = panRef.current;
      if (!last) return;
      panRef.current = p;
      commit(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    endPan() {
      panRef.current = null;
      setIsPanning(false);
    },
    wheel(e: WheelInput) {
      if (e.ctrlOrMeta) {
        commit(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    zoomAtPoint(point: Point, factor: number) {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    zoomStep(dir: 'in' | 'out') {
      commit(cameraZoomStep(cameraRef.current, viewportRef.current, dir));
    },
    reset() {
      const next = resetCamera(viewportRef.current);
      const cur = cameraRef.current;
      commit(next.x === cur.x && next.y === cur.y && next.zoom === cur.zoom ? cur : next);
    },
    setCamera(cam: Camera) {
      commit(cam);
    },
  }), [commit]);

  return { camera, hasNavigated: navigatedRef.current, isPanning, ...api };
}
