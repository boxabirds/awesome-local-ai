import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import {
  panBy,
  resetCamera,
  zoomAt,
  zoomStep as zoomStepCamera,
  type Camera,
  type Point,
  type Size,
} from './camera';
import { registerCameraStore, unregisterCameraStore } from './testHooks';

export interface WheelInput {
  /** Scroll delta in CSS pixels (already converted from lines/pages). */
  deltaX: number;
  deltaY: number;
  /** True when Ctrl (pinch on Windows/Linux trackpads, mouse zoom) or Cmd is held. */
  ctrlOrMeta: boolean;
  /** Pointer position in viewport coordinates, the point to zoom around. */
  point: Point;
}

export interface CameraApi {
  camera: Camera;
  /** Latches true the first time the camera actually changes this visit. */
  hasNavigated: boolean;
  /** True while a drag-to-pan gesture is in progress. */
  panning: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(input: WheelInput): void;
  zoomStep(direction: 'in' | 'out'): void;
  reset(): void;
}

interface Snapshot {
  readonly camera: Camera;
  readonly hasNavigated: boolean;
  readonly panning: boolean;
}

type Updater = (camera: Camera) => Camera;

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const INITIAL_VIEWPORT: Size = { width: 0, height: 0 };

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => callback());
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/**
 * The board camera as an external store so the viewport (which owns gestures)
 * and the fixed-position overlays (zoom controls, hint) share one camera.
 * Camera updates are coalesced to at most one render per animation frame.
 */
export class CameraStore {
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot = { camera: INITIAL_CAMERA, hasNavigated: false, panning: false };
  private viewport: Size = INITIAL_VIEWPORT;
  private queue: Updater[] = [];
  private panFrom: Point | null = null;
  private frame: number | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): Snapshot => this.snapshot;

  /**
   * The camera is anchored to the viewport's top-left corner, so a resize never
   * changes the camera and never notifies subscribers (TC-07).
   */
  setViewport(size: Size): void {
    this.viewport = size;
  }

  getViewport(): Size {
    return this.viewport;
  }

  readonly beginPan = (p: Point): void => {
    this.panFrom = p;
    if (!this.snapshot.panning) this.commit({ ...this.snapshot, panning: true });
  };

  readonly panMove = (p: Point): void => {
    if (this.panFrom === null) return;
    const dx = p.x - this.panFrom.x;
    const dy = p.y - this.panFrom.y;
    if (dx === 0 && dy === 0) return;
    this.panFrom = p;
    this.schedule((camera) => panBy(camera, dx, dy));
  };

  readonly endPan = (): void => {
    this.panFrom = null;
    if (this.snapshot.panning) this.commit({ ...this.snapshot, panning: false });
  };

  readonly wheel = (input: WheelInput): void => {
    if (input.ctrlOrMeta) {
      const factor = Math.exp(-input.deltaY * WHEEL_ZOOM_SENSITIVITY);
      this.schedule((camera) => zoomAt(camera, input.point, factor));
      return;
    }
    if (input.deltaX === 0 && input.deltaY === 0) return;
    // Content moves against the scroll direction, like native scrolling.
    this.schedule((camera) => panBy(camera, -input.deltaX, -input.deltaY));
  };

  readonly zoomStep = (direction: 'in' | 'out'): void => {
    this.schedule((camera) => zoomStepCamera(camera, this.viewport, direction));
  };

  readonly reset = (): void => {
    this.schedule(() => resetCamera(this.viewport));
  };

  /** Jump to an exact camera; only reachable through the test-mode hook. */
  readonly setCamera = (camera: Camera): void => {
    this.queue = [];
    if (this.frame !== null) {
      cancelFrame(this.frame);
      this.frame = null;
    }
    if (camera === this.snapshot.camera) return;
    this.commit({ camera, hasNavigated: true, panning: false });
  };

  dispose(): void {
    if (this.frame !== null) {
      cancelFrame(this.frame);
      this.frame = null;
    }
    this.queue = [];
    this.listeners.clear();
  }

  private readonly flush = (): void => {
    this.frame = null;
    const queue = this.queue;
    this.queue = [];
    if (queue.length === 0) return;

    let camera = this.snapshot.camera;
    for (const updater of queue) camera = updater(camera);
    if (camera === this.snapshot.camera) return;
    // Any real camera change dismisses the first-use hint for the rest of the visit.
    this.commit({ camera, hasNavigated: true, panning: this.snapshot.panning });
  };

  private schedule(updater: Updater): void {
    this.queue.push(updater);
    if (this.frame === null) this.frame = requestFrame(this.flush);
  }

  private commit(next: Snapshot): void {
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

const CameraStoreContext = createContext<CameraStore | null>(null);

export interface CameraProviderProps {
  children?: ReactNode;
}

/** Creates the board camera store for the subtree below it. */
export function CameraProvider({ children }: CameraProviderProps): JSX.Element {
  const store = useMemo(() => new CameraStore(), []);

  useEffect(() => {
    registerCameraStore(store);
    return () => {
      unregisterCameraStore(store);
      store.dispose();
    };
  }, [store]);

  return createElement(CameraStoreContext.Provider, { value: store }, children);
}

function useCameraStore(): CameraStore {
  const store = useContext(CameraStoreContext);
  if (store === null) {
    throw new Error('vidi6 board components must be rendered inside <CameraProvider>');
  }
  return store;
}

/**
 * Camera state plus the navigation handlers, for the component that knows the
 * size of the board area (the viewport). Zoom-step and reset use that size to
 * zoom around its centre.
 */
export function useCamera(viewport: Size): CameraApi {
  const store = useCameraStore();
  const { width, height } = viewport;

  useEffect(() => {
    store.setViewport({ width, height });
  }, [store, width, height]);

  return useCameraApi();
}

/** Camera state and navigation actions, for overlays next to the viewport. */
export function useCameraApi(): CameraApi {
  const store = useCameraStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return useMemo<CameraApi>(
    () => ({
      camera: snapshot.camera,
      hasNavigated: snapshot.hasNavigated,
      panning: snapshot.panning,
      beginPan: store.beginPan,
      panMove: store.panMove,
      endPan: store.endPan,
      wheel: store.wheel,
      zoomStep: store.zoomStep,
      reset: store.reset,
    }),
    [store, snapshot],
  );
}
