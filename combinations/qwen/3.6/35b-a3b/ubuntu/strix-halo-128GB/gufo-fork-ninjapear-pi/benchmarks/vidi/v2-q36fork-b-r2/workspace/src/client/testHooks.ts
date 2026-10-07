import * as React from 'react';
import type { Camera } from './canvas/camera';

// Test-only hooks exposed on window.__vidi6. Only active in test mode.
interface Vidi6API {
  setCamera(cam: Camera): void;
}

declare global {
  interface Window {
    __vidi6?: Vidi6API;
  }
}

const isTestMode = typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test';

export function useVidi6TestHook(
  setCamera: (cam: Camera) => void,
): void {
  React.useEffect(() => {
    if (!isTestMode) return;

    const handler = (e: Event) => {
      const cam = (e as CustomEvent).detail as Camera | undefined;
      if (cam) {
        setCamera(cam);
      }
    };
    window.addEventListener('vidi6:setCamera', handler);
    return () => window.removeEventListener('vidi6:setCamera', handler);
  }, [setCamera]);
}

if (isTestMode) {
  // Expose setCamera globally so e2e tests can call it
  window.__vidi6 = {
    setCamera(_cam: Camera) {
      // Dispatch event for React component to pick up
      window.dispatchEvent(new CustomEvent('vidi6:setCamera', { detail: _cam }));
    },
  };
}
