/**
 * The board's camera state, held in one module-level store.
 *
 * `useCamera` is called from more than one component (`App` wires the zoom controls
 * and the hint, `BoardViewport` renders the surface), and all of them must see and
 * change the same camera - so the state lives here rather than in a single
 * component's `useState`. Subscribers are notified through `useSyncExternalStore`.
 *
 * Camera changes are emitted at most once per animation frame; the state itself is
 * updated synchronously so maths always runs on the newest camera.
 *
 * Nothing is persisted: reloading the page starts from scratch.
 */
import * as cameraMath from './camera';
import type { Camera, Point, Size, ZoomDirection } from './camera';
import { installTestHooks } from './testHooks';
import {
  WHEEL_DELTA_MODE_LINES,
  WHEEL_DELTA_MODE_PAGES,
  WHEEL_LINE_PX,
  WHEEL_PAGE_VIEWPORT_FRACTION,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../shared/config';

export interface CameraState {
  readonly camera: Camera;
  /** Latches true on the first camera change of the visit and never resets. */
  readonly hasNavigated: boolean;
  readonly viewport: Size;
}

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlOrMeta: boolean;
  readonly point: Point;
}

export type GestureKind = 'start' | 'change' | 'end';

export interface GestureInput {
  readonly kind: GestureKind;
  readonly scale: number;
  readonly point: Point;
}

type Listener = () => void;

/** Fallback board area used before the first measurement (also Node/tests). */
const FALLBACK_VIEWPORT_WIDTH = 1200;
const FALLBACK_VIEWPORT_HEIGHT = 800;
/** Milliseconds of a frame when `requestAnimationFrame` is unavailable. */
const FRAME_MS = 16;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function initialViewport(): Size {
  if (hasWindow() && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: FALLBACK_VIEWPORT_WIDTH, height: FALLBACK_VIEWPORT_HEIGHT };
}

function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
    return;
  }
  setTimeout(callback, FRAME_MS);
}

function createState(): CameraState {
  const viewport = initialViewport();
  return { camera: cameraMath.resetCamera(viewport), hasNavigated: false, viewport };
}

function createCameraStore() {
  let state: CameraState = createState();
  const listeners = new Set<Listener>();
  let emitScheduled = false;
  /** Screen point of the last pointer position while panning (null when Idle). */
  let panLast: Point | null = null;
  /** Zoom the Safari pinch gesture started from, so `scale` is cumulative. */
  let gestureBaseZoom: number | null = null;

  function emit(): void {
    emitScheduled = false;
    for (const listener of [...listeners]) listener();
  }

  /** Coalesce notifications to at most one per frame. */
  function scheduleEmit(): void {
    if (emitScheduled) return;
    emitScheduled = true;
    scheduleFrame(emit);
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getState(): CameraState {
    return state;
  }

  /** Apply a camera produced by camera.math; identical objects change nothing. */
  function commitCamera(next: Camera): void {
    if (next === state.camera) return;
    state = { ...state, camera: next, hasNavigated: true };
    scheduleEmit();
  }

  function setViewport(size: Size): void {
    // A resize must not move the camera: only the viewport we zoom around changes.
    if (state.viewport.width === size.width && state.viewport.height === size.height) return;
    state = { ...state, viewport: size };
    scheduleEmit();
  }

  function beginPan(point: Point): void {
    panLast = point;
  }

  function panMove(point: Point): void {
    if (!panLast) return;
    const dx = point.x - panLast.x;
    const dy = point.y - panLast.y;
    panLast = point;
    commitCamera(cameraMath.panBy(state.camera, dx, dy));
  }

  function endPan(): void {
    panLast = null;
  }

  function wheel(input: WheelInput): void {
    if (input.ctrlOrMeta) {
      wheelZoom(input);
      return;
    }
    commitCamera(cameraMath.panBy(state.camera, -input.deltaX, -input.deltaY));
  }

  function wheelZoom({ deltaY, point }: WheelInput): void {
    commitCamera(
      cameraMath.zoomAt(state.camera, point, Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)),
    );
  }

  /** Safari's non-standard gesture events report a cumulative scale factor. */
  function gesture(input: GestureInput): void {
    if (input.kind === 'end') {
      gestureBaseZoom = null;
      return;
    }
    if (input.kind === 'start') {
      gestureBaseZoom = state.camera.zoom;
      return;
    }
    if (!Number.isFinite(input.scale) || input.scale <= 0) return;
    const base = gestureBaseZoom ?? state.camera.zoom;
    const target = base * input.scale;
    commitCamera(
      cameraMath.zoomAt(state.camera, input.point, target / state.camera.zoom),
    );
  }

  function zoomStep(direction: ZoomDirection): void {
    commitCamera(cameraMath.zoomStep(state.camera, state.viewport, direction));
  }

  function reset(): void {
    commitCamera(cameraMath.resetCamera(state.viewport));
  }

  /** Test-only: jump the camera (e2e cannot drag a million pixels). */
  function setCameraTest(patch: Partial<Camera>): void {
    const zoom = patch.zoom ?? state.camera.zoom;
    commitCamera({
      x: patch.x ?? state.camera.x,
      y: patch.y ?? state.camera.y,
      zoom: Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX),
    });
  }

  /** Test-only: put the store back the way a fresh page load would leave it,
   * optionally starting from a given camera (e.g. already at a zoom limit). */
  function resetForTests(initialCamera?: Partial<Camera>): void {
    const viewport = initialViewport();
    const camera = initialCamera
      ? { ...cameraMath.resetCamera(viewport), ...initialCamera }
      : cameraMath.resetCamera(viewport);
    state = { camera, hasNavigated: false, viewport };
    panLast = null;
    gestureBaseZoom = null;
    emitScheduled = false;
    listeners.clear();
  }

  return {
    subscribe,
    getState,
    setViewport,
    beginPan,
    panMove,
    endPan,
    wheel,
    gesture,
    zoomStep,
    reset,
    setCameraTest,
    resetForTests,
    get isPanning(): boolean {
      return panLast !== null;
    },
  };
}

export type CameraStore = ReturnType<typeof createCameraStore>;

export const cameraStore = createCameraStore();

/** Convert a wheel delta to pixels; `deltaMode` may be LINES or PAGES. */
export function wheelDeltaToPixels(delta: number, deltaMode: number, extent: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (deltaMode === WHEEL_DELTA_MODE_LINES) return delta * WHEEL_LINE_PX;
  if (deltaMode === WHEEL_DELTA_MODE_PAGES) return delta * extent * WHEEL_PAGE_VIEWPORT_FRACTION;
  return delta;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const ZOOM_IN_KEYS = ['=', '+'];
const ZOOM_OUT_KEYS = ['-', '_'];
const RESET_KEYS = ['0'];

/**
 * Board-owned keyboard zoom: Ctrl/Cmd + `=`, `-` and `0` act on the board and are
 * cancelled so the browser's page zoom never changes. Registered once for the page.
 */
function installKeyboardShortcuts(store: CameraStore): void {
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    if (ZOOM_IN_KEYS.includes(event.key)) {
      event.preventDefault();
      store.zoomStep('in');
    } else if (ZOOM_OUT_KEYS.includes(event.key)) {
      event.preventDefault();
      store.zoomStep('out');
    } else if (RESET_KEYS.includes(event.key)) {
      event.preventDefault();
      store.reset();
    }
  });
}

if (hasWindow()) {
  installKeyboardShortcuts(cameraStore);

  // Excluded from production builds: `MODE` is a build-time constant.
  if (import.meta.env.MODE === 'test') {
    installTestHooks({
      setCamera: cameraStore.setCameraTest,
      getCamera: () => cameraStore.getState().camera,
    });
  }
}
