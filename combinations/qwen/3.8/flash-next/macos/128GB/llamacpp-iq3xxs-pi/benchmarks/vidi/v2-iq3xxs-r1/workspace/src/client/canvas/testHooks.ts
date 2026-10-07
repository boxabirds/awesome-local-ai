import type { Camera } from './camera';

export interface BoardTestApi {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: BoardTestApi;
  }
}

export function installTestHook(api: BoardTestApi): void {
  if (typeof window !== 'undefined') window.__vidi6 = api;
}

export function uninstallTestHook(): void {
  if (typeof window !== 'undefined') delete window.__vidi6;
}
