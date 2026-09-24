import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as stepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { installTestHooks } from './testHooks';

export interface WheelInput {
  /** Scroll deltas in CSS pixels (callers convert line/page modes). */
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  /** Pointer position relative to the board area's top-left corner. */
  point: Point;
}

export interface CameraController {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zooms by a multiplicative factor around a board-area point (Safari pinch). */
  zoomBy(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

function hasArea(size: Size): boolean {
  return size.width > 0 && size.height > 0;
}

/**
 * Holds the camera for one viewer (nothing is persisted or shared).
 * Updates are applied immediately to a ref, so several events inside one frame
 * compose correctly, and committed to React state at most once per animation frame.
 * `hasNavigated` latches true the first time an action produces a different camera.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const viewportRef = useRef(viewport);
  const frameRef = useRef<number | null>(null);
  const panPointRef = useRef<Point | null>(null);
  const centredRef = useRef(hasArea(viewport));

  viewportRef.current = viewport;

  const commit = useCallback(() => {
    frameRef.current = null;
    setCamera(cameraRef.current);
    setHasNavigated(navigatedRef.current);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(commit);
  }, [commit]);

  /** Applies a camera update; a no-op (same object) neither renders nor dismisses the hint. */
  const apply = useCallback(
    (update: (c: Camera) => Camera, countsAsNavigation = true) => {
      const next = update(cameraRef.current);
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (countsAsNavigation) navigatedRef.current = true;
      schedule();
    },
    [schedule],
  );

  // Until the board area has been measured, keep the starting point centred.
  // After that, resizing never moves the camera (content stays anchored top-left).
  useLayoutEffect(() => {
    if (centredRef.current || !hasArea(viewport)) return;
    centredRef.current = true;
    cameraRef.current = resetCamera(viewport);
    setCamera(cameraRef.current);
  }, [viewport]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({
      setCamera: (c: Camera) => apply(() => ({ x: c.x, y: c.y, zoom: c.zoom }), false),
      getCamera: () => cameraRef.current,
    });
  }, [apply]);

  const beginPan = useCallback((p: Point) => {
    panPointRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panPointRef.current;
      if (last === null) return;
      panPointRef.current = p;
      apply((c) => panBy(c, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panPointRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply((c) => zoomAt(c, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        // Content moves opposite to the scroll direction, like native scrolling.
        apply((c) => panBy(c, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomBy = useCallback(
    (point: Point, factor: number) => apply((c) => zoomAt(c, point, factor)),
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => apply((c) => stepCamera(c, viewportRef.current, dir)),
    [apply],
  );

  const reset = useCallback(
    () =>
      apply((c) => {
        const next = resetCamera(viewportRef.current);
        return next.x === c.x && next.y === c.y && next.zoom === c.zoom ? c : next;
      }),
    [apply],
  );

  return useMemo(
    () => ({ camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomBy, zoomStep, reset }),
    [camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomBy, zoomStep, reset],
  );
}
