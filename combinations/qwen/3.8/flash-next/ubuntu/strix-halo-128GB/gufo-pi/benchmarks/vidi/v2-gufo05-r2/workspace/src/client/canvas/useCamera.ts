import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  sameCamera,
  zoomAt,
  zoomStep as zoomCameraStep,
  type Camera,
  type Point,
  type Size,
} from './camera';

/** Wheel `deltaMode` values, as defined by the WheelEvent specification. */
const WHEEL_DELTA_MODE_PIXEL = 0;
const WHEEL_DELTA_MODE_LINE = 1;
const WHEEL_DELTA_MODE_PAGE = 2;

/** Pixels added per wheel "line" tick when the event reports lines. */
const WHEEL_LINE_PX = 16;
/** Pixels added per wheel "page" tick when the event reports pages. */
const WHEEL_PAGE_PX = 800;

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** Everything the board UI needs to read and change the view. */
export interface CameraController {
  readonly camera: Camera;
  /** Latches true on the first camera change of the visit (drives the hint). */
  readonly hasNavigated: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Safari trackpad pinch: `gesturestart`. */
  gestureStart(point: Point): void;
  /** Safari trackpad pinch: `gesturechange` with a cumulative `scale`. */
  gestureZoom(point: Point, scale: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /** Used only by the test hook `window.__vidi6.setCamera`. */
  setCamera(camera: Camera): void;
}

export const CameraContext = createContext<CameraController | null>(null);

export function useBoard(): CameraController {
  const board = useContext(CameraContext);
  if (!board) {
    throw new Error('useBoard must be used inside a CameraContext.Provider');
  }
  return board;
}

/** Size of the board area. The board fills the window, so this is the window. */
export function measureViewportSize(): Size {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  const doc = document.documentElement;
  return {
    width: doc?.clientWidth || window.innerWidth || 0,
    height: doc?.clientHeight || window.innerHeight || 0,
  };
}

export function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(measureViewportSize);

  useEffect(() => {
    const update = () => {
      const next = measureViewportSize();
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(document.documentElement);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return size;
}

/**
 * Camera state plus the navigation operations used by the board UI. Camera
 * updates are coalesced to at most one render per animation frame; the ref
 * always holds the latest camera so consecutive input events accumulate
 * without waiting for a render.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef<Camera>(camera);
  const viewportRef = useRef<Size>(viewport);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const frameRef = useRef(0);
  const panAnchorRef = useRef<Point | null>(null);
  const gestureRef = useRef<{ camera: Camera } | null>(null);

  viewportRef.current = viewport;

  useEffect(
    () => () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    },
    [],
  );

  const commit = useCallback((next: Camera) => {
    // camera.math returns the same object for no-ops (and resetCamera can
    // rebuild an identical view), so a change that moves nothing keeps the
    // hint visible and lets React skip the render.
    if (sameCamera(next, cameraRef.current)) return;
    cameraRef.current = next;
    if (!hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current === 0) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        setCameraState(cameraRef.current);
      });
    }
  }, []);

  const beginPan = useCallback((point: Point) => {
    panAnchorRef.current = point;
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const anchor = panAnchorRef.current;
      if (!anchor) return;
      panAnchorRef.current = point;
      commit(panBy(cameraRef.current, point.x - anchor.x, point.y - anchor.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panAnchorRef.current = null;
  }, []);

  const wheel = useCallback(
    (input: WheelInput) => {
      const deltaX = wheelDeltaToPixels(input.deltaX, input.deltaMode);
      const deltaY = wheelDeltaToPixels(input.deltaY, input.deltaMode);
      if (input.ctrlOrMeta) {
        // Trackpad pinch and Ctrl/Cmd + wheel arrive as a zoom gesture.
        commit(
          zoomAt(
            cameraRef.current,
            input.point,
            Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY),
          ),
        );
        return;
      }
      // Plain scroll moves the board with the scroll, so content moves opposite.
      commit(panBy(cameraRef.current, -deltaX, -deltaY));
    },
    [commit],
  );

  const gestureStart = useCallback((point: Point) => {
    void point;
    gestureRef.current = { camera: cameraRef.current };
  }, []);

  const gestureZoom = useCallback(
    (point: Point, scale: number) => {
      const base = gestureRef.current?.camera ?? cameraRef.current;
      commit(zoomAt(base, point, scale));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out') => {
      commit(zoomCameraStep(cameraRef.current, viewportRef.current, direction));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (next: Camera) => {
      if (
        !Number.isFinite(next.x) ||
        !Number.isFinite(next.y) ||
        !Number.isFinite(next.zoom)
      ) {
        return;
      }
      commit(next);
    },
    [commit],
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureStart,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  };
}

function wheelDeltaToPixels(delta: number, deltaMode = WHEEL_DELTA_MODE_PIXEL): number {
  if (delta === 0) return 0;
  switch (deltaMode) {
    case WHEEL_DELTA_MODE_LINE:
      return delta * WHEEL_LINE_PX;
    case WHEEL_DELTA_MODE_PAGE:
      return delta * WHEEL_PAGE_PX;
    default:
      return delta;
  }
}
