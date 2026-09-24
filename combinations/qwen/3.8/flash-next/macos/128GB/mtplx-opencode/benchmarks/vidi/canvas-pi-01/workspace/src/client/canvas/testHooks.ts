/**
 * Story 1 · task 3 — test-only browser hook.
 *
 * `window.__vidi6.setCamera()` lets the e2e suite jump straight to
 * UNBOUNDED_PAN_TESTED_EXTENT (dragging a million pixels is impractical) and
 * lets it read the camera back to check the pointer invariant. The whole
 * effect body is dead code outside `MODE === 'test'`, so a production build
 * never installs the hook.
 */
import { useEffect } from 'react';
import type { Camera } from './camera';
import { useCameraApi } from './useCamera';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}

export function useNavigationTestHooks(): void {
  const api = useCameraApi();
  useEffect(() => {
    if (!isTestMode() || typeof window === 'undefined') return;
    // Re-assigned on every render so the hook always sees the current camera.
    window.__vidi6 = {
      setCamera: (cam: Camera) => api.setCamera(cam),
      getCamera: () => api.camera,
    };
  });
}