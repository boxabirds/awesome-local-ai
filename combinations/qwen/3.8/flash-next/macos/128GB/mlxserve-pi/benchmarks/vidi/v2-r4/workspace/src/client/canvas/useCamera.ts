import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as stepCamera,
  type Camera,
  type Point,
  type Size,
  type ZoomDirection,
} from './camera';

/**
 * A wheel / trackpad gesture in board terms. `deltaX`/`deltaY` are already
 * converted to screen pixels, `ctrlOrMeta` marks a pinch or a held modifier and
 * `point` is the pointer position relative to the top-left of the board area.
 */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** Everything the board viewport needs to drive the camera. */
export interface CameraControls {
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: ZoomDirection): void;
  reset(): void;
}

export interface UseCameraResult extends CameraControls {
  /** The rendered camera. Drives the world layer and dot grid transforms. */
  camera: Camera;
  /** Latches true on the first camera change of the visit (see NavigationHint). */
  hasNavigated: boolean;
  /** Read the newest camera, including updates waiting for the next frame. */
  getCamera(): Camera;
  /** Replace the camera outright. Used by the test hook (testHooks.ts). */
  setCamera(cam: Camera): void;
}

/**
 * Camera state plus the gestures that drive it.
 *
 * The camera lives only here: nothing is persisted, so a reload starts again at
 * the standard view. Updates are coalesced with requestAnimationFrame so a
 * burst of pointermove or wheel events causes at most one render per frame.
 *
 * `viewport` is only read when an action needs the centre of the board area
 * (zoom step, reset); a resize therefore never moves the camera (TC-07).
 */
export function useCamera(viewport: Size): UseCameraResult {
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  // cameraRef: newest camera (possibly not rendered yet). renderedRef: the one
  // currently in state. Both start as the initial camera object.
  const cameraRef = useRef<Camera>(camera);
  const renderedRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  const panFromRef = useRef<Point | null>(null);
  const navigatedRef = useRef(false);

  const flush = useCallback(() => {
    frameRef.current = null;
    const next = cameraRef.current;
    if (next === renderedRef.current) return;
    renderedRef.current = next;
    setCameraState(next);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /** Adopt a camera returned by camera.math; a no-op update changes nothing. */
  const apply = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
      schedule();
    },
    [schedule],
  );

  const beginPan = useCallback((p: Point) => {
    panFromRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panFromRef.current;
      if (last === null) return; // ignored once the drag has ended (TC-14)
      panFromRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panFromRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        // Pinch (or Ctrl/Cmd + wheel): zoom around the pointer.
        apply(
          zoomAt(
            cameraRef.current,
            e.point,
            Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
          ),
        );
        return;
      }
      // Plain scroll: the board moves with the scroll, so content moves against it.
      apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: ZoomDirection) => {
      apply(stepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(resetCamera(viewportRef.current));
  }, [apply]);

  const getCamera = useCallback(() => cameraRef.current, []);

  const setCamera = useCallback(
    (cam: Camera) => {
      if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.zoom)) return;
      apply({ x: cam.x, y: cam.y, zoom: cam.zoom });
    },
    [apply],
  );

  return useMemo(
    () => ({
      camera,
      hasNavigated,
      getCamera,
      setCamera,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomStep,
      reset,
    }),
    [
      camera,
      hasNavigated,
      getCamera,
      setCamera,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomStep,
      reset,
    ],
  );
}

/**
 * Size of an element, tracked with a ResizeObserver. Falls back to the window
 * size before the first measurement (and in environments without
 * ResizeObserver, such as jsdom).
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setSize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
