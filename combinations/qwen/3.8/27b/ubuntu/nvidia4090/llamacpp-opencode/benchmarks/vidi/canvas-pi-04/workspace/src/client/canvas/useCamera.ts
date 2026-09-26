// React integration for the board camera: a shared, ref-backed camera store
// plus the `useCamera` hook that every board consumer (viewport, zoom
// controls, hint) subscribes to.
//
// The store is a module singleton because the app has exactly one board and
// every consumer must observe the same camera without prop-drilling. Camera
// mutations arrive at input frequency (pointermove, wheel) and are
// coalesced with requestAnimationFrame to at most one render per frame.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepAt,
} from './camera';
import type { Camera, Point, Size } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export interface WheelInput {
  /** Horizontal delta in CSS pixels (already normalised from deltaMode). */
  deltaX: number;
  /** Vertical delta in CSS pixels (already normalised from deltaMode). */
  deltaY: number;
  /** True when Ctrl or Cmd is held (zoom) instead of plain scroll (pan). */
  ctrlOrMeta: boolean;
  /** Pointer position in viewport-local CSS pixels. */
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  /**
   * Latches true on the first camera change that actually moves the camera;
   * a no-op update (e.g. a zoom at the limit) does not trip it.
   */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
}

interface Snapshot {
  camera: Camera;
  hasNavigated: boolean;
}

const UNSET: Camera = { x: 0, y: 0, zoom: 1 };
const EMPTY_SIZE: Size = { width: 0, height: 0 };

let viewportSize: Size = EMPTY_SIZE;
let snapshot: Snapshot = { camera: UNSET, hasNavigated: false };
let initialised = false;
let pendingCamera: Camera | null = null;
let frameId: number | null = null;
let panStart: { point: Point; camera: Camera } | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function replaceSnapshot(next: Snapshot): void {
  snapshot = next;
  emit();
}

function currentCamera(): Camera {
  return pendingCamera ?? snapshot.camera;
}

function cancelPendingFrame(): void {
  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  pendingCamera = null;
}

/** Coalesce high-frequency camera changes to one render per frame. */
function commitCamera(next: Camera): void {
  if (next === pendingCamera || next === snapshot.camera) return;
  pendingCamera = next;
  if (frameId === null) {
    frameId = requestAnimationFrame(() => {
      frameId = null;
      const next = pendingCamera;
      pendingCamera = null;
      if (next !== null && next !== snapshot.camera) {
        replaceSnapshot({ camera: next, hasNavigated: true });
      }
    });
  }
}

function beginPan(point: Point): void {
  if (panStart !== null) return;
  // Pan deltas are measured against the camera captured when the drag began
  // so repeated pointermove events cannot accumulate drift.
  panStart = { point, camera: currentCamera() };
}

function panMove(point: Point): void {
  if (panStart === null) return;
  commitCamera(
    panBy(panStart.camera, point.x - panStart.point.x, point.y - panStart.point.y),
  );
}

function endPan(): void {
  panStart = null;
}

function wheel({ deltaX, deltaY, ctrlOrMeta, point }: WheelInput): void {
  const cam = currentCamera();
  if (ctrlOrMeta) {
    // Board-owned zoom: exp() keeps consecutive wheel events composable.
    commitCamera(zoomAt(cam, point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)));
  } else {
    // Plain scroll pans the content opposite to the scroll direction,
    // matching native scrolling.
    commitCamera(panBy(cam, -deltaX, -deltaY));
  }
}

function zoomStepAction(direction: 'in' | 'out'): void {
  commitCamera(zoomStepAt(currentCamera(), viewportSize, direction));
}

function resetAction(): void {
  commitCamera(resetCamera(viewportSize));
}

/**
 * Test hook: set the camera immediately, bypassing the rAF coalescing.
 * Only reachable through `window.__vidi6` in test mode (see testHooks.ts).
 */
export function setBoardCamera(camera: Camera): void {
  cancelPendingFrame();
  replaceSnapshot({ camera, hasNavigated: true });
}

/** Test helper: restore the store to its pristine initial state. */
export function resetBoardForTests(): void {
  cancelPendingFrame();
  panStart = null;
  initialised = false;
  viewportSize = EMPTY_SIZE;
  replaceSnapshot({ camera: UNSET, hasNavigated: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): Snapshot => snapshot;

/**
 * Subscribe to the shared board camera. `viewport` is the size of the board
 * area in CSS pixels; it anchors stepped zoom and the reset view. A passive
 * resize never moves content (the camera's top-left world coordinate is
 * unchanged); only the stored size updates.
 */
export function useCamera(viewport: Size): CameraApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;
    if (viewportSize.width !== viewport.width || viewportSize.height !== viewport.height) {
      viewportSize = { width: viewport.width, height: viewport.height };
    }
    if (!initialised && !snapshot.hasNavigated && snapshot.camera === UNSET) {
      initialised = true;
      // First real viewport size: open on the standard view (origin centred).
      replaceSnapshot({ camera: resetCamera(viewportSize), hasNavigated: false });
    }
  }, [viewport.width, viewport.height]);

  return useMemo(
    () => ({
      camera: snap.camera,
      hasNavigated: snap.hasNavigated,
      beginPan,
      panMove,
      endPan,
      wheel,
      zoomStep: zoomStepAction,
      reset: resetAction,
    }),
    [snap],
  );
}

/** Track the size of an element with ResizeObserver (or window resize). */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(EMPTY_SIZE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/** Track the window size (the board area is the whole window). */
export function useWindowSize(): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = (): void => {
      setSize((prev) =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}
