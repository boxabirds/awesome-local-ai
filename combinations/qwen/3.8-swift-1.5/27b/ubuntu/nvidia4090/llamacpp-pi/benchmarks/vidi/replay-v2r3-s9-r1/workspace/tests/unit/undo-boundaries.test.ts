/**
 * Story 8 — undo step boundaries (unit, PRD undo.boundaries / undo.history).
 *
 * The capture window is driven by `lib0/time.getUnixTime`, which yjs binds by
 * reference at module load — so it must be replaced through a module mock
 * (vitest `server.deps.inline` makes yjs/lib0 go through the module graph).
 *
 *   TC-12  a burst of local transactions (one per "frame") between two
 *          boundary() calls is exactly one undo step; the undo removes the
 *          whole burst.
 *   TC-13  a local transaction exactly UNDO_CAPTURE_TIMEOUT_MS after the
 *          previous one starts a new step; one ms earlier it merges.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import * as time from 'lib0/time';
import {
  initDoc,
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof time>();
  return { ...actual, getUnixTime: vi.fn(() => actual.getUnixTime()) };
});

const fakeNow = { t: 1_000_000 };

function advance(ms: number): void {
  fakeNow.t += ms;
}

describe('story 8 — undo step boundaries (unit)', () => {
  beforeEach(() => {
    fakeNow.t = 1_000_000;
    vi.mocked(time.getUnixTime).mockImplementation(() => fakeNow.t);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function typingDoc(): { doc: Y.Doc; text: Y.Text; undo: ReturnType<typeof createUndo> } {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 }) as string;
    const text = getStickyText(doc, id)!;
    const undo = createUndo(doc); // created after the seed: nothing tracked yet
    return { doc, text, undo };
  }

  it('TC-12: a burst of local transactions between boundaries is one undo step', () => {
    const { doc, text, undo } = typingDoc();
    undo.boundary();

    // One "frame" per character, 100 ms apart — like live-typed text.
    for (const ch of ['h', 'e', 'l', 'l', 'o']) {
      transactInsert(doc, text, ch);
      advance(100);
    }
    undo.boundary();

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13: exactly UNDO_CAPTURE_TIMEOUT_MS apart → new step; one ms earlier → merged', () => {
    // Exactly the capture timeout: two steps.
    {
      const { doc, text, undo } = typingDoc();
      transactInsert(doc, text, 'a');
      advance(UNDO_CAPTURE_TIMEOUT_MS);
      transactInsert(doc, text, 'b');
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('a');
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('');
    }
    // One ms inside the window: one step.
    {
      const { doc, text, undo } = typingDoc();
      transactInsert(doc, text, 'a');
      advance(UNDO_CAPTURE_TIMEOUT_MS - 1);
      transactInsert(doc, text, 'b');
      expect(undo.undo()).toBe(true);
      expect(text.toString()).toBe('');
      expect(undo.canUndo()).toBe(false);
    }
  });

  it('boundary() on an empty history is a no-op (PRD undo.empty, error path)', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    expect(() => {
      undo.boundary();
      undo.boundary();
    }).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

function transactInsert(doc: Y.Doc, text: Y.Text, ch: string): void {
  // A local, origin-stamped insertion: exactly what the editor's commit does.
  doc.transact(() => {
    text.insert(text.length, ch);
  }, LOCAL_ORIGIN);
}
