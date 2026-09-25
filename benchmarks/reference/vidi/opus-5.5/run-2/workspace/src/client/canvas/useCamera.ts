/**
 * React hook holding the board camera and the input operations on it
 * (anchor: viewport.input). All geometry is delegated to camera.ts.
 *
 * Camera updates are coalesced with requestAnimationFrame: every operation composes
 * onto the latest (possibly not yet rendered) camera, and at most one React render
 * happens per frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as stepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { installTestHooks } from './testHooks';

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
  /** Multiplies the zoom by `factor` around a screen point (pinch gestures). */
  zoomBy(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const [isPanning, setIsPanning] = useState(false);
  const latest = useRef<Camera>(camera);
  const navigated = useRef(false);
  const frame = useRef<number | null>(null);
  const panLast = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setCamera(latest.current);
    });
  }, []);

  /** Applies a camera produced by camera.ts; a same-object result is a no-op. */
  const apply = useCallback(
    (next: Camera) => {
      if (next === latest.current) return;
      latest.current = next;
      navigated.current = true;
      schedule();
    },
    [schedule],
  );

  const beginPan = useCallback((p: Point) => {
    panLast.current = p;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panLast.current;
      if (last === null) return;
      panLast.current = p;
      apply(panBy(latest.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panLast.current = null;
    setIsPanning(false);
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        apply(zoomAt(latest.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        // Content moves opposite to the scroll delta, like native scrolling.
        apply(panBy(latest.current, -e.deltaX, -e.deltaY));
      }
    },
    [apply],
  );

  const zoomBy = useCallback(
    (point: Point, factor: number) => apply(zoomAt(latest.current, point, factor)),
    [apply],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => apply(stepCamera(latest.current, viewportRef.current, dir)),
    [apply],
  );

  const reset = useCallback(() => {
    const next = resetCamera(viewportRef.current);
    if (sameCamera(next, latest.current)) return;
    apply(next);
  }, [apply]);

  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return undefined;
    return installTestHooks({
      getCamera: () => latest.current,
      setCamera: (c: Camera) => {
        latest.current = c;
        schedule();
      },
    });
  }, [schedule]);

  return {
    camera,
    hasNavigated: navigated.current,
    isPanning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomBy,
    zoomStep,
    reset,
  };
}
