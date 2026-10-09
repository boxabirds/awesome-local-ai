import type * as Y from 'yjs';
import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Everything the test build exposes on `window`. Optional members may be missing until
 * the component that owns them has mounted.
 */
export interface TestHooks {
  /** Jump the camera anywhere on the board. */
  setCamera(camera: Camera): void;
  /** The board document the page is editing, for tests that assert the model. */
  boardDoc?(): Y.Doc;
  /**
   * What this page's connection is doing, in the client's own terms rather than the
   * badge's words — so a test can tell 'the badge is hidden because the connection is
   * fine' apart from 'the badge is hidden because it was never there'.
   */
  connectionState?(): ConnectionState;
}

/** The parts of `window` the test-mode hook adds. */
declare global {
  interface Window {
    __vidi6?: TestHooks;
  }
}

export type TestHookPatch = Partial<TestHooks>;

/**
 * `window.__vidi6` exists only in the test build so e2e tests can jump to a far-away
 * camera or read the document instead of the DOM. Callers guard the call with
 * `import.meta.env.MODE === 'test'` as well, so production bundles drop this module
 * entirely.
 */
export function registerTestHooks(hooks: TestHookPatch): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = { ...window.__vidi6, ...hooks } as TestHooks;
}
