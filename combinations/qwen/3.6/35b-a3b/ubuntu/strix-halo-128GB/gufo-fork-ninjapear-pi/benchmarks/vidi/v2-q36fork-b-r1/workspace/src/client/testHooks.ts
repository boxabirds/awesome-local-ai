import { setTestOverride } from './canvas/testCameraStore';

interface TestHooks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCamera: (cam: Record<string, any>) => void;
}

declare global {
  interface Window {
    __vidi6?: TestHooks;
  }
}

let registered = false;

export function initTestHook(): void {
  if (registered || import.meta.env.MODE !== 'test') return;
  registered = true;
  if (typeof window !== 'undefined') {
    window.__vidi6 = {
      setCamera: setTestOverride,
    };
  }
}
