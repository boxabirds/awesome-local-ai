import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  panBy as cameraPanBy,
  resetCamera as cameraResetCamera,
  zoomAt as cameraZoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { installTestHooks, uninstallTestHooks } from './testHooks';

/** A wheel / trackpad scroll, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** A Safari trackpad gesture (`gesturechange`). */
export interface GestureInput {
  readonly scale: number;
  readonly point: Point;
}

export interface CameraHandlers {
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  beginGesture(): void;
  gesture(input: GestureInput): void;
  endGesture(): void;
  wheel(input: WheelInput): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

export interface UseCameraResult extends CameraHandlers {
  camera: Camera;
  /** Latches true on the first camera change of the visit; never resets until reload. */
  hasNavigated: boolean;
}

const sameCamera = (a: Camera, b: Camera): boolean =>
  a === b || (a.x === b.x && a.y === b.y && a.zoom === b.zoom);

const isUsableCamera = (c: Camera): boolean =>
  Number.isFinite(c.x) &&
  Number.isFinite(c.y) &&
  Number.isFinite(c.zoom) &&
  c.zoom > 0;

/**
 * Camera state plus every navigation handler.
 *
 * Updates are pure calls into `camera.ts`, coalesced with `requestAnimationFrame` to at
 * most one render per frame. A camera change that produces an identical camera is a no-op:
 * it does not re-render and does not count as navigation (so the first-use hint survives a
 * click without movement, and a zoom at a limit).
 */
export function useCamera(viewport: Size): UseCameraResult {
  const [camera, setCameraState] = useState<Camera>(() => cameraResetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  // `pendingRef` is the source of truth between renders, so consecutive events within one
  // frame compose correctly instead of each starting from the last rendered camera.
  const pendingRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const panRef = useRef<Point | null>(null);
  const gestureScaleRef = useRef(1);

  const viewportRef = useRef(viewport);
  if (viewportRef.current !== viewport) viewportRef.current = viewport;

  const flushFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const apply = useCallback(
    (update: (cam: Camera) => Camera) => {
      const current = pendingRef.current;
      const next = update(current);
      if (!isUsableCamera(next) || sameCamera(current, next)) return;

      pendingRef.current = next;
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          setCameraState(pendingRef.current);
        });
      }
    },
    [],
  );

  useEffect(() => flushFrame, [flushFrame]);

  const beginPan = useCallback(
    (point: Point) => {
      panRef.current = { x: point.x, y: point.y };
    },
    [],
  );

  const panMove = useCallback(
    (point: Point) => {
      const last = panRef.current;
      if (!last) return;
      panRef.current = { x: point.x, y: point.y };
      apply((cam) => cameraPanBy(cam, point.x - last.x, point.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback(() => {
    panRef.current = null;
  }, []);

  const beginGesture = useCallback(() => {
    gestureScaleRef.current = 1;
  }, []);

  const gesture = useCallback(
    (input: GestureInput) => {
      const scale = input.scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = scale;
      apply((cam) => cameraZoomAt(cam, input.point, scale / previous));
    },
    [apply],
  );

  const endGesture = useCallback(() => {
    gestureScaleRef.current = 1;
  }, []);

  const wheel = useCallback(
    (input: WheelInput) => {
      if (input.ctrlOrMeta) {
        // Trackpad pinch arrives as a Ctrl-wheel; pinch out is a negative deltaY.
        const factor = Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY);
        apply((cam) => cameraZoomAt(cam, input.point, factor));
        return;
      }
      // Plain scroll moves the board in the scroll direction: content follows the gesture.
      apply((cam) => cameraPanBy(cam, -input.deltaX, -input.deltaY));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      apply((cam) => cameraZoomStep(cam, viewportRef.current, direction));
    },
    [apply],
  );

  const reset = useCallback(() => {
    apply(() => cameraResetCamera(viewportRef.current));
  }, [apply]);

  // Test-only hooks (removed from production builds).
  useEffect(() => {
    installTestHooks({
      getCamera: () => pendingRef.current,
      setCamera: (next) => {
        if (!isUsableCamera(next)) return;
        flushFrame();
        pendingRef.current = next;
        if (!hasNavigatedRef.current) {
          hasNavigatedRef.current = true;
          setHasNavigated(true);
        }
        setCameraState(next);
      },
    });
    return uninstallTestHooks;
  }, [flushFrame]);

  const handlers = useMemo<CameraHandlers>(
    () => ({ beginPan, panMove, endPan, beginGesture, gesture, endGesture, wheel, zoomStep, reset }),
    [beginPan, panMove, endPan, beginGesture, gesture, endGesture, wheel, zoomStep, reset],
  );

  return { ...handlers, camera, hasNavigated };
}

/**
 * The board fills the window, so the viewport size is the document's size, observed with a
 * ResizeObserver (falling back to the window `resize` event where it is unavailable).
 * Resizing never touches the camera, so content stays anchored to the top-left corner.
 */
export function useViewportSize(): Size {
  const measure = (): Size => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });

  const [size, setSize] = useState<Size>(measure);

  useEffect(() => {
    const onResize = () =>
      setSize((previous) => {
        const next = measure();
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    if (observer) observer.observe(document.documentElement);
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return size;
}
