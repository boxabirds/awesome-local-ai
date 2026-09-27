// React hook that owns the camera for one board viewport and turns input
// gestures into camera updates. All geometry lives in camera.ts.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FRAME_FALLBACK_MS, WHEEL_ZOOM_SENSITIVITY } from "../../shared/config";
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from "./camera";

/** Input for one wheel / trackpad-scroll event, already converted to CSS pixels. */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** True when Ctrl (or Cmd on macOS) is held: the gesture zooms instead of pans. */
  readonly ctrlOrMeta: boolean;
  /** Pointer position relative to the board area, in CSS pixels. */
  readonly point: Point;
}

export interface CameraApi {
  camera: Camera;
  /** Latches true the first time the camera actually changes (pan or zoom). */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  /** Zoom around an arbitrary screen point (trackpad pinch / Safari gesture). */
  zoomAtPoint(p: Point, factor: number): void;
  zoomStep(dir: "in" | "out"): void;
  reset(): void;
  /** Replace the camera outright. Used by the test-only window.__vidi6 hook. */
  setCamera(cam: Camera): void;
}

/**
 * Continuous input (pointer moves, wheel ticks, gesture ticks) is coalesced to at
 * most one render per animation frame; discrete actions (pointer up, button, key,
 * reset) flush so the state is committed as soon as the gesture ends.
 */
export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() =>
    resetCamera(viewport),
  );
  const [hasNavigated, setHasNavigated] = useState(false);

  // Mirrors the camera that will be committed, so several inputs inside one
  // frame compose instead of clobbering each other.
  const cameraRef = useRef<Camera>(camera);
  const pendingRef = useRef<Camera | null>(null);
  const frameCancelRef = useRef<(() => void) | null>(null);
  const navigatedRef = useRef(false);
  const initialisedRef = useRef(false);
  const panAnchorRef = useRef<Point | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const flush = useCallback((): void => {
    frameCancelRef.current?.();
    frameCancelRef.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next !== null) setCameraState(next);
  }, []);

  const schedule = useCallback((): void => {
    if (frameCancelRef.current !== null) return;
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(() => {
        frameCancelRef.current = null;
        flush();
      });
      frameCancelRef.current = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(() => {
        frameCancelRef.current = null;
        flush();
      }, FRAME_FALLBACK_MS);
      frameCancelRef.current = () => clearTimeout(id);
    }
  }, [flush]);

  useEffect(() => () => frameCancelRef.current?.(), []);

  /** Apply a camera produced by camera.ts. A no-op update is dropped entirely. */
  const apply = useCallback(
    (next: Camera, mode: "coalesce" | "flush" = "coalesce"): void => {
      if (next === cameraRef.current) return;
      cameraRef.current = next;
      pendingRef.current = next;
      if (mode === "flush") flush();
      else schedule();
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
    },
    [flush, schedule],
  );

  // First time the board area has a real size, show the standard view (board
  // start centred at 100%). After that the camera is only moved by the user, so
  // resizing never moves content relative to the top-left of the board area.
  useLayoutEffect(() => {
    if (initialisedRef.current) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;
    initialisedRef.current = true;
    const standard = resetCamera(viewport);
    if (standard !== cameraRef.current) {
      cameraRef.current = standard;
      setCameraState(standard);
    }
  }, [viewport.width, viewport.height]);

  const beginPan = useCallback((p: Point): void => {
    panAnchorRef.current = p;
  }, []);

  const panMove = useCallback(
    (p: Point): void => {
      const last = panAnchorRef.current;
      if (last === null) return;
      panAnchorRef.current = p;
      apply(panBy(cameraRef.current, p.x - last.x, p.y - last.y));
    },
    [apply],
  );

  const endPan = useCallback((): void => {
    panAnchorRef.current = null;
    flush();
  }, [flush]);

  const wheel = useCallback(
    (e: WheelInput): void => {
      if (e.ctrlOrMeta) {
        apply(
          zoomAt(
            cameraRef.current,
            e.point,
            Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY),
          ),
        );
        return;
      }
      apply(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
    },
    [apply],
  );

  const zoomAtPoint = useCallback(
    (p: Point, factor: number): void => {
      apply(zoomAt(cameraRef.current, p, factor));
    },
    [apply],
  );

  const zoomStep = useCallback(
    (dir: "in" | "out"): void => {
      apply(
        zoomStepCamera(cameraRef.current, viewportRef.current, dir),
        "flush",
      );
    },
    [apply],
  );

  const reset = useCallback((): void => {
    apply(resetCamera(viewportRef.current), "flush");
  }, [apply]);

  const setCamera = useCallback(
    (cam: Camera): void => {
      apply(cam, "flush");
    },
    [apply],
  );

  return useMemo(
    () => ({
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomAtPoint,
      zoomStep,
      reset,
      setCamera,
    }),
    [
      camera,
      hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomAtPoint,
      zoomStep,
      reset,
      setCamera,
    ],
  );
}
