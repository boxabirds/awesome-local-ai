/**
 * React glue around the pure camera maths: camera state, the input handlers the
 * viewport calls, and a "has the user navigated yet" latch for the first-use
 * hint. Nothing here is persisted: reloading the page starts a new visit.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
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

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** The camera contract: state plus one handler per input the board owns. */
export interface CameraControls {
  camera: Camera;
  /** Size of the board area the camera is measured against, in CSS pixels. */
  viewport: Size;
  /** Latches to true on the first camera change that produces a new camera. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom by a raw scale ratio around a screen point (Safari pinch gestures). */
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

/**
 * Extra, non-contract plumbing: a raw camera setter used only by the test-only
 * `window.__vidi6` hook (see testHooks.ts) so e2e can travel a million units
 * without dragging a million pixels.
 */
export interface CameraTestControls {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

export type CameraController = CameraControls & CameraTestControls;

/**
 * Coalesce camera updates to at most one render per animation frame. The global
 * is looked up on every call, so environments without rAF (and fake timers)
 * behave as expected.
 */
function scheduleFrame(fn: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(fn, 0) as unknown as number;
}

function unscheduleFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

export function useCamera(viewport: Size): CameraController {
  const viewportRef = useRef<Size>(viewport);
  // A resize is not user input: only the size is remembered, the camera is left
  // alone, so content keeps its position relative to the top-left corner.
  viewportRef.current = viewport;

  const [camera, setCameraRendered] = useState<Camera>(() => resetCamera(viewport));
  const cameraRef = useRef<Camera>(camera);
  const [hasNavigated, setHasNavigated] = useState(false);
  const hasNavigatedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const panOriginRef = useRef<Point | null>(null);
  const centeredRef = useRef(viewport.width > 0 && viewport.height > 0);

  const flush = useCallback(() => {
    frameRef.current = null;
    setCameraRendered(cameraRef.current);
  }, []);

  const applyCamera = useCallback(
    (next: Camera, countsAsNavigation = true) => {
      // The camera maths returns the *same object* when nothing would change, so
      // a click without movement or a zoom already at a limit re-renders nothing
      // and does not dismiss the navigation hint.
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      if (countsAsNavigation && !hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      if (frameRef.current === null) frameRef.current = scheduleFrame(flush);
    },
    [flush]
  );

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) unscheduleFrame(frameRef.current);
      frameRef.current = null;
    };
  }, []);

  // The first time the board area is measured, show the standard view (start
  // point centred at 100%) without counting it as the user navigating.
  useEffect(() => {
    if (centeredRef.current) return;
    const size = viewportRef.current;
    if (size.width <= 0 || size.height <= 0) return;
    centeredRef.current = true;
    applyCamera(resetCamera(size), false);
  }, [viewport.width, viewport.height, applyCamera]);

  const beginPan = useCallback((p: Point) => {
    panOriginRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point) => {
      const last = panOriginRef.current;
      if (!last) return;
      panOriginRef.current = p;
      applyCamera(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [applyCamera]
  );

  const endPan = useCallback(() => {
    panOriginRef.current = null;
  }, []);

  const wheel = useCallback(
    (e: WheelInput) => {
      if (e.ctrlOrMeta) {
        applyCamera(zoomAt(cameraRef.current, e.point, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else {
        applyCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    },
    [applyCamera]
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      applyCamera(zoomAt(cameraRef.current, point, factor));
    },
    [applyCamera]
  );

  const zoomStep = useCallback(
    (dir: 'in' | 'out') => {
      applyCamera(zoomStepCamera(cameraRef.current, viewportRef.current, dir));
    },
    [applyCamera]
  );

  const reset = useCallback(() => {
    applyCamera(resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCamera = useCallback(
    (next: Camera) => {
      // A camera jump is test scaffolding, not the user navigating, so it leaves
      // the first-use hint alone.
      applyCamera(next, false);
    },
    [applyCamera]
  );

  const getCamera = useCallback(() => cameraRef.current, []);

  return useMemo(
    () => ({
      camera,
      viewport,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomAtPoint,
      zoomStep,
      reset,
      setCamera,
      getCamera
    }),
    [
      camera,
      viewport,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomAtPoint,
      zoomStep,
      reset,
      setCamera,
      getCamera
    ]
  );
}

const CameraContext = createContext<CameraController | null>(null);

export function useCameraContext(): CameraController {
  const value = useContext(CameraContext);
  if (!value) throw new Error('useCameraContext must be used inside <CameraProvider>');
  return value;
}

/**
 * Owns the camera for the board area it renders, so the viewport, the zoom
 * controls and the hint — all wired together in App — share one camera. The
 * board area fills the window, and a ResizeObserver reports its size; resizing
 * never moves the camera.
 */
export function CameraProvider(props: { children?: ReactNode }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const controller = useCamera(size);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // createElement rather than JSX, so this stays a .ts file as named in the design.
  return createElement(
    'div',
    { className: 'board-area', ref: containerRef, 'data-vidi6': 'board-area' },
    createElement(CameraContext.Provider, { value: controller }, props.children)
  );
}
