import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  setStickyColor,
  snapshot,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import type { Camera } from './camera';
import type { CameraApi } from './useCamera';

/**
 * Test-only handle on the live app (design "Test seams").
 *
 * The camera part lets an e2e test jump far away instead of dragging a million
 * pixels. The note part lets a test reach a state the UI cannot produce in one
 * gesture - two overlapping notes, a note with a 1,000 character text - by
 * going through the very same model functions the app uses, so the fixture is
 * subject to the same rules as real input.
 *
 * Installed only when `import.meta.env.MODE === 'test'`: production builds
 * contain no hook.
 */

/** One board object as the app currently renders it, in paint order. */
export interface StickyNoteHook {
  id: string;
  type: string;
  /** Top-left corner, world units. */
  x: number;
  y: number;
  /** Paint order: a lower z is painted first, i.e. below. */
  z: number;
  color: StickyColor;
  text: string;
}

export interface SeedNote {
  /** Centre of the new note, world units (the same convention as createSticky). */
  x: number;
  y: number;
  color?: StickyColor;
  text?: string;
}

export interface BoardTestHooks {
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  getCamera(): Camera;
  /** The objects on the board, lowest z first. */
  getNotes(): StickyNoteHook[];
  /** Adds a note through the board model and returns its id ('' if refused). */
  seedNote(note: SeedNote): string;
  /** Removes a note while the pointer is still down, for interruption tests. */
  removeNote(id: string): boolean;
  getDoc(): Y.Doc | null;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(
  getApi: () => CameraApi | null,
  getDoc: () => Y.Doc | null = () => null,
): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.MODE !== 'test') return;

  const hooks: BoardTestHooks = {
    setCamera(camera) {
      getApi()?.setCamera({
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
      });
    },
    getCamera() {
      return getApi()?.camera ?? { x: 0, y: 0, zoom: 1 };
    },
    getNotes() {
      const doc = getDoc();
      if (!doc) return [];
      return snapshot(doc).map((row) => ({
        id: row.id,
        type: row.type,
        x: row.x,
        y: row.y,
        z: row.z,
        color: row.color,
        text: row.text,
      }));
    },
    seedNote(note: SeedNote) {
      const doc = getDoc();
      if (!doc) return '';
      const id = createSticky(doc, { x: note.x, y: note.y }, note.color);
      if (!id) return '';
      if (note.color) setStickyColor(doc, id, note.color);
      if (note.text) getStickyText(doc, id)?.insert(0, note.text);
      return id;
    },
    removeNote(id: string) {
      const doc = getDoc();
      if (!doc) return false;
      return deleteObject(doc, id);
    },
    getDoc,
  };

  window.__vidi6 = hooks;
}

export function removeBoardTestHooks(): void {
  if (typeof window === 'undefined') return;
  delete window.__vidi6;
}
