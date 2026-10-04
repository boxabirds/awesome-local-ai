import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

import { cameraStore, wheelDeltaToPixels } from './cameraStore';
import type { WheelInput } from './cameraStore';
import type { Camera, Point, Size, ZoomDirection } from './camera';

export type { Camera, Point, Size, ZoomDirection } from './camera';
export { wheelDeltaToPixels };

/** Anything React can call with a DOM event that carries a client position. */
export interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
}

export interface CameraController {
  camera: Camera;
  /** True once the user has panned or zoomed during this visit. */
  hasNavigated: boolean;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: WheelInput): void;
  zoomStep(dir: ZoomDirection): void;
  reset(): void;
}

/**
 * Camera state plus the input handlers that change it.
 *
 * The camera itself lives in `cameraStore` so every component that calls this hook
 * shares one board; `viewport` is the size of the board area, used as the centre for
 * stepped zooms and as the reset framing.
 */
export function useCamera(viewport: Size): CameraController {
  const state = useSyncExternalStore(cameraStore.subscribe, cameraStore.getState);
  const { width, height } = viewport;

  useEffect(() => {
    cameraStore.setViewport({ width, height });
  }, [width, height]);

  return {
    camera: state.camera,
    hasNavigated: state.hasNavigated,
    beginPan: cameraStore.beginPan,
    panMove: cameraStore.panMove,
    endPan: cameraStore.endPan,
    wheel: cameraStore.wheel,
    zoomStep: cameraStore.zoomStep,
    reset: cameraStore.reset,
  };
}

/**
 * Measure an element with a `ResizeObserver`, falling back to the window size when
 * the element has no box yet (jsdom reports an empty rect). Resizing never moves the
 * camera; it only changes what is framed.
 */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      const next: Size =
        rect.width > 0 && rect.height > 0
          ? { width: rect.width, height: rect.height }
          : { width: window.innerWidth, height: window.innerHeight };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return size;
}
