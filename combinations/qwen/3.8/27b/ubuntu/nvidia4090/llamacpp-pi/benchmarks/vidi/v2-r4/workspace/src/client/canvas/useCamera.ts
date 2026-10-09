/**
 * React camera state + input handlers for the board.
 *
 * The camera lives only in React state (nothing is persisted in story 1).
 * Camera updates are coalesced with requestAnimationFrame to at most one
 * render per frame. The `hasNavigated` latch flips the first time camera
 * maths returns a *new* object; no-op updates (same object) never trip it, so
 * a click without movement does not dismiss the first-use hint.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { WHEEL_ZOOM_SENSITIVITY } from "../../shared/config";
import {
  type Camera,
  type Point,
  type Size,
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
} from "./camera";

/** Fallback frame interval (ms) when requestAnimationFrame is unavailable. */
const FRAME_FALLBACK_MS = 16;

export interface CameraApi {
  /** Current camera. */
  readonly camera: Camera;
  /** True once any camera change has happened during this visit. */
  readonly hasNavigated: boolean;
  /** True while a pointer drag is in progress. */
  readonly panning: boolean;
  /** Begin a pointer drag at a screen point. */
  beginPan(point: Point): void;
  /** Continue a drag to a new screen point. */
  panMove(point: Point): void;
  /** End a drag (pointerup / pointercancel / lost capture). */
  endPan(): void;
  /** Handle a wheel event (plain scroll or Ctrl/Cmd scroll / pinch). */
  wheel(event: {
    deltaX: number;
    deltaY: number;
    ctrlOrMeta: boolean;
    point: Point;
  }): void;
  /** One zoom step in or out around the viewport centre. */
  zoomStep(direction: "in" | "out"): void;
  /** One Safari pinch step: zoom by a scale ratio around a screen point. */
  gestureZoom(point: Point, scaleRatio: number): void;
  /** Return to 100% zoom centred on the board's starting point. */
  reset(): void;
  /** Direct camera assignment (test hook only). */
  setCamera(camera: Camera): void;
}

export const CameraContext = createContext<CameraApi | null>(null);

/** Access the shared camera API (provided above BoardViewport). */
export function useCameraContext(): CameraApi {
  const context = useContext(CameraContext);
  if (!context) {
    throw new Error("useCameraContext must be used within a CameraContext.Provider");
  }
  return context;
}

function scheduleFrame(callback: () => void): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return setTimeout(callback, FRAME_FALLBACK_MS) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}

export function useCamera(viewport: Size): CameraApi {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));
  const [hasNavigated, setHasNavigated] = useState(false);
  const [panning, setPanning] = useState(false);

  const cameraRef = useRef(camera);
  const navigatedRef = useRef(false);
  const initializedRef = useRef(viewport.width > 0 && viewport.height > 0);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const queueRef = useRef<Array<(cam: Camera) => Camera>>([]);
  const frameRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const updates = queueRef.current;
    queueRef.current = [];
    const previous = cameraRef.current;
    let next = previous;
    for (const update of updates) {
      next = update(next);
    }
    if (next !== previous) {
      cameraRef.current = next;
      setCameraState(next);
      if (!navigatedRef.current) {
        navigatedRef.current = true;
        setHasNavigated(true);
      }
    }
  }, []);

  const schedule = useCallback(
    (update: (cam: Camera) => Camera) => {
      queueRef.current.push(update);
      if (frameRef.current === null) {
        frameRef.current = scheduleFrame(flush);
      }
    },
    [flush],
  );

  // One-time initialisation: when the viewport size is first known, centre
  // the board's starting point. This is not user navigation, so it does not
  // trip the hint latch (and never runs once the user has navigated).
  useEffect(() => {
    if (
      !initializedRef.current &&
      viewport.width > 0 &&
      viewport.height > 0 &&
      !navigatedRef.current
    ) {
      initializedRef.current = true;
      const next = resetCamera(viewport);
      cameraRef.current = next;
      setCameraState(next);
    }
  }, [viewport]);

  // Cancel a pending frame on unmount.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelFrame(frameRef.current);
    },
    [],
  );

  const panLastRef = useRef<Point | null>(null);

  const beginPan = useCallback((point: Point) => {
    panLastRef.current = point;
    setPanning(true);
  }, []);

  const panMove = useCallback(
    (point: Point) => {
      const last = panLastRef.current;
      if (!last) return;
      panLastRef.current = point;
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx === 0 && dy === 0) return;
      schedule((cam) => panBy(cam, dx, dy));
    },
    [schedule],
  );

  const endPan = useCallback(() => {
    panLastRef.current = null;
    setPanning(false);
  }, []);

  const wheel = useCallback(
    (event: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
      if (event.ctrlOrMeta) {
        // Trackpad pinch arrives as a Ctrl-wheel; factor = exp(-deltaY * k).
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
        schedule((cam) => zoomAt(cam, event.point, factor));
      } else {
        // Plain scroll pans the board in the scroll direction.
        schedule((cam) => panBy(cam, -event.deltaX, -event.deltaY));
      }
    },
    [schedule],
  );

  const zoomStep = useCallback(
    (direction: "in" | "out") => {
      schedule((cam) => zoomStepCamera(cam, viewportRef.current, direction));
    },
    [schedule],
  );

  const gestureZoom = useCallback(
    (point: Point, scaleRatio: number) => {
      schedule((cam) => zoomAt(cam, point, scaleRatio));
    },
    [schedule],
  );

  const reset = useCallback(() => {
    schedule(() => resetCamera(viewportRef.current));
  }, [schedule]);

  const setCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCameraState(next);
    if (!navigatedRef.current) {
      navigatedRef.current = true;
      setHasNavigated(true);
    }
  }, []);

  return {
    camera,
    hasNavigated,
    panning,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    gestureZoom,
    reset,
    setCamera,
  };
}
