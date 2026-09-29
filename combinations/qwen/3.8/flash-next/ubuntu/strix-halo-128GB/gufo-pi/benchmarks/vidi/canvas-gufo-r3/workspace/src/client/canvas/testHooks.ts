import { Camera } from './camera';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getCamera?(): Camera | undefined;
    };
  }
}

export function setupTestHooks(setCamera: (cam: Camera) => void, getCamera?: () => Camera) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = { setCamera, getCamera };
  }
}
