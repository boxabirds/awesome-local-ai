import { describe, it, expect, afterEach, beforeAll } from 'vitest';

/**
 * yjs's UndoManager reads its clock through lib0/time.getUnixTime, which is
 * a reference to Date.now captured when the lib0 module loads. To drive the
 * capture-timeout logic deterministically, this file patches Date.now
 * before any yjs module is loaded (dynamic imports in beforeAll) and then
 * controls time through `clock.now`.
 */
import type * as YTypes from 'yjs';
import type { UndoController } from '../../src/client/board/undo';

const clock = { now: 0 };

let Y: typeof import('yjs');
let boardModel: typeof import('../../src/shared/board-model');
let undoMod: typeof import('../../src/client/board/undo');
let configMod: typeof import('../../src/shared/config');

beforeAll(async () => {
  Date.now = () => clock.now;
  [Y, boardModel, undoMod, configMod] = await Promise.all([
    import('yjs'),
    import('../../src/shared/board-model'),
    import('../../src/client/board/undo'),
    import('../../src/shared/config'),
  ]);
});

const T0 = new Date('2025-06-01T12:00:00Z').getTime();

let controllers: UndoController[] = [];

function track(undo: UndoController): UndoController {
  controllers.push(undo);
  return undo;
}

afterEach(() => {
  for (const undo of controllers) undo.destroy();
  controllers = [];
  clock.now = 0;
});

/**
 * Type one character into a sticky's Y.Text with LOCAL_ORIGIN at the
 * given (mock) time.
 */
function typeChar(doc: YTypes.Doc, id: string, char: string, at: number): void {
  clock.now = at;
  const text = boardModel.getStickyText(doc, id)!;
  doc.transact(() => {
    text.insert(text.length, char);
  }, boardModel.LOCAL_ORIGIN);
}

describe('undo.boundaries: typing bursts group by the capture timeout', () => {
  // TC-12: keystrokes 100 ms apart between boundaries → exactly one step
  it('TC-12: keystrokes 100 ms apart are one undo step; undo removes the whole burst', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    boardModel.initDoc(doc);
    const undo = track(undoMod.createUndo(doc));

    const id = boardModel.createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    typeChar(doc, id, 'a', T0 + 1000);
    typeChar(doc, id, 'b', T0 + 1100);
    typeChar(doc, id, 'c', T0 + 1200);
    undo.boundary();

    const text = boardModel.getStickyText(doc, id)!;
    expect(text.toString()).toBe('abc');

    // The burst is exactly one step: a single undo removes all three
    // characters (a two-keystroke burst would leave characters behind).
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // The only remaining step is the note creation itself
    expect(undo.undo()).toBe(true);
    expect(boardModel.getStickyText(doc, id)).toBeUndefined();
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13: pause exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; −1 ms → one step
  it('TC-13a: a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    boardModel.initDoc(doc);
    const undo = track(undoMod.createUndo(doc));

    const id = boardModel.createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    typeChar(doc, id, 'a', T0 + 1000);
    typeChar(doc, id, 'b', T0 + 1000 + configMod.UNDO_CAPTURE_TIMEOUT_MS);
    undo.boundary();

    const text = boardModel.getStickyText(doc, id)!;
    expect(text.toString()).toBe('ab');

    // Two steps: the first undo removes only the second character
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
  });

  it('TC-13b: a pause of UNDO_CAPTURE_TIMEOUT_MS − 1 ms stays one step', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    boardModel.initDoc(doc);
    const undo = track(undoMod.createUndo(doc));

    const id = boardModel.createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    typeChar(doc, id, 'a', T0 + 1000);
    typeChar(doc, id, 'b', T0 + 1000 + configMod.UNDO_CAPTURE_TIMEOUT_MS - 1);
    undo.boundary();

    const text = boardModel.getStickyText(doc, id)!;
    expect(text.toString()).toBe('ab');

    // One step: a single undo removes both characters
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // The next step is the note creation
    expect(undo.undo()).toBe(true);
    expect(boardModel.getStickyText(doc, id)).toBeUndefined();
  });

  // Error path: boundary() on an empty stack is a no-op
  it('boundary() on an empty stack is a no-op', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    boardModel.initDoc(doc);
    const undo = track(undoMod.createUndo(doc));

    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });
});
