import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  connectionState?: ConnectionState;
  simulateOutage?(ms: number): void;
  // Story 7 e2e: deterministically place `count` sticky notes on a 4-column
  // grid (world tops (-460 + col·240, -200 + row·240)) and return their ids.
  seedStickies?(count: number): string[];
  // Story 10 e2e: build a 4-shape checkout flow with 3 attached + 1 free
  // connector through the real model, returning the created ids.
  seedCheckoutFlow?(): { shapes: string[]; connectors: string[] };
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function installTestHooks(hooks: Vidi6TestHooks): void {
  if (!IS_TEST_MODE) return;
  window.__vidi6 = hooks;
}

export function uninstallTestHooks(): void {
  if (!IS_TEST_MODE) return;
  delete window.__vidi6;
}
