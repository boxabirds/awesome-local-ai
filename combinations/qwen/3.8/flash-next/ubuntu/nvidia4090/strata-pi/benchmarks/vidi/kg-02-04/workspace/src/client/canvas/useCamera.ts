import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WHEEL_LINE_DELTA_PIXELS,
  WHEEL_PAGE_DELTA_PIXELS,
  WHEEL_ZOOM_SENSITIVITY,
} from "../../shared/config";
import {
  canZoomIn,
  canZoomOut,
  panBy,
  resetCamera,
  zoomAt,
  zoomPercent,
  zoomStep,
  type Camera,
  type Point,
  type Size,
} from "./camera";
import { isUsableCamera, useTestHooks, type TestHookSource } from "./testHooks";

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export interface CameraApi {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
  /** Zoom state derived from the camera (so controls never duplicate maths). */
  readonly zoomPercent: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  beginPan(point: Point): void;
  panMove(point: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  /** Zoom by an arbitrary factor around a screen point (trackpad pinch/gesture). */
  zoomAtPoint(point: Point, factor: number): void;
  zoomStep(direction: "in" | "out"): void;
  reset(): void;
}

export interface UseCameraOptions {
  /** Set false when another component already exposes the test hook. Default true. */
  testHooks?: boolean;
}

interface CameraState {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
}

/**
 * Camera state plus the navigation operations the board and the zoom controls
 * drive it with. Updates are coalesced to at most one render per animation
 * frame, and a mutation that would not change the camera (a click without
 * movement, zooming past a limit) is a no-op: no render, and the
 * `hasNavigated` latch is not tripped.
 */
export function useCamera(viewport: Size, options?: UseCameraOptions): CameraApi {
  const wantTestHooks = options?.testHooks ?? true;
  const [state, setState] = useState<CameraState>(() => ({
    camera: resetCamera(viewport),
    hasNavigated: false,
  }));

  const viewportRef = useRef<Size>(viewport);
  viewportRef.current = viewport;

  /** Latest camera, including updates not yet rendered. */
  const latestRef = useRef<Camera>(state.camera);
  const pendingRef = useRef<{ camera: Camera; latch: boolean } | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ start: Point; camera: Camera } | null>(null);

  const commitPending = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    setState((prev) =>
      prev.camera === pending.camera
        ? prev
        : { camera: pending.camera, hasNavigated: prev.hasNavigated || pending.latch },
    );
  }, []);

  const schedule = useCallback(
    (next: Camera, latch = true) => {
      if (next === latestRef.current) return;
      latestRef.current = next;
      pendingRef.current = { camera: next, latch };
      if (frameRef.current === null) {
        if (typeof requestAnimationFrame === "function") {
          frameRef.current = requestAnimationFrame(commitPending);
        } else {
          commitPending();
        }
      }
    },
    [commitPending],
  );

  const beginPan = useCallback((point: Point) => {
    dragRef.current = { start: point, camera: latestRef.current };
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Cumulative delta from the press point: the board follows the pointer
      // exactly, with no accumulated rounding.
      schedule(panBy(drag.camera, point.x - drag.start.x, point.y - drag.start.y));
    },
    [schedule],
  );

  const endPan = useCallback(() => {
    dragRef.current = null;
  }, []);

  const wheel = useCallback(
    (input: WheelInput) => {
      if (input.ctrlOrMeta) {
        schedule(
          zoomAt(latestRef.current, input.point, Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY)),
        );
        return;
      }
      schedule(panBy(latestRef.current, -input.deltaX, -input.deltaY));
    },
    [schedule],
  );

  const zoomAtPoint = useCallback(
    (point: Point, factor: number) => {
      schedule(zoomAt(latestRef.current, point, factor));
    },
    [schedule],
  );

  const zoomByStep = useCallback(
    (direction: "in" | "out") => {
      schedule(zoomStep(latestRef.current, viewportRef.current, direction));
    },
    [schedule],
  );

  const reset = useCallback(() => {
    const home = resetCamera(viewportRef.current);
    if (sameCamera(home, latestRef.current)) return;
    schedule(home);
  }, [schedule]);

  // ---- test-only camera hook ------------------------------------------
  const testSource = useMemo<TestHookSource | null>(
    () =>
      wantTestHooks
        ? {
            getCamera: () => latestRef.current,
            setCamera: (camera) => {
              if (!isUsableCamera(camera)) return;
              schedule({ x: camera.x, y: camera.y, zoom: camera.zoom }, false);
            },
          }
        : null,
    [wantTestHooks, schedule],
  );
  useTestHooks(testSource);

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  return {
    camera: state.camera,
    hasNavigated: state.hasNavigated,
    zoomPercent: zoomPercent(state.camera),
    canZoomIn: canZoomIn(state.camera),
    canZoomOut: canZoomOut(state.camera),
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomAtPoint,
    zoomStep: zoomByStep,
    reset,
  };
}

/**
 * Convert a wheel delta to CSS pixels: deltaMode 1 is DOM lines, 2 is pages.
 */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * WHEEL_LINE_DELTA_PIXELS;
  if (deltaMode === 2) return delta * WHEEL_PAGE_DELTA_PIXELS;
  return delta;
}

/**
 * Size of the board area. The board fills the window, so this is the window's
 * content size, observed with a ResizeObserver where available (jsdom has
 * none) and with the window `resize` event as a fallback.
 */
export function useWindowSize(): Size {
  const [size, setSize] = useState<Size>(() => measureWindowSize());

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      const next = measureWindowSize();
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };

    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(document.documentElement);
      observers.push(observer);
    }
    const onResize = () => {
      update();
      // A window resize also fires rAF-sized follow-ups on some browsers.
      if (frame === null && typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(() => {
          frame = null;
          update();
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      for (const observer of observers) observer.disconnect();
      if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, []);

  return size;
}

function measureWindowSize(): Size {
  const width =
    typeof window === "undefined" ? 0 : Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
  const height =
    typeof window === "undefined" ? 0 : Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
  return { width, height };
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a === b || (a.x === b.x && a.y === b.y && a.zoom === b.zoom);
}
