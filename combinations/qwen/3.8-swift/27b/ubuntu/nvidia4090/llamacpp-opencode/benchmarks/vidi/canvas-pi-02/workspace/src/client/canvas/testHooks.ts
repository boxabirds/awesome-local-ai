// Test-only hooks, installed only in builds made with `--mode test`.
// Production builds never expose window.__vidi6.

import type * as Y from 'yjs';
import type { BoardConnection } from '../sync/connectBoard';
import type { CameraApi } from './useCamera';
import {
  bringToFront,
  createSticky,
  deleteObject,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface Vidi6TestApi {
  /** Current connection badge state (story 3): connecting | connected |
   *  reconnecting | confirmed. */
  readonly connectionState: string;
  setCamera(x: number, y: number, zoom: number): void;
  /** Creates a sticky centred on a world point; returns its id (or null). */
  createSticky(x: number, y: number, color?: string): string | null;
  /** Current sticky snapshots (id, position, colour, text, stacking). */
  getStickyNotes(): Array<{ id: string; x: number; y: number; color: string; text: string; z: number }>;
  /** Id of the currently selected note, or null. */
  selectedStickyId(): string | null;
  deleteSticky(id: string): boolean;
  moveSticky(id: string, x: number, y: number): boolean;
  bringStickyToFront(id: string): boolean;
  setStickyColor(id: string, color: string): boolean;
  /** Simulates a network drop for this client (badge → Reconnecting…). */
  dropConnection(): void;
  /** Restores the network, letting the client reconnect. */
  restoreConnection(): void;
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
  getSelectedId: () => string | null,
): void {
  if (import.meta.env.MODE !== 'test') return;
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
      return snapshot(doc).map((n) => ({ id: n.id, x: n.x, y: n.y, color: n.color, text: n.text, z: n.z }));
    },
    selectedStickyId() {
      return getSelectedId();
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
    dropConnection() {
      getConnection()?.dropNetwork?.();
    },
    restoreConnection() {
      getConnection()?.restoreNetwork?.();
    },
  };
}
