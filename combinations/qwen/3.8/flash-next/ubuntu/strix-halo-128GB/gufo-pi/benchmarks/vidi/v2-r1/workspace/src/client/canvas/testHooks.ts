import type * as Y from 'yjs';

import { ZOOM_MAX, ZOOM_MIN } from '../../shared/config';
import type { Camera } from './camera';

/**
 * Test-only hooks, present only in `vite build --mode test` output (and in
 * Vitest), so the e2e suite can jump to a position a million world units from
 * the start instead of dragging a million pixels. `import.meta.env.MODE` is a
 * build-time constant, so the whole object is dead-code eliminated from
 * production builds.
 */
export const TEST_MODE = import.meta.env.MODE === 'test';

export interface Vidi6TestHooks {
  setCamera(camera: Camera): void;
  getCamera(): Camera;
  /**
   * The in-memory board document, set by `App` in test builds so the component
   * suite can assert on the model and drive model-only situations (a note
   * deleted while it is being dragged).
   */
  getDoc?(): Y.Doc;
  /** Returns the number of notes currently in the document. */
  getNoteCount?(): number;
  /** Adds n random sticky notes to the document. */
  addRandomNotes?(n: number): void;
}

export function installTestHooks(hooks: Vidi6TestHooks | null): void {
  if (!TEST_MODE) return;
  if (hooks === null) {
    delete window.__vidi6;
    return;
  }
  window.__vidi6 = hooks;
}

/**
 * Ignore nonsense cameras rather than letting a test corrupt the board. `x` and
 * `y` stay unbounded (the board has no edges); the zoom is clamped to the
 * product limits exactly as every real input would be.
 */
export function parseTestCamera(value: Camera): Camera | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, zoom } = value;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  return { x, y, zoom: Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX) };
}
