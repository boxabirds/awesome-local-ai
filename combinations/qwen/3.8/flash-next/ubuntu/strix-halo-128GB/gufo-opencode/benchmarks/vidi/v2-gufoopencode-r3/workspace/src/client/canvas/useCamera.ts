import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Context
} from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size
} from './camera';

// Wheel deltaMode conversions to CSS pixels (W3C wheel event defaults).
const WHEEL_DELTA_MODE_LINE = 1;
const WHEEL_DELTA_MODE_PAGE = 2;
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 800;

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface UseCamera {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomAtPointer(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  setCamera(cam: Camera): void;
}

function wheelDeltaToPixels(delta: number, deltaMode: number | undefined): number {
  if (deltaMode === WHEEL_DELTA_MODE_LINE) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === WHEEL_DELTA_MODE_PAGE) return delta * WHEEL_PAGE_PIXELS;
  return delta;
}

export function useCamera(viewport: Size): UseCamera {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const cameraRef = useRef<Camera>(camera);
  const pendingRef = useRef<Camera>(camera);
  const hasNavigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastPointerRef = useRef<Point | null>(null);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  // Coalesce camera updates to at most one render per animation frame.
  const commit = useCallback((next: Camera) => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    pendingRef.current = next;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setCameraState(pendingRef.current);
        if (!hasNavigatedRef.current) {
          hasNavigatedRef.current = true;
          setHasNavigated(true);
        }
      });
    }
  }, []);

  const beginPan = useCallback((p: Point) => {
    lastPointerRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = lastPointerRef.current;
      if (last === null) return;
      lastPointerRef.current = p;
      commit(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [commit]
  );

  const endPan = useCallback(() => {
    lastPointerRef.current = null;
  }, []);

  const zoomAtPointer = useCallback(
    (point: Point, factor: number) => {
      commit(zoomAt(cameraRef.current, point, factor));
    },
    [commit]
  );

  const wheel = useCallback(
    (e: WheelInput) => {
      const deltaX = wheelDeltaToPixels(e.deltaX, e.deltaMode);
      const deltaY = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      if (e.ctrlOrMeta) {
        zoomAtPointer(e.point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY));
      } else {
        commit(panBy(cameraRef.current, -deltaX, -deltaY));
      }
    },
    [commit, zoomAtPointer]
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [commit]
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (cam: Camera) => {
      commit(cam);
    },
    [commit]
  );

  return {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPointer,
    zoomStep,
    reset,
    setCamera
  };
}

export const BoardCameraContext: Context<UseCamera | null> = createContext<UseCamera | null>(null);

export function useBoardCamera(): UseCamera {
  const board = useContext(BoardCameraContext);
  if (board === null) {
    throw new Error('useBoardCamera must be used within BoardCameraContext (provided by App)');
  }
  return board;
}
