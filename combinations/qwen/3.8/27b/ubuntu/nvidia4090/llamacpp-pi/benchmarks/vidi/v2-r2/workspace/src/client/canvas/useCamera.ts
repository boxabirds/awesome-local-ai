import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Context,
} from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as cameraZoomStep,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

/**
 * Normalised wheel/pinch input handed to `useCamera.wheel`.
 * `point` is relative to the viewport top-left; deltas are CSS pixels.
 */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

/** Everything the board surface and the controls need from the camera hook. */
export interface CameraController {
  camera: Camera;
  /**
   * Latches true on the first camera change that produces a new camera
   * object; never resets during the visit (page reload shows the hint again).
   */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  /** Test hook support (`window.__vidi6.setCamera`); not used by the UI. */
  setCamera(cam: Camera): void;
}

/**
 * Provided by `App` (which owns the camera) and consumed by `BoardViewport`
 * so the viewport's input handlers drive the same camera the zoom controls
 * use, without the camera leaking into BoardViewport's public props.
 */
export const CameraContext: Context<CameraController | null> = createContext<CameraController | null>(null);

const hasRaf =
  typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';

function nextFrame(callback: () => void): number {
  if (hasRaf) {
    return requestAnimationFrame(() => callback());
  }
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (hasRaf) {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

/**
 * Camera state + input handlers for the infinite board.
 *
 * All camera updates are coalesced with requestAnimationFrame to at most one
 * render per frame: input handlers enqueue pure camera transforms and a
 * single rAF applies them in order. `endPan` flushes synchronously so a
 * drag always ends on the exact pointer position.
 */
export function useCamera(viewport: Size): CameraController {
  const [camera, setCameraState] = useState<Camera>(() => resetCamera(viewport));

  // Latches true only when a camera change produces a different object, so
  // no-op updates (click without movement, zoom at a limit) do not count.
  const hasNavigatedRef = useRef(false);

  // Viewport size may change (window resize) between renders; handlers read
  // the current size without being re-created. The camera itself never
  // depends on the viewport size, so a resize is a no-op for it.
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  });

  const pendingRef = useRef<Array<(cam: Camera) => Camera>>([]);
  const rafRef = useRef<number | null>(null);

  const applyPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = [];
    if (pending.length === 0) {
      return;
    }
    setCameraState((prev) => {
      let next = prev;
      for (const update of pending) {
        next = update(next);
      }
      if (next !== prev) {
        hasNavigatedRef.current = true;
      }
      return next;
    });
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = nextFrame(() => {
      rafRef.current = null;
      applyPending();
    });
  }, [applyPending]);

  const enqueue = useCallback(
    (update: (cam: Camera) => Camera): void => {
      pendingRef.current.push(update);
      schedule();
    },
    [schedule],
  );

  const flush = useCallback(
    (update?: (cam: Camera) => Camera): void => {
      if (rafRef.current !== null) {
        cancelFrame(rafRef.current);
        rafRef.current = null;
      }
      if (update !== undefined) {
        pendingRef.current.push(update);
      }
      applyPending();
    },
    [applyPending],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = [];
    };
  }, []);

  // --- Pointer drag (pan) -------------------------------------------------
  const lastPointerRef = useRef<Point | null>(null);

  const beginPan = useCallback(
    (p: Point): void => {
      lastPointerRef.current = p;
    },
    [],
  );

  const panMove = useCallback(
    (p: Point): void => {
      const last = lastPointerRef.current;
      if (last === null) {
        return; // no active drag (or drag already ended)
      }
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      lastPointerRef.current = p;
      if (dx !== 0 || dy !== 0) {
        enqueue((cam) => panBy(cam, dx, dy));
      }
    },
    [enqueue],
  );

  const endPan = useCallback(
    (): void => {
      lastPointerRef.current = null;
      flush(); // apply any accumulated delta exactly, now
    },
    [flush],
  );

  // --- Wheel / pinch -------------------------------------------------------
  const wheel = useCallback(
    (e: WheelInput): void => {
      if (e.ctrlOrMeta) {
        // Trackpad pinch or Ctrl/Cmd + wheel: zoom around the pointer.
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        const point = e.point;
        enqueue((cam) => zoomAt(cam, point, factor));
      } else {
        // Plain scroll: pan in the scroll direction.
        const { deltaX, deltaY } = e;
        enqueue((cam) => panBy(cam, -deltaX, -deltaY));
      }
    },
    [enqueue],
  );

  // --- Buttons / keys / reset ----------------------------------------------
  const zoomStep = useCallback(
    (dir: 'in' | 'out'): void => {
      enqueue((cam) => cameraZoomStep(cam, viewportRef.current, dir));
    },
    [enqueue],
  );

  const reset = useCallback((): void => {
    enqueue(() => resetCamera(viewportRef.current));
  }, [enqueue]);

  const setCamera = useCallback(
    (cam: Camera): void => {
      enqueue(() => cam);
    },
    [enqueue],
  );

  return {
    camera,
    hasNavigated: hasNavigatedRef.current,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
    setCamera,
  };
}
