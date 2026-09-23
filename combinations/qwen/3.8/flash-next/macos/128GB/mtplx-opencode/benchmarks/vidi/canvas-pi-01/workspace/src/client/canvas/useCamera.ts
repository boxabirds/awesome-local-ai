/**
 * Story 1 · task 3 — the `useCamera` hook (design "Viewport input and
 * rendering").
 *
 * Owns the camera state and the navigation actions. It is deliberately free
 * of DOM knowledge: `BoardViewport` translates raw input events into these
 * calls. Camera updates are coalesced to at most one render per animation
 * frame, and an update that produces an identical camera (a click without
 * movement, a zoom at a limit) neither re-renders nor dismisses the hint.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepAt,
  type Camera,
  type Point,
  type Size,
} from './camera';

export interface WheelInput {
  /** Scroll delta in CSS pixels (deltaMode already converted). */
  deltaX: number;
  deltaY: number;
  /** True when Ctrl or Cmd is held: the gesture zooms instead of panning. */
  ctrlOrMeta: boolean;
  /** Pointer position relative to the board area. */
  point: Point;
}

export interface PinchInput {
  /** Pointer position relative to the board area. */
  point: Point;
  /** Scale ratio since the gesture started (Safari `gesturechange`). */
  factor: number;
}

export interface CameraApi {
  camera: Camera;
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  pinch(e: PinchInput): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /**
   * Jump to a camera. Only reachable through `window.__vidi6` in a test
   * build (see `testHooks.ts`); used by the e2e suite to travel to
   * UNBOUNDED_PAN_TESTED_EXTENT without a million pixels of dragging.
   */
  setCamera(cam: Camera): void;
}

/**
 * The standard view: the board's starting point (world origin) in the middle
 * of the board area at 100%. This is both the first view and what Reset view
 * returns to, so pressing Reset on a freshly loaded page changes nothing.
 */
const initialCamera = (viewport: Size): Camera => resetCamera(viewport);

function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 0) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCamera] = useState<Camera>(() => initialCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);

  // The ref is the source of truth so that several inputs inside one frame
  // compose correctly; React state is only the render mirror of it.
  const cameraRef = useRef<Camera>(initialCamera(viewport));
  const pendingRef = useRef<Camera | null>(null);
  const frameRef = useRef(0);
  const panRef = useRef<{ cam: Camera; x: number; y: number } | null>(null);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  useEffect(
    () => () => {
      if (frameRef.current) cancelFrame(frameRef.current);
      frameRef.current = 0;
    },
    [],
  );

  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    pendingRef.current = next;
    if (frameRef.current) return; // one render per frame: the latest wins
    frameRef.current = scheduleFrame(() => {
      frameRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      setCamera(pending);
      setHasNavigated(true);
    });
  }, []);

  const beginPan = useCallback((p: Point) => {
    // Panning is measured from the camera captured at pointerdown, so the
    // board follows the pointer exactly no matter how many moves arrive.
    panRef.current = { cam: cameraRef.current, x: p.x, y: p.y };
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const pan = panRef.current;
      if (!pan) return;
      commit(panBy(pan.cam, p.x - pan.x, p.y - pan.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    // Interruptions (pointerup, pointercancel, lostpointercapture) keep the
    // camera exactly where the last move left it.
    panRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        commit(
          zoomAt(
            cameraRef.current,
            e.point,
            Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
          ),
        );
        return;
      }
      commit(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [commit],
  );

  const pinch = useCallback(
    (e: PinchInput) => {
      commit(zoomAt(cameraRef.current, e.point, e.factor));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      commit(zoomStepAt(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCameraDirect = useCallback(
    (cam: Camera) => {
      commit(cam);
    },
    [commit],
  );

  return useMemo(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      pinch,
      zoomStep,
      reset,
      setCamera: setCameraDirect,
    }),
    [
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      pinch,
      zoomStep,
      reset,
      setCameraDirect,
    ],
  );
}

/** Where the camera API is shared between the viewport and the overlays. */
export const CameraApiContext = createContext<CameraApi | null>(null);

export function useCameraApi(): CameraApi {
  const api = useContext(CameraApiContext);
  if (!api) {
    throw new Error('useCameraApi must be used inside a CameraApiContext.Provider');
  }
  return api;
}

/**
 * Track the size of the board area. A resize does not move content relative
 * to the top-left corner: only the viewport size changes (TC-07).
 */
export function useViewportSize(
  ref: RefObject<HTMLElement | null>,
): Size {
  const read = (): Size => {
    const el = ref.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      return { width: el.clientWidth, height: el.clientHeight };
    }
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1280, height: 800 };
  };

  const [size, setSize] = useState<Size>(read);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const next = read();
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return size;
}