import { resetCamera, type Camera, type Size } from '../../src/client/canvas/camera';

/** The fixture board area (a default laptop), same as the e2e viewport. */
export const WINDOW_SIZE: Size = { width: 1280, height: 800 };

/**
 * The board area fills the window, so the window size is the viewport size.
 * The component test setup pins the jsdom window to WINDOW_SIZE, which makes
 * the camera the app starts from deterministic.
 */
export function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The camera `App` starts from: 100% zoom with world 0,0 at the centre. */
export function initialCamera(): Camera {
  return resetCamera(viewportSize());
}

/**
 * The camera as currently rendered, read back from the viewport's data
 * attributes. Full double precision: JS numbers round-trip through their string
 * form exactly, so tests can compare against camera.math output to the bit.
 */
export function readCamera(surface: Element): Camera {
  const { cameraX, cameraY, cameraZoom } = (surface as HTMLElement).dataset;
  return {
    x: Number(cameraX),
    y: Number(cameraY),
    zoom: Number(cameraZoom),
  };
}

/** The world layer's CSS transform, exactly as the board renders it. */
export function worldTransform(layer: Element): string {
  return (layer as HTMLElement).style.transform;
}

/** Expected transform for a camera: screen = (world - camera.xy) * zoom. */
export function expectedTransform(camera: Camera): string {
  return `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}
