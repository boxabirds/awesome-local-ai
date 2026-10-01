import { useCallback, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_HEIGHT_PX = 16;

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
  /** DOM deltaMode (0 pixel, 1 line, 2 page); defaults to pixels. */
  deltaMode?: number;
}

export function useCamera(viewport: Size) {
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastPanPoint = useRef<Point | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    setCameraState(cameraRef.current);
    if (navigatedRef.current) setHasNavigated(true);
  }, []);

  // Coalesce camera updates to at most one render per animation frame.
  const apply = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      navigatedRef.current = true;
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const beginPan = useCallback((p: Point) => {
    lastPanPoint.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPanPoint.current;
      if (!last) return;
      lastPanPoint.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    lastPanPoint.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      let { deltaX, deltaY } = e;
      if (e.deltaMode === DOM_DELTA_LINE) {
        deltaX *= LINE_HEIGHT_PX;
        deltaY *= LINE_HEIGHT_PX;
      } else if (e.deltaMode === DOM_DELTA_PAGE) {
        deltaX *= viewportRef.current.width;
        deltaY *= viewportRef.current.height;
      }
      if (e.ctrlOrMeta) {
        apply(zoomAt(cameraRef.current, e.point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        apply(panBy(cameraRef.current, -deltaX, -deltaY));
      }
    },
    [apply],
  );

  const zoomByFactor = useCallback(
    (point: Point, factor: number) => apply(zoomAt(cameraRef.current, point, factor)),
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => apply(cameraZoomStep(cameraRef.current, viewportRef.current, dir)),
    [apply],
  );

  const reset = useCallback(() => apply(resetCamera(viewportRef.current)), [apply]);

  const setCamera = useCallback((cam: Camera) => apply(cam), [apply]);
  /** Latest camera, including updates not yet flushed to React state. */
  const getCamera = useCallback(() => cameraRef.current, []);

  return {
    camera,
    getCamera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomByFactor,
    zoomStep,
    reset,
    setCamera,
  };
}
