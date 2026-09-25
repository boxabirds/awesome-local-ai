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
    };
  }
}

let testSetCamera: ((cam: Camera) => void) | null = null;
let testGetCamera: (() => Camera) | null = null;
let testGetNotes: (() => readonly StickySnapshot[]) | null = null;
let testGetDoc: (() => Y.Doc) | null = null;

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
    };
  }
}
