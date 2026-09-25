import type { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      getCamera: () => Camera;
    };
  }
}

let testSetCamera: ((cam: Camera) => void) | null = null;
let testGetCamera: (() => Camera) | null = null;

export function registerTestHooks(setCamera: (cam: Camera) => void, getCamera: () => Camera): void {
  testSetCamera = setCamera;
  testGetCamera = getCamera;
}

export function initGlobalTestHooks(): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera: (cam: Camera) => testSetCamera?.(cam),
      getCamera: () => testGetCamera?.() ?? { x: 0, y: 0, zoom: 1 },
    };
  }
}
