import * as Y from 'yjs';
import type { Camera } from './camera';
import type { StickySnapshot } from '@/shared/board-model';

declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
      getCamera: () => Camera;
      /** Story 2: snapshot of the board's sticky notes (test mode only). */
      getNotes: () => readonly StickySnapshot[];
      /** Story 2: the board's Y.Doc, for model calls from tests (test mode only). */
      getDoc: () => Y.Doc;
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
    };
  }
}

let testSetCamera: ((cam: Camera) => void) | null = null;
let testGetCamera: (() => Camera) | null = null;
let testGetNotes: (() => readonly StickySnapshot[]) | null = null;
let testGetDoc: (() => Y.Doc) | null = null;
let testConn: { drop: () => void; resume: () => void } | null = null;

/** Registers the live connection's drop/resume handles (story 3 tests). */
export function registerConnectionTestHook(conn: { drop: () => void; resume: () => void }): void {
  testConn = conn;
  if (window.__vidi6) {
    window.__vidi6.dropConnection = conn.drop;
    window.__vidi6.resumeConnection = conn.resume;
  }
}

export function registerTestHooks(setCamera: (cam: Camera) => void, getCamera: () => Camera): void {
  testSetCamera = setCamera;
  testGetCamera = getCamera;
}

/** Registers a supplier for the board notes (story 2). */
export function registerBoardTestHooks(getNotes: () => readonly StickySnapshot[], getDoc: () => Y.Doc): void {
  testGetNotes = getNotes;
  testGetDoc = getDoc;
}

export function initGlobalTestHooks(): void {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera: (cam: Camera) => testSetCamera?.(cam),
      getCamera: () => testGetCamera?.() ?? { x: 0, y: 0, zoom: 1 },
      getNotes: () => (testGetNotes ? testGetNotes() : []),
      getDoc: () => {
        if (!testGetDoc) throw new Error('board test hooks not registered');
        return testGetDoc();
      },
      connectionState: 'connecting',
      // Dynamic wrappers: pick up the connection registered after init (React
      // effect ordering) and follow reconnections.
      dropConnection: () => testConn?.drop(),
      resumeConnection: () => testConn?.resume(),
    };
  }
}
