import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  INITIAL_CAMERA,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { registerTestHooks } from './testHooks';

/** One wheel/trackpad input over the board, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  /** Latched true by the first camera change that produced a new camera object. */
  readonly hasNavigated: boolean;
  /** True while a pointer drag is panning the board (state `Panning`). */
  readonly panning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by `factor` keeping the board point under `point` fixed (pinch/`gesturechange`). */
  zoomAround(point: Point, factor: number): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
  /** Programmatic camera move; only reachable through the test-mode hook. */
  setCamera(camera: Camera): void;
}

/**
 * Camera state plus the input operations the board exposes. All maths lives in
 * `camera.ts`; updates are coalesced to at most one render per animation frame.
 */
const isKnown = (size: Size): boolean => size.width > 0 && size.height > 0;

export function useCamera(viewport: Size): CameraApi {
  // The board opens centred on its starting point, so the first paint is already the
  // reset view; `centredRef` records whether that has happened yet.
  const centredRef = useRef(isKnown(viewport));
  const [camera, setCameraState] = useState<Camera>(() =>
    isKnown(viewport) ? resetCamera(viewport) : INITIAL_CAMERA,
  );
  const [hasNavigated, setHasNavigated] = useState(false);
  const [panning, setPanning] = useState(false);

  const cameraRef = useRef<Camera>(camera);
  const frameRef = useRef<number | null>(null);
  const navigatedRef = useRef(false);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  const applyCamera = useCallback((next: Camera, user = true): void => {
    if (next === cameraRef.current) return;
    cameraRef.current = next;
    if (user && !navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setCameraState(cameraRef.current);
    });
  }, []);

  // Fallback for a viewport that was not measured at mount: centre once it is.
  // Centring is not user navigation, so it must not dismiss the first-use hint.
  useEffect(() => {
    if (centredRef.current || !isKnown(viewport)) return;
    centredRef.current = true;
    applyCamera(resetCamera(viewport), false);
  }, [viewport, applyCamera]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const beginPan = useCallback((p: Point): void => {
    panRef.current = { x: p.x, y: p.y };
    setPanning(true);
  }, []);

  const panMove = useCallback(
    (p: Point): void => {
      const last = panRef.current;
      if (!last) return;
      applyCamera(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
      panRef.current = { x: p.x, y: p.y };
    },
    [applyCamera],
  );

  const endPan = useCallback((): void => {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
  }, []);

  const zoomAround = useCallback(
    (point: Point, factor: number): void => {
      applyCamera(zoomAt(cameraRef.current, point, factor));
    },
    [applyCamera],
  );

  const wheel = useCallback(
    (e: WheelInput): void => {
      if (e.ctrlOrMeta) {
        zoomAround(e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY));
        return;
      }
      applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [applyCamera, zoomAround],
  );

  const zoomStep = useCallback(
    (direction: 'in' | 'out'): void => {
      applyCamera(cameraZoomStep(cameraRef.current, viewportRef.current, direction));
    },
    [applyCamera],
  );

  const reset = useCallback((): void => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCamera = useCallback(
    (next: Camera): void => {
      applyCamera(next, false);
    },
    [applyCamera],
  );

  // Test-only hook (jump far away without dragging a million pixels).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    registerTestHooks({ setCamera });
  }, [setCamera]);

  return {
    camera,
    hasNavigated,
    panning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAround,
    zoomStep,
    reset,
    setCamera,
  };
}

const SAME_SIZE = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

/**
 * `App` owns `useCamera` (so the zoom controls can be wired to it) and provides the
 * API to `BoardViewport`, whose own props stay `{ children }` per the design.
 */
export const CameraApiContext = createContext<CameraApi | null>(null);

export function useCameraApi(): CameraApi {
  const api = useContext(CameraApiContext);
  if (!api) {
    throw new Error('BoardViewport must be rendered inside a CameraApiContext.Provider');
  }
  return api;
}

function readDocumentSize(): Size {
  const doc = document.documentElement;
  const width = window.innerWidth || doc?.clientWidth || 0;
  const height = window.innerHeight || doc?.clientHeight || 0;
  return { width, height };
}

/**
 * The board fills the window, so the board area's size follows the document.
 * `camera.ts` never reacts to a resize (x, y and zoom are untouched), which is what
 * keeps content in place relative to the top-left corner of the board area.
 */
export function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(readDocumentSize);

  useEffect(() => {
    const update = (): void => {
      const next = readDocumentSize();
      setSize((prev) => (SAME_SIZE(prev, next) ? prev : next));
    };
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
      observer = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          const next = { width: rect.width, height: rect.height };
          setSize((prev) => (SAME_SIZE(prev, next) ? prev : next));
          return;
        }
        update();
      });
      observer.observe(document.documentElement);
    }
    window.addEventListener('resize', update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return size;
}
