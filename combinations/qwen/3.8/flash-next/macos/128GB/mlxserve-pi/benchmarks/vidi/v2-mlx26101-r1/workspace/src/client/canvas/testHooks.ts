import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';
import type * as Y from 'yjs';
import type { StickyColor } from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import { applyTextDiff } from '../objects/StickyText';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../shared/board-model';

/** Test-only handle on the live camera, installed when MODE === 'test'. */
export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /**
   * Connection state exactly as the badge renders it, so an e2e test can assert
   * it never leaves `connected` while idle (null before the first update), and can
   * tell whether this client has synced with the room yet.
   */
  connectionState: ConnectionState | null;
}

/** What a test can do to the live board using the very functions the UI uses. */
export interface Vidi6BoardHandle {
  /** The live shared document. */
  readonly doc: Y.Doc;
  /** The board exactly as this client's model sees it. */
  notes(): readonly StickySnapshot[];
  /** Create a note centred on a world point; returns its id. */
  create(at?: { x: number; y: number }): string;
  /** Put a note at world (x, y). */
  moveTo(id: string, x: number, y: number): boolean;
  color(id: string, color: StickyColor): boolean;
  /** Replace a note's text, as the editor does (minimal diff, merge-safe). */
  write(id: string, text: string): void;
  remove(id: string): boolean;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
    __vidi6TestBoard?: Vidi6BoardHandle;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/**
 * Last published connection state. Kept at module level because the effect that
 * publishes it and the effect that installs the camera handle are separate, and
 * the handle is re-created whenever the camera's deps are.
 */
let lastConnectionState: ConnectionState | null = null;

/**
 * Install `window.__vidi6` so Playwright e2e tests can jump the camera far away
 * (dragging a million pixels is impractical). In production builds
 * `import.meta.env.MODE` is `"production"`, so this is a no-op and the branch is
 * tree-shaken out of the bundle.
 */
export function installTestHooks(
  get: () => Camera,
  set: (cam: Camera) => void,
): () => void {
  if (!IS_TEST_MODE) return () => {};
  window.__vidi6 = {
    setCamera: (cam) => set({ x: cam.x, y: cam.y, zoom: cam.zoom }),
    getCamera: get,
    connectionState: lastConnectionState,
  };
  return () => {
    delete window.__vidi6;
  };
}

/**
 * Install `window.__vidi6TestBoard` for e2e tests that need seed data or volume
 * (hundreds of operations would take minutes through the mouse). The operations
 * are the same ones the UI calls, so a scripted change propagates and renders
 * exactly like a person's. `window.__vidi6Board` is the bare document, kept for
 * the component tests. Test builds only.
 */
export function installBoardHandle(doc: Y.Doc): () => void {
  if (!IS_TEST_MODE) return () => {};
  const handle: Vidi6BoardHandle = {
    doc,
    notes: () => snapshot(doc),
    create: (at) => createSticky(doc, at ?? { x: 0, y: 0 }),
    moveTo: (id, x, y) => moveObject(doc, id, x, y),
    color: (id, color) => setStickyColor(doc, id, color),
    write: (id, text) => {
      const ytext = getStickyText(doc, id);
      if (ytext) applyTextDiff(ytext, text, undefined);
    },
    remove: (id) => deleteObject(doc, id),
  };
  window.__vidi6TestBoard = handle;
  return () => {
    if (window.__vidi6TestBoard === handle) delete window.__vidi6TestBoard;
  };
}

/**
 * Publish the badge's connection state for e2e assertions. No-op in production
 * builds, like the rest of this module.
 */
export function publishConnectionState(state: ConnectionState): void {
  if (!IS_TEST_MODE) return;
  lastConnectionState = state;
  if (window.__vidi6) window.__vidi6.connectionState = state;
}
