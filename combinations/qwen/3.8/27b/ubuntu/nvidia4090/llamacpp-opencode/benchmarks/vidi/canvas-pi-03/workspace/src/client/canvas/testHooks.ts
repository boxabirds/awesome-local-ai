import * as Y from 'yjs';
import type { Camera } from './camera';
import type { ObjectSnapshot, StickySnapshot } from '@/shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      getCamera: () => Camera;
      /** Story 2: snapshot of the board's sticky notes (test mode only). */
      getNotes: () => readonly StickySnapshot[];
      /** Story 2: the board's Y.Doc, for model calls from tests (test mode only). */
      getDoc: () => Y.Doc;
      /** Story 7: the local selection's object ids (test mode only). */
      getSelection: () => string[];
      /** Story 9: snapshot of ALL board objects, any type (test mode only). */
      getObjects: () => readonly ObjectSnapshot[];
      /**
       * Story 3: the current connection state, kept up to date by App
       * ('connecting' | 'connected' | 'reconnecting' | 'confirmed').
       */
      connectionState: string;
      /**
       * Story 3 (test): drop the live connection to simulate a Wi-Fi outage.
       * (Playwright `setOffline` and `ws.close()` do not reliably tear down the
       * already-open socket against the local workerd server.)
       */
      dropConnection: () => void;
      /** Story 3 (test): resume the connection to simulate the network returning. */
      resumeConnection: () => void;
      /**
       * Story 4 (test): apply base64 Yjs updates to the board doc. Updates
       * applied with a non-provider origin are pushed to the room and
       * persisted, so tests can seed a board quickly (e2e TC-19/TC-21).
       */
      applyUpdates: (updates: string[]) => void;
      /**
       * Story 8 (test): whether the local per-user undo stack is non-empty.
       */
      canUndo: () => boolean;
      /** Story 8 (test): whether the local redo stack is non-empty. */
      canRedo: () => boolean;
      /** Story 8 (test): undo one own step; false when the stack is empty. */
      undo: () => boolean;
      /** Story 8 (test): redo one own step; false when the stack is empty. */
      redo: () => boolean;
      /** Story 8 (test): close the current capture window. */
      undoBoundary: () => void;
    };
  }
}

let testSetCamera: ((cam: Camera) => void) | null = null;
let testGetCamera: (() => Camera) | null = null;
let testGetNotes: (() => readonly StickySnapshot[]) | null = null;
let testGetDoc: (() => Y.Doc) | null = null;
let testGetSelection: (() => string[]) | null = null;
let testGetObjects: (() => readonly ObjectSnapshot[]) | null = null;
let testConn: { drop: () => void; resume: () => void } | null = null;
let testUndo: {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
  boundary: () => void;
} | null = null;

/** Registers the live connection's drop/resume handles (story 3 tests). */
export function registerConnectionTestHook(conn: { drop: () => void; resume: () => void }): void {
  testConn = conn;
  if (window.__vidi6) {
    window.__vidi6.dropConnection = conn.drop;
    window.__vidi6.resumeConnection = conn.resume;
  }
}

/** Registers the local per-user undo controller (story 8 tests). */
export function registerUndoTestHooks(undo: {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => boolean;
  redo: () => boolean;
  boundary: () => void;
}): void {
  testUndo = undo;
}

export function registerTestHooks(setCamera: (cam: Camera) => void, getCamera: () => Camera): void {
  testSetCamera = setCamera;
  testGetCamera = getCamera;
}

/** Registers suppliers for the board notes/doc/selection (stories 2/7/9). */
export function registerBoardTestHooks(
  getNotes: () => readonly StickySnapshot[],
  getDoc: () => Y.Doc,
  getSelection: () => string[],
  getObjects?: () => readonly ObjectSnapshot[],
): void {
  testGetNotes = getNotes;
  testGetDoc = getDoc;
  testGetSelection = getSelection;
  testGetObjects = getObjects ?? null;
}

export function initGlobalTestHooks(): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera: (cam: Camera) => testSetCamera?.(cam),
      getCamera: () => testGetCamera?.() ?? { x: 0, y: 0, zoom: 1 },
      getNotes: () => (testGetNotes ? testGetNotes() : []),
      getSelection: () => (testGetSelection ? testGetSelection() : []),
      getObjects: () => (testGetObjects ? testGetObjects() : []),
      getDoc: () => {
        if (!testGetDoc) throw new Error('board test hooks not registered');
        return testGetDoc();
      },
      applyUpdates: (updates: string[]) => {
        if (!testGetDoc) return;
        const doc = testGetDoc();
        for (const b64 of updates) {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          Y.applyUpdate(doc, bytes, 'e2e-seed');
        }
      },
      // Story 8: dynamic wrappers read the controller registered by Board.
      canUndo: () => testUndo?.canUndo() ?? false,
      canRedo: () => testUndo?.canRedo() ?? false,
      undo: () => (testUndo ? testUndo.undo() : false),
      redo: () => (testUndo ? testUndo.redo() : false),
      undoBoundary: () => testUndo?.boundary(),
      connectionState: 'connecting',
      // Dynamic wrappers: pick up the connection registered after init (React
      // effect ordering) and follow reconnections.
      dropConnection: () => testConn?.drop(),
      resumeConnection: () => testConn?.resume(),
    };
  }
}
