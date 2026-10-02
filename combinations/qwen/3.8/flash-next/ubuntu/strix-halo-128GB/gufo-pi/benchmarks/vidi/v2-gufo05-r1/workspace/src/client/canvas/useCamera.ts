/**
 * Camera state and navigation actions for the board, plus the viewport size.
 *
 * The hook owns no DOM: it takes the viewport size and exposes actions that the
 * input surface (`BoardViewport`) and the zoom controls call. Camera maths
 * lives in `camera.ts`, so every action here is a thin wrapper around a pure,
 * unit-tested function.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

/** A wheel / trackpad scroll normalised to pixels, in the hook's input shape. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** True when Ctrl (Windows/Linux) or Cmd (macOS) is held: this is a pinch. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the board area, in CSS pixels. */
  readonly point: Point;
}

export interface CameraNav {
  readonly camera: Camera;
  /** Latches true on the first user pan or zoom; never resets during the visit. */
  readonly hasNavigated: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Safari trackpad pinch: `scale` is the ratio since the previous event. */
  gestureZoom(point: Point, scale: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /** Replace the camera wholesale (test hook only; does not count as navigating). */
  setCamera(camera: Camera): void;
  /** True while a drag pan is in progress (drives the grabbing cursor). */
  readonly isPanning: boolean;
}

/** Who asked for the camera change: only user actions dismiss the hint. */
type ChangeOrigin = 'user' | 'system';

function isCamera(camera: Partial<Camera> | undefined): camera is Camera {
  return (
    !!camera &&
    Number.isFinite(camera.x) &&
    Number.isFinite(camera.y) &&
    Number.isFinite(camera.zoom) &&
    (camera.zoom as number) > 0
  );
}

/**
 * Read the viewport size. The board area fills the window, so the document
 * element is the thing to watch. `ResizeObserver` where available, window
 * `resize` events otherwise.
 */
export function useWindowSize(): Size {
  const read = (): Size => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });
  const [size, setSize] = useState<Size>(read);

  useEffect(() => {
    const apply = () => {
      const next = read();
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            apply();
          });
    observer?.observe(document.documentElement);
    window.addEventListener('resize', apply);
    apply();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return size;
}

export function useCamera(viewport: Size): CameraNav {
  const hasUsableViewport = viewport.width > 0 && viewport.height > 0;
  // The standard view is the first thing the user sees: 100% with the board's
  // starting point centred.
  const [camera, setCameraState] = useState<Camera>(() =>
    hasUsableViewport ? resetCamera(viewport) : { x: 0, y: 0, zoom: 1 },
  );
  const [hasNavigated, setHasNavigated] = useState(false);

  /** Latest camera, including updates waiting for the next frame. */
  const cameraRef = useRef<Camera>(camera);
  const hasNavigatedRef = useRef(false);
  const initialisedRef = useRef(hasUsableViewport);
  const panFromRef = useRef<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduled = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    frameRef.current = null;
    timerRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) setCameraState(next);
  }, []);

  const applyCamera = useCallback(
    (next: Camera, origin: ChangeOrigin) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (origin === 'user' && !hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      // Coalesce to at most one render per frame.
      pendingRef.current = next;
      if (frameRef.current !== null || timerRef.current !== null) return;
      if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
        frameRef.current = requestAnimationFrame(flush);
      } else {
        timerRef.current = setTimeout(flush, 16);
      }
    },
    [flush],
  );

  // Centre the board once the viewport size is known, as long as the user has
  // not navigated yet. A system change: it must not dismiss the hint.
  useEffect(() => {
    if (initialisedRef.current) return;
    if (!hasUsableViewport) return;
    initialisedRef.current = true;
    if (!hasNavigatedRef.current) applyCamera(resetCamera(viewport), 'system');
  }, [applyCamera, hasUsableViewport, viewport.height, viewport.width]);

  // Drop any frame scheduled just before unmount, applying what is pending.
  useEffect(
    () => () => {
      cancelScheduled();
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) setCameraState(next);
    },
    [cancelScheduled],
  );

  const beginPan = useCallback((point: Point) => {
    panFromRef.current = point;
    setIsPanning(true);
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const from = panFromRef.current;
      if (!from) return;
      panFromRef.current = point;
      applyCamera(panBy(cameraRef.current, point.x - from.x, point.y - from.y), 'user');
    },
    [applyCamera],
  );

  const endPan = useCallback(() => {
    // Whatever the camera was at the moment the drag ended stays put, whether
    // it ended in a pointerup, a pointercancel or lost pointer capture.
    panFromRef.current = null;
    setIsPanning(false);
  }, []);

  const wheel = useCallback(
    ({ deltaX, deltaY, ctrlOrMeta, point }: WheelInput) => {
      if (ctrlOrMeta) {
        // Trackpad pinch and Ctrl/Cmd + scroll: zoom around the pointer.
        applyCamera(
          zoomAt(cameraRef.current, point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)),
          'user',
        );
        return;
      }
      applyCamera(panBy(cameraRef.current, -deltaX, -deltaY), 'user');
    },
    [applyCamera],
  );

  const gestureZoom = useCallback(
    (point: Point, scale: number) => {
      applyCamera(zoomAt(cameraRef.current, point, scale), 'user');
    },
    [applyCamera],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      applyCamera(stepCamera(cameraRef.current, viewport, direction), 'user');
    },
    [applyCamera, viewport],
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewport), 'user');
  }, [applyCamera, viewport]);

  const setCamera = useCallback(
    (next: Camera) => {
      if (!isCamera(next)) return;
      initialisedRef.current = true;
      applyCamera(next, 'system');
    },
    [applyCamera],
  );

  return useMemo(
    () => ({
      camera,
      hasNavigated,
      isPanning,
      beginPan,
      panMove,
      endPan,
      wheel,
      gestureZoom,
      zoomStep,
      reset,
      setCamera,
    }),
    [
      camera,
      hasNavigated,
      isPanning,
      beginPan,
      panMove,
      endPan,
      wheel,
      gestureZoom,
      zoomStep,
      reset,
      setCamera,
    ],
  );
}
