import { useEffect } from "react";
import { ZOOM_MAX, ZOOM_MIN } from "../../shared/config";
import type { ConnectionState } from "../sync/connection-state";
import type { Camera } from "./camera";

/**
 * Test-only hook: `window.__vidi6` lets tests place the camera directly
 * (jumping a million board units by dragging is impractical).
 *
 * Installed only when the bundle is built in test mode
 * (`import.meta.env.MODE === "test"`, i.e. under Vitest or `vite build --mode
 * test`), so it never ships in a production build.
 */
export interface Vidi6TestApi {
  getCamera(): Camera;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  /** Live connection state, added by the sync layer (story 3). */
  connectionState?: ConnectionState;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === "test";
}

export interface TestHookSource {
  getCamera(): Camera;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
}

/**
 * Registers `window.__vidi6` for as long as `source` is provided and the app
 * runs in test mode. A no-op in production builds.
 */
export function useTestHooks(source: TestHookSource | null): void {
  useEffect(() => {
    if (!source || !isTestMode()) return;
    const previous = window.__vidi6;
    window.__vidi6 = {
      getCamera: () => source.getCamera(),
      setCamera: (camera) => source.setCamera(camera),
    };
    return () => {
      window.__vidi6 = previous;
    };
  }, [source]);
}

/** Rejects junk input before it can poison the camera. */
export function isUsableCamera(camera: { x: number; y: number; zoom: number }): boolean {
  return (
    Number.isFinite(camera.x) &&
    Number.isFinite(camera.y) &&
    Number.isFinite(camera.zoom) &&
    camera.zoom >= ZOOM_MIN &&
    camera.zoom <= ZOOM_MAX
  );
}
