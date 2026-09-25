import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  WHEEL_DELTA_MODE_LINE_PX,
  WHEEL_DELTA_MODE_PAGE_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';

/**
 * One navigation input expressed in board terms. `deltaX/deltaY` are wheel
 * deltas already converted to CSS pixels; `ctrlOrMeta` marks a pinch / zoom
 * gesture; `point` is the pointer position relative to the board area; `scale`
 * carries a Safari gesture scale ratio and, when present, is used as the zoom
 * factor instead of the wheel delta.
 */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  ctrlOrMeta: boolean;
  point: Point;
  scale?: number;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latches true on the first camera change that produced a new camera. */
  readonly hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test-only entry point (see testHooks.ts). */
  setCamera(c: Camera): void;
}

/**
 * Camera state plus the navigation operations that change it.
 *
 * The camera lives only in React state; nothing is persisted, so a reload
 * starts from the standard view (PRD "Explicit non-behaviours"). Updates are
 * coalesced to at most one render per animation frame, and a change that
 * produces an identical camera (limit reached, zero delta, invalid factor) is
 * dropped so it cannot dismiss the navigation hint.
 */
export function useCamera(viewport: Size): CameraApi {
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const initialRef = useRef<Camera | null>(null);
  if (initialRef.current === null) {
    initialRef.current = resetCamera(viewport);
  }

  const [camera, setCameraState] = useState<Camera>(initialRef.current);
  const cameraRef = useRef<Camera>(initialRef.current);
  const navigatedRef = useRef<boolean>(false);
  const frameRef = useRef<number | null>(null);
  const panningRef = useRef<boolean>(false);
  const lastPointerRef = useRef<Point>({ x: 0, y: 0 });

  const scheduleRef = useRef<(cb: () => void) => number>((cb) => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    return setTimeout(cb, 16) as unknown as number;
  });
  const cancelRef = useRef<(id: number) => void>((id) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
  });
  const schedule = scheduleRef.current;
  const cancel = cancelRef.current;

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancel(frameRef.current);
      frameRef.current = null;
    };
  }, [cancel]);

  /** Publish a camera change, at most once per frame. */
  const commit = useCallback(
    (next: Camera) => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      navigatedRef.current = true;
      if (frameRef.current !== null) return; // already scheduled; it reads the ref
      frameRef.current = schedule(() => {
        frameRef.current = null;
        setCameraState(cameraRef.current);
      });
    },
    [schedule],
  );

  const beginPan = useCallback((p: Point) => {
    panningRef.current = true;
    lastPointerRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      if (!panningRef.current) return;
      const last = lastPointerRef.current;
      lastPointerRef.current = p;
      commit(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [commit],
  );

  const endPan = useCallback(() => {
    panningRef.current = false;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      const cam = cameraRef.current;
      if (e.ctrlOrMeta) {
        const factor = e.scale ?? Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        commit(zoomAt(cam, e.point, factor));
        return;
      }
      // Plain scroll: content moves opposite to the scroll direction, matching
      // native scrolling (scroll down -> content moves up).
      commit(panBy(cam, -e.deltaX, -e.deltaY));
    },
    [commit],
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      commit(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [commit],
  );

  const reset = useCallback(() => {
    commit(resetCamera(viewportRef.current));
  }, [commit]);

  const setCamera = useCallback(
    (c: Camera) => {
      commit(c);
    },
    [commit],
  );

  return useMemo<CameraApi>(
    () => ({
      camera,
      hasNavigated: navigatedRef.current,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomStep,
      reset,
      setCamera,
    }),
    [camera, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera],
  );
}

/** Convert a wheel delta to CSS pixels using the named deltaMode constants. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (deltaMode === 1) return delta * WHEEL_DELTA_MODE_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_DELTA_MODE_PAGE_PX;
  return delta;
}

/**
 * Track the size of the board area. The camera is anchored to the top-left
 * corner, so a resize never moves content relative to that corner (TC-07).
 */
export function useViewportSize(ref: React.RefObject<HTMLElement | null>): Size {
  const fallback: Size =
    typeof window === 'undefined'
      ? { width: 1280, height: 800 }
      : { width: window.innerWidth, height: window.innerHeight };
  const [size, setSize] = useState<Size>(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (next: Size) => {
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : fallback.width;
      const height = rect.height > 0 ? rect.height : fallback.height;
      apply({ width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      apply({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  return size;
}

export const CameraContext = createContext<CameraApi | null>(null);

export function useCameraApi(): CameraApi {
  const api = useContext(CameraContext);
  if (!api) {
    throw new Error('CameraContext is missing; render BoardViewport inside App');
  }
  return api;
}
