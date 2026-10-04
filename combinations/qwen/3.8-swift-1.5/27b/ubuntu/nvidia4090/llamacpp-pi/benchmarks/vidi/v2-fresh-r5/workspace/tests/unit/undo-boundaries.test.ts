/**
 * Story 8 — undo.boundaries unit tests for typing-burst grouping
 * (TC-12, TC-13), using a fake clock.
 *
 * Clock note: yjs (via lib0) captures `Date.now` by reference at
 * module-evaluation time, so `vi.useFakeTimers()` / `vi.setSystemTime`
 * (which patch `Date` after module load) cannot control yjs's clock.
 * Instead we stub `Date.now` BEFORE yjs is loaded in this file (Vitest gives
 * each test file a fresh module graph) and import the dependencies
 * dynamically, giving the capture timeout an exactly controllable clock.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

const clock = { t: Date.now() };
const realNow = Date.now;
Date.now = () => clock.t;

let Y: typeof import('yjs');
let bm: typeof import('../../src/shared/board-model');
let undoMod: typeof import('../../src/client/board/undo');

beforeAll(async () => {
  Y = await import('yjs');
  bm = await import('../../src/shared/board-model');
  undoMod = await import('../../src/client/board/undo');
});

afterAll(() => {
  Date.now = realNow;
});

interface Env {
  doc: import('yjs').Doc;
  undo: import('../../src/client/board/undo').UndoController;
  text: import('yjs').Text;
}

function makeEnv(): Env {
  const doc = new Y.Doc();
  bm.initDoc(doc);
  const undo = undoMod.createUndo(doc);
  // Seed the note with a non-local origin (like a load) so the undo stack
  // starts empty.
  const seed = new Y.Doc();
  bm.initDoc(seed);
  const id = bm.createSticky(seed, { x: 0, y: 0 });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), Symbol('seed'));
  seed.destroy();
  const text = bm.getStickyText(doc, id)!;
  return { doc, undo, text };
}

function insert(doc: import('yjs').Doc, text: import('yjs').Text, at: number, ch: string): void {
  doc.transact(() => text.insert(at, ch), bm.LOCAL_ORIGIN);
}

// ─── TC-12: keystrokes 100 ms apart → one step ─────────────────────────────
describe('TC-12: typing bursts merge within the capture timeout', () => {
  it('keystrokes 100 ms apart between boundaries → exactly one undo step; undo removes the whole burst', () => {
    const { doc, undo, text } = makeEnv();

    insert(doc, text, 0, 'a');
    clock.t += 100;
    insert(doc, text, 1, 'b');
    clock.t += 100;
    insert(doc, text, 2, 'c');
    undo.boundary();

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // Exactly one step: nothing left to undo.
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});

// ─── TC-13: boundary values of the typing pause ────────────────────────────
describe('TC-13: pause exactly UNDO_CAPTURE_TIMEOUT_MS vs one ms less', () => {
  it(`pause exactly ${UNDO_CAPTURE_TIMEOUT_MS} ms → two steps`, () => {
    const { doc, undo, text } = makeEnv();

    insert(doc, text, 0, 'a');
    clock.t += UNDO_CAPTURE_TIMEOUT_MS;
    insert(doc, text, 1, 'b');
    undo.boundary();

    // Two steps: first undo removes only the second character.
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it(`pause ${UNDO_CAPTURE_TIMEOUT_MS - 1} ms → one step`, () => {
    const { doc, undo, text } = makeEnv();

    insert(doc, text, 0, 'a');
    clock.t += UNDO_CAPTURE_TIMEOUT_MS - 1;
    insert(doc, text, 1, 'b');
    undo.boundary();

    // One step: a single undo removes the whole burst.
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });
});

// ─── Error path: boundary on an empty stack is a no-op ─────────────────────
describe('boundary on an empty stack', () => {
  it('is a no-op and never throws', () => {
    const { undo } = makeEnv();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });
});
