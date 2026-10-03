import { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
    };
  }
}

let setCameraFn: ((cam: Camera) => void) | null = null;

export function initTestHooks() {
  if (typeof window !== 'undefined') {
    window.__vidi6 = {
      setCamera(cam: Camera) {
        setCameraFn?.(cam);
      },
    };
  }
}

export function registerSetCamera(fn: (cam: Camera) => void) {
  setCameraFn = fn;
}
