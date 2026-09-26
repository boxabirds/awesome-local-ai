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
import type { ConnectionState } from '../sync/connectBoard';
import type { BoardSession } from '../sync/boardSession';

/**
 * Test-only handle on the live app (design "Test seams").
 *
 * The camera part lets an e2e test jump far away instead of dragging a million
 * pixels. The note part lets a test reach a state the UI cannot produce in one
 * gesture - two overlapping notes, a note with a 1,000 character text - by
 * going through the very same model functions the app uses, so the fixture is
 * subject to the same rules as real input.
 *
 * The connection part (story 3) lets a test cut a live link and watch the
 * board catch up afterwards, which is the only way to test the PRD's 30-second
 * outage without waiting 30 seconds in every run.
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

export interface TextObjectHook {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
}

export interface BoardTestHooks {
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  getCamera(): Camera;
  /** The objects on the board, lowest z first. */
  getNotes(): StickyNoteHook[];
  /** The text objects on the board, lowest z first. */
  getTexts(): TextObjectHook[];
  /** Adds a note through the board model and returns its id ('' if refused). */
  seedNote(note: SeedNote): string;
  /** Removes a note while the pointer is still down, for interruption tests. */
  removeNote(id: string): boolean;
  getDoc(): Y.Doc | null;
  /** The room this board is shared in, or `'local'`. */
  getBoardId(): string;
  /** The socket URL of the room, or `null` for a local board. */
  getRoomUrl(): string | null;
  /** The connection state the badge is showing. */
  getConnectionState(): ConnectionState;
  /**
   * Cuts the live link without unmounting the board, so a test can watch the
   * reconnect and the catch-up. Returns false when there is no link to cut.
   */
  dropConnection(): boolean;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(
  getApi: () => CameraApi | null,
  getSession: () => BoardSession | null = () => null,
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
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'sticky')
        .map((row) => ({
          id: row.id,
          type: row.type,
          x: row.x,
          y: row.y,
          z: row.z,
          color: (row as any).color ?? 'yellow',
          text: row.text,
        }));
    },
    seedNote(note: SeedNote) {
      const session = getSession();
      if (!session) return '';
      const id = createSticky(session.doc, { x: note.x, y: note.y }, note.color);
      if (!id) return '';
      if (note.color) setStickyColor(session.doc, id, note.color);
      if (note.text) getStickyText(session.doc, id)?.insert(0, note.text);
      return id;
    },
    getTexts() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'text')
        .map((row) => ({
          id: row.id,
          type: 'text' as const,
          x: row.x,
          y: row.y,
          width: (row as any).width ?? 80,
          height: (row as any).height ?? 26,
          z: row.z,
          text: row.text,
          size: (row as any).size ?? 'M',
          widthMode: ((row as any).widthMode ?? 'auto') as 'auto' | 'fixed',
        }));
    },
    removeNote(id: string) {
      const session = getSession();
      if (!session) return false;
      return deleteObject(session.doc, id);
    },
    getDoc() {
      return getSession()?.doc ?? null;
    },
    getBoardId() {
      return getSession()?.boardId ?? 'local';
    },
    getRoomUrl() {
      return getSession()?.url ?? null;
    },
    getConnectionState() {
      return getSession()?.connection?.getState() ?? 'connected';
    },
    dropConnection() {
      const provider = getSession()?.connection?.provider as
        | { ws?: { close(): void } }
        | undefined;
      const socket = provider?.ws;
      if (!socket) return false;
      socket.close();
      return true;
    },
  };

  window.__vidi6 = hooks;
}

export function removeBoardTestHooks(): void {
  if (typeof window === 'undefined') return;
  delete window.__vidi6;
}
