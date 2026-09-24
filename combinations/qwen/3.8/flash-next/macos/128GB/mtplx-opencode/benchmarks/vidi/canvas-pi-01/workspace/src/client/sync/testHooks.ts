/**
 * Story 3 · test-only browser hook for live sync.
 *
 * Exposes the pieces the e2e suite needs to assert on collaboration without
 * reading React internals: the current `connectionState` (TC-29/TC-30 assert it
 * never leaves `connected`), a plain `snapshot()` of the board (for the
 * "identical final snapshot" assertions), and a `waitForStableDoc()` that
 * resolves once the document has stopped changing for a short window — the
 * deterministic stand-in for "everyone has converged".
 *
 * These live under `window.__vidi6Live` rather than `window.__vidi6` so they
 * never clobber the camera hook in `canvas/testHooks.ts` (which rewrites
 * `__vidi6` on every render). Like that hook, the whole effect body is dead
 * code outside `MODE === 'test'`.
 */
import { useEffect } from 'react';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../shared/board-model';
import { isTestMode } from '../canvas/testHooks';

declare global {
  interface Window {
    __vidi6Live?: {
      connectionState: () => string;
      snapshot: () => unknown;
      waitForStableDoc: (stableMs?: number, timeoutMs?: number) => Promise<unknown>;
      /**
       * Build a board of `count` notes in one go, each in its own transaction
       * (so the update log grows the way a real busy board's does). Used by the
       * story 4 tests that need a board worth compacting; returns the snapshot.
       */
      seedNotes: (count: number, seed?: number) => unknown;
    };
  }
}

function boardFingerprint(doc: Y.Doc): unknown {
  // A short structural fingerprint of the board, compared by the test to decide
  // two boards have converged (same ids, positions, colours, text).
  return snapshot(doc).map((note) => ({
    id: note.id,
    x: note.x,
    y: note.y,
    color: note.color,
    z: note.z,
    text: note.text,
  }));
}

export function useLiveTestHooks(doc: Y.Doc, connectionState: string): void {
  useEffect(() => {
    if (!isTestMode() || typeof window === 'undefined') return;
    const snapshotOf = () => boardFingerprint(doc);
    const seedNotes = (count: number, seed = 1) => {
      // Deterministic pseudo-random layout, one transaction per note.
      let state = seed >>> 0 || 1;
      const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
      };
      for (let i = 0; i < count; i += 1) {
        createSticky(doc, { x: (random() - 0.5) * 4000, y: (random() - 0.5) * 4000 });
      }
      return boardFingerprint(doc);
    };
    // Re-installed on every render (no dependency list) so `connectionState`
    // is always the current value when the e2e helper reads it back.
    window.__vidi6Live = {
      connectionState: () => connectionState,
      snapshot: snapshotOf,
      seedNotes,
      waitForStableDoc: (stableMs = 600, timeoutMs = 8000) =>
        new Promise<unknown>((resolve, reject) => {
          const pollMs = 100;
          let previous = JSON.stringify(snapshotOf());
          let stableFor = 0;
          const started = Date.now();
          const timer = setInterval(() => {
            const current = JSON.stringify(snapshotOf());
            if (current === previous) {
              stableFor += pollMs;
              if (stableFor >= stableMs) {
                clearInterval(timer);
                resolve(JSON.parse(current));
                return;
              }
            } else {
              stableFor = 0;
              previous = current;
            }
            if (Date.now() - started > timeoutMs) {
              clearInterval(timer);
              reject(new Error('waitForStableDoc: document never became stable'));
            }
          }, pollMs);
        }),
    };
  });
}