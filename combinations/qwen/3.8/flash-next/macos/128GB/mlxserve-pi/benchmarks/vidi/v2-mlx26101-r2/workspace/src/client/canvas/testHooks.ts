import type { Camera } from './camera.js';
import type { StickySnapshot } from '../../shared/board-model.js';
import type * as Y from 'yjs';

/**
 * Test-only hook for jumping the camera around the board. Dragging a million
 * pixels in an e2e test is impractical, so e2e teleports instead
 * (design "Fixtures"). Registered only when `import.meta.env.MODE === 'test'`
 * (i.e. `vite build --mode test`); the condition is a build-time constant so
 * dead-code elimination removes this from production builds.
 */
export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

export function registerTestHooks(api: Vidi6TestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  window.__vidi6 = api;
}

export function clearTestHooks(): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  delete window.__vidi6;
}

export function testHooks(): Vidi6TestHooks | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__vidi6;
}

/**
 * Test-only view of the board document, so tests can assert the document state
 * directly (and delete a note "via a model call", as the design's TC-37 puts
 * it) instead of only through the rendered DOM.
 */
export interface Vidi6BoardTestHooks {
  getDoc(): Y.Doc | undefined;
  getNotes(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6Board?: Vidi6BoardTestHooks;
  }
}

export function registerBoardTestHooks(hooks: Vidi6BoardTestHooks): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  window.__vidi6Board = hooks;
}

export function clearBoardTestHooks(): void {
  if (!IS_TEST_MODE || typeof window === 'undefined') return;
  delete window.__vidi6Board;
}

export function boardTestHooks(): Vidi6BoardTestHooks | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__vidi6Board;
}
