// Test-only hooks, installed only in builds made with `--mode test`.
// Production builds never expose window.__vidi6.

import type * as Y from 'yjs';
import type { BoardConnection } from '../sync/connectBoard';
import type { CameraApi } from './useCamera';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectsSnapshot,
  setStickyColor,
} from '../../shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface Vidi6TestApi {
  /** Current connection badge state (story 3): connecting | connected |
   *  reconnecting | confirmed. */
  readonly connectionState: string;
  setCamera(x: number, y: number, zoom: number): void;
  /** Creates a sticky centred on a world point; returns its id (or null). */
  createSticky(x: number, y: number, color?: string): string | null;
  /** Current sticky snapshots (id, position, size, colour, text, stacking).
   *  width/height are null while the note keeps its implicit default size. */
  getStickyNotes(): Array<{
    id: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    color: string;
    text: string;
    z: number;
  }>;
  /** Ids of all currently selected objects (empty when nothing is selected). */
  getSelectedIds(): string[];
  /** Id of the currently selected note, or null (only for a single note
   *  selection; legacy helper kept for earlier stories' tests). */
  selectedStickyId(): string | null;
  /** The current camera (x, y, zoom) in world units. */
  getCamera(): { x: number; y: number; zoom: number };
  deleteSticky(id: string): boolean;
  moveSticky(id: string, x: number, y: number): boolean;
  bringStickyToFront(id: string): boolean;
  setStickyColor(id: string, color: string): boolean;
  /** Replaces a note's text (test seeding). */
  setStickyText(id: string, text: string): boolean;
  /** Test-only: provider connection internals (diagnosing sync issues). */
  connectionDebug(): { status: string; synced: boolean; wsconnected: boolean; wsReadyState: number | null } | null;
  /** Simulates a network drop for this client (badge → Reconnecting…). */
  dropConnection(): void;
  /** Restores the network, letting the client reconnect. */
  restoreConnection(): void;
  /** Transform-gesture start/end counts (story 7: TC-26). */
  getGestureEvents(): { start: number; end: number };
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

function testColor(color: string | undefined): StickyColor | undefined {
  return color !== undefined && color in STICKY_COLORS ? (color as StickyColor) : undefined;
}

export function installTestHooks(
  getApi: () => CameraApi,
  getDoc: () => Y.Doc | null,
  getConnectionState: () => string,
  getConnection: () => BoardConnection | null,
  getSelectedIds: () => string[],
  getGestureEvents?: () => { start: number; end: number },
): void {
  if (import.meta.env.MODE !== 'test') return;
  (window as unknown as Record<string, unknown>).__vidi6Doc = getDoc();
  window.__vidi6 = {
    get connectionState() {
      return getConnectionState();
    },
    setCamera(x, y, zoom) {
      getApi().setCamera({ x, y, zoom });
    },
    createSticky(x, y, color) {
      const doc = getDoc();
      if (!doc) return null;
      const id = createSticky(doc, { x, y }, testColor(color));
      return id === '' ? null : id;
    },
    getStickyNotes() {
      const doc = getDoc();
      if (!doc) return [];
      return objectsSnapshot(doc)
        .filter((o) => o.type === 'sticky')
        .map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.width ?? null,
          height: n.height ?? null,
          color: n.color ?? 'yellow',
          text: n.text,
          z: n.z,
        }));
    },
    getSelectedIds() {
      return getSelectedIds();
    },
    selectedStickyId() {
      const ids = getSelectedIds();
      return ids.length === 1 ? ids[0] : null;
    },
    getCamera() {
      const c = getApi().camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    },
    deleteSticky(id) {
      const doc = getDoc();
      return doc ? deleteObject(doc, id) : false;
    },
    moveSticky(id, x, y) {
      const doc = getDoc();
      return doc ? moveObject(doc, id, x, y) : false;
    },
    bringStickyToFront(id) {
      const doc = getDoc();
      return doc ? bringToFront(doc, id) : false;
    },
    setStickyColor(id, color) {
      const doc = getDoc();
      return doc ? setStickyColor(doc, id, color) : false;
    },
    setStickyText(id, text) {
      const doc = getDoc();
      if (doc === null || !objectsSnapshot(doc).some((n) => n.id === id)) return false;
      getStickyText(doc, id)?.insert(0, text);
      return true;
    },
    connectionDebug() {
      return getConnection()?.debug?.() ?? null;
    },
    dropConnection() {
      getConnection()?.dropNetwork?.();
    },
    restoreConnection() {
      getConnection()?.restoreNetwork?.();
    },
    getGestureEvents() {
      return getGestureEvents?.() ?? { start: 0, end: 0 };
    },
  };
}
