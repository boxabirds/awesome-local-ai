import { useEffect } from "react";
import * as Y from "yjs";
import { isTestMode } from "../canvas/testHooks";
import { snapshot, type StickySnapshot } from "../../shared/board-model";

/**
 * Test-only window: `window.__vidi6Board.notes()` returns the sticky notes
 * exactly as the board model holds them, so an end-to-end test can assert what
 * a gesture wrote to the document and not only what it painted.
 *
 * Installed only in test mode, like `window.__vidi6`. It is read-only.
 */
export interface Vidi6BoardTestApi {
  notes(): readonly StickySnapshot[];
}

declare global {
  interface Window {
    __vidi6Board?: Vidi6BoardTestApi;
  }
}

export function useBoardTestHooks(doc: Y.Doc): void {
  useEffect(() => {
    if (!isTestMode()) return;
    const previous = window.__vidi6Board;
    window.__vidi6Board = { notes: () => snapshot(doc) };
    return () => {
      window.__vidi6Board = previous;
    };
  }, [doc]);
}
