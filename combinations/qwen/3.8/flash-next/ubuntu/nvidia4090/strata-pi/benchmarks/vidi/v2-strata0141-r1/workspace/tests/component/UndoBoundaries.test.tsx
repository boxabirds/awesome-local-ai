// Component tests for story 8: undo boundaries and capture timeout.
// TC-14, TC-15, TC-16, TC-17.

import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { createSticky, getStickyText, moveObject } from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { createPeer, type Peer } from '../unit/helpers/peer';
import {
  changeDoc,
  clickElement,
  docNotes,
  doubleClickElement,
  dragElement,
  editorElement,
  flushFrame,
  noteElement,
  noteOf,
  noteText,
  noteToolbarElement,
  pointerAt,
  pressKey,
  renderBoard,
  resizeHandleElement,
  screenOf,
  typeIntoEditor,
} from './harness';

afterEach(cleanup);

/**
 * A board with a history the test can see. The controller given to `renderBoard`
 * is the one the toolbar and the keys act on, so "undo" here is the board's own
 * undo and not a second one sitting next to it.
 */
function setup(): { doc: Y.Doc; undo: UndoController } {
  const doc = new Y.Doc();
  const undo = createUndo(doc);
  renderBoard({ doc, undo });
  return { doc, undo };
}

interface Placed {
  id: string;
  /** Centre, as a note is placed and pressed. */
  cx: number;
  cy: number;
}

/**
 * The origin a note that was **already on the board** arrives with.
 *
 * `placeNote` writes with it instead of `LOCAL_ORIGIN`, which is how a real board
 * starts: story 4 loads the notes out of storage, and none of them is this
 * person's undo step. It keeps every step these tests assert on a step the test
 * deliberately made.
 */
const PRESENT_ORIGIN: unique symbol = Symbol('already-on-the-board');

function placeNote(doc: Y.Doc, centre: { x: number; y: number }): Placed {
  let id = '';
  changeDoc(() => {
    doc.transact(() => {
      id = createSticky(doc, centre);
    }, PRESENT_ORIGIN);
  });
  return { id, cx: centre.x, cy: centre.y };
}

/** Where a note sits in the document (top-left, world units). */
const pos = (doc: Y.Doc, id: string): { x: number; y: number } => {
  const note = noteOf(doc, id);
  return { x: note.x, y: note.y };
};

/** How big it is: an untouched note carries no explicit size, it is STICKY_SIZE_WORLD. */
const size = (doc: Y.Doc, id: string): { width: number; height: number } => {
  const note = noteOf(doc, id);
  return {
    width: note.width ?? STICKY_SIZE_WORLD,
    height: note.height ?? STICKY_SIZE_WORLD,
  };
};

const box = (doc: Y.Doc, id: string) => ({ ...pos(doc, id), ...size(doc, id) });

function pressNote(note: Placed, additive = false): void {
  const screen = screenOf({ x: note.cx, y: note.cy });
  clickElement(noteElement(note.id), screen.x, screen.y, additive ? { shiftKey: true } : {});
}

/** Press, drag in `steps` moves and release the middle of a note. */
async function dragNote(note: Placed, delta: { x: number; y: number }, steps = 4): Promise<void> {
  const from = screenOf({ x: note.cx, y: note.cy });
  dragElement(noteElement(note.id), from, { x: from.x + delta.x, y: from.y + delta.y }, steps);
  await flushFrame();
}

/**
 * The same drag, slowed down: `delayMs` between pointer moves, so the gesture
 * lasts `steps * delayMs` - longer than the window that groups typing. A gesture
 * is one step for its whole length, not one step per window.
 */
async function dragNoteSlowly(
  note: Placed,
  delta: { x: number; y: number },
  steps: number,
  delayMs: number,
): Promise<void> {
  const from = screenOf({ x: note.cx, y: note.cy });
  pointerAt(noteElement(note.id), 'pointerdown', from.x, from.y);
  for (let step = 1; step <= steps; step += 1) {
    pointerAt(
      noteElement(note.id),
      'pointermove',
      from.x + (delta.x * step) / steps,
      from.y + (delta.y * step) / steps,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  pointerAt(noteElement(note.id), 'pointerup', from.x + delta.x, from.y + delta.y);
  await flushFrame();
}

/** Where a rendered resize handle sits on screen: press its middle. */
function pressHandle(handle: string): { x: number; y: number } {
  const el = resizeHandleElement(handle);
  return { x: Number.parseFloat(el.style.left) + 4, y: Number.parseFloat(el.style.top) + 4 };
}

function dragHandle(handle: string, delta: { x: number; y: number }, steps = 4): void {
  const from = pressHandle(handle);
  dragElement(resizeHandleElement(handle), from, { x: from.x + delta.x, y: from.y + delta.y }, steps);
}

/** Double-click a note open, and focus its textarea the way a click would. */
function openEditor(note: Placed): HTMLElement {
  const screen = screenOf({ x: note.cx, y: note.cy });
  doubleClickElement(noteElement(note.id), screen.x, screen.y);
  const editor = editorElement();
  if (!editor) {
    throw new Error('the note did not open for editing');
  }
  editor.focus();
  return editor;
}

/** A note written on the peer's document and delivered to this one. */
function peerNote(peer: Peer, at: { x: number; y: number }, color?: StickyColor): string {
  return changeDoc2(() => peer.change((doc) => createSticky(doc, at, color)));
}

/** `changeDoc` around a value-returning mutation. */
function changeDoc2<T>(mutation: () => T): T {
  let value: T;
  changeDoc(() => {
    value = mutation();
  });
  return value!;
}

describe('undo.boundaries - one action is one undo step (TC-14)', () => {
  it('TC-14 a drag that wrote on every frame comes back as one step', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    // Thirty pointer moves, each one a write to the document.
    await dragNote(a, { x: 150, y: 90 }, 30);
    expect(pos(doc, a.id)).toEqual({ x: before.x + 150, y: before.y + 90 });
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    expect(pos(doc, a.id)).toEqual(before);
    // One press, one step: nothing else was taken back with it.
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  it('TC-14 a drag that lasts longer than the typing window is still one step', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    // Six moves, 120 ms apart: the gesture lasts 720 ms, well past the 500 ms
    // that groups typing, and it is still one undo.
    await dragNoteSlowly(a, { x: 60, y: 60 }, 6, 120);
    expect(pos(doc, a.id)).toEqual({ x: before.x + 60, y: before.y + 60 });
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    expect(pos(doc, a.id)).toEqual(before);
    expect(undo.canUndo()).toBe(false);
  });

  it('a group drag is one step for every object it moved', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const b = placeNote(doc, { x: 700, y: 420 });
    const before = { a: pos(doc, a.id), b: pos(doc, b.id) };

    pressNote(a);
    pressNote(b, true);
    await dragNote(a, { x: 90, y: 40 }, 8);

    expect(pos(doc, a.id)).toEqual({ x: before.a.x + 90, y: before.a.y + 40 });
    expect(pos(doc, b.id)).toEqual({ x: before.b.x + 90, y: before.b.y + 40 });
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    expect(pos(doc, a.id)).toEqual(before.a);
    expect(pos(doc, b.id)).toEqual(before.b);
    expect(undo.canUndo()).toBe(false);
  });

  it('a press that never crossed the drag threshold is not a step at all', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    const from = screenOf({ x: a.cx, y: a.cy });
    dragElement(noteElement(a.id), from, { x: from.x + DRAG_THRESHOLD_PX - 1, y: from.y }, 1);
    await flushFrame();

    expect(pos(doc, a.id)).toEqual(before);
    expect(undo.canUndo()).toBe(false);
  });
});

describe('undo.boundaries - the order of actions (TC-15)', () => {
  it('a move and then a resize come back one at a time, in order', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const original = box(doc, a.id);

    pressNote(a);
    await dragNote(a, { x: 60, y: 40 }, 5);
    const moved = box(doc, a.id);
    expect(moved).toEqual({ ...original, x: original.x + 60, y: original.y + 40 });

    dragHandle('se', { x: 40, y: 30 }, 4);
    await flushFrame();
    const sized = box(doc, a.id);
    // A sticky note keeps its aspect ratio (story 7), so the corner it was
    // dragged to sets both sides: bigger than it was, and still square.
    expect(sized.width).toBe(moved.width + 40);
    expect(sized.height).toBe(moved.height + 40);

    // The resize goes first, and the note stays where it was moved to.
    expect(undo.undo()).toBe(true);
    expect(box(doc, a.id)).toEqual(moved);

    // Then the move.
    expect(undo.undo()).toBe(true);
    expect(box(doc, a.id)).toEqual(original);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  it('redo puts them back in the order they were made', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const original = box(doc, a.id);

    pressNote(a);
    await dragNote(a, { x: 60, y: 40 }, 4);
    const moved = box(doc, a.id);
    dragHandle('se', { x: 40, y: 30 }, 4);
    await flushFrame();
    const sized = box(doc, a.id);

    undo.undo();
    undo.undo();
    expect(box(doc, a.id)).toEqual(original);

    expect(undo.redo()).toBe(true);
    expect(box(doc, a.id)).toEqual(moved);
    expect(undo.redo()).toBe(true);
    expect(box(doc, a.id)).toEqual(sized);
    expect(sized).not.toEqual(original);
    expect(undo.canRedo()).toBe(false);
  });

  it('TC-15 a drag, and a colour change 200 ms later, are two separate steps', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const original = box(doc, a.id);

    pressNote(a);
    await dragNote(a, { x: 60, y: 30 }, 4);
    const moved = box(doc, a.id);
    expect(moved).toEqual({ ...original, x: original.x + 60, y: original.y + 30 });

    // The colour comes 200 ms after the drag ended - inside the window that
    // groups typing - and it is still its own step, not part of the drag.
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent.click(noteToolbarElement()!.querySelector<HTMLButtonElement>('[data-testid="swatch-pink"]')!);
    await flushFrame();
    expect(noteOf(doc, a.id).color).toBe('pink');

    expect(undo.undo()).toBe(true);
    // The colour went back, and the note stayed where it was dragged to.
    expect(box(doc, a.id)).toEqual(moved);

    expect(undo.undo()).toBe(true);
    expect(box(doc, a.id)).toEqual(original);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  it('a move and a delete are separate steps: undoing the delete does not move the note back', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    pressNote(a);
    await dragNote(a, { x: 60, y: 0 }, 4);
    const moved = pos(doc, a.id);

    pressKey('Delete');
    await flushFrame();
    expect(docNotes(doc).map((note) => note.id)).not.toContain(a.id);

    expect(undo.undo()).toBe(true);
    // The note is back where it was moved to, not where it started.
    expect(pos(doc, a.id)).toEqual(moved);
    expect(moved).not.toEqual(before);
    expect(undo.undo()).toBe(true);
    expect(pos(doc, a.id)).toEqual(before);
  });
});

describe('undo.boundaries - typing (TC-16)', () => {
  it('TC-16 Ctrl+Z in the editor takes back the action from before it was opened', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    await dragNote(a, { x: 70, y: 0 }, 4);
    expect(pos(doc, a.id)).toEqual({ x: before.x + 70, y: before.y });

    const editor = openEditor(a);
    pressKey('z', { ctrl: true });

    // The move is what went back: the history is the board's, not the textarea's.
    expect(pos(doc, a.id)).toEqual(before);
    // And the note is still open for editing.
    expect(editorElement()).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(true);
  });

  it('TC-16 Ctrl+Z takes back the typing, and the editor shows what is true', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    changeDoc(() => {
      // The text is here before the editing session starts, and it is not this
      // person's own step: it arrives the way loaded text does.
      getStickyText(doc, a.id)?.insert(0, 'hello');
    });
    await flushFrame();

    const editor = openEditor(a);
    expect((editor as HTMLTextAreaElement).value).toBe('hello');

    typeIntoEditor(' world');
    await flushFrame();
    expect(noteText(doc, a.id)).toBe('hello world');
    expect(undo.canUndo()).toBe(true);

    pressKey('z', { ctrl: true });
    await flushFrame();
    expect(noteText(doc, a.id)).toBe('hello');
    expect((editorElement() as HTMLTextAreaElement).value).toBe('hello');
    expect(document.activeElement).toBe(editor);
    expect(undo.canUndo()).toBe(false);

    pressKey('y', { ctrl: true });
    await flushFrame();
    expect(noteText(doc, a.id)).toBe('hello world');
  });

  it('typing with a pause in it is two steps, and Ctrl+Z walks them one at a time', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    openEditor(a);

    typeIntoEditor('one');
    await new Promise((resolve) => setTimeout(resolve, 650));
    typeIntoEditor(' two');
    await flushFrame();

    expect(noteText(doc, a.id)).toBe('one two');

    pressKey('z', { ctrl: true });
    await flushFrame();
    expect(noteText(doc, a.id)).toBe('one');
    expect((editorElement() as HTMLTextAreaElement).value).toBe('one');
    expect(undo.canUndo()).toBe(true);

    pressKey('z', { ctrl: true });
    await flushFrame();
    expect(noteText(doc, a.id)).toBe('');
  });

  it('opening a note to type does not join the step that was open before it', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);

    await dragNote(a, { x: 40, y: 40 }, 3);
    openEditor(a);
    typeIntoEditor('text');
    await flushFrame();

    expect(undo.undo()).toBe(true);
    expect(noteText(doc, a.id)).toBe('');
    expect(pos(doc, a.id)).toEqual({ x: before.x + 40, y: before.y + 40 });

    expect(undo.undo()).toBe(true);
    expect(pos(doc, a.id)).toEqual(before);
    expect(undo.canUndo()).toBe(false);
  });
});

describe('undo.boundaries - a change that arrives in the middle', () => {
  it('TC-17 a drag cancelled mid-gesture is one step that restores where it started', async () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    const from = screenOf({ x: a.cx, y: a.cy });

    pressNote(a);
    pointerAt(noteElement(a.id), 'pointerdown', from.x, from.y);
    pointerAt(noteElement(a.id), 'pointermove', from.x + 40, from.y + 20);
    await flushFrame();
    expect(pos(doc, a.id)).toEqual({ x: before.x + 40, y: before.y + 20 });

    // The browser takes the gesture away: pointercancel, and no pointerup after
    // it. The part that was written is one step.
    pointerAt(noteElement(a.id), 'pointercancel', from.x + 40, from.y + 20);
    await flushFrame();

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(pos(doc, a.id)).toEqual(before);
    expect(undo.canUndo()).toBe(false);
  });

  it('a peer change during a drag is left alone by undo', async () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    renderBoard({ doc, undo });
    const peer = createPeer(doc);

    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    const remoteId = peerNote(peer, { x: 700, y: 300 }, 'blue');
    expect(pos(doc, remoteId)).toEqual({ x: 600, y: 200 });

    pressNote(a);
    const from = screenOf({ x: a.cx, y: a.cy });
    pointerAt(noteElement(a.id), 'pointerdown', from.x, from.y);
    pointerAt(noteElement(a.id), 'pointermove', from.x + 30, from.y + 10);
    await flushFrame();

    // Mid-gesture, the peer moves its own note.
    changeDoc(() => {
      peer.change((peerDoc) => moveObject(peerDoc, remoteId, 820, 360));
    });
    await flushFrame();
    expect(pos(doc, remoteId)).toEqual({ x: 820, y: 360 });

    pointerAt(noteElement(a.id), 'pointermove', from.x + 60, from.y + 20);
    pointerAt(noteElement(a.id), 'pointerup', from.x + 60, from.y + 20);
    await flushFrame();

    expect(pos(doc, a.id)).toEqual({ x: before.x + 60, y: before.y + 20 });

    undo.undo();
    expect(pos(doc, a.id)).toEqual(before);
    expect(undo.canUndo()).toBe(false);
    // The peer's note is untouched by this person's undo.
    expect(pos(doc, remoteId)).toEqual({ x: 820, y: 360 });
    expect(docNotes(doc).map((note) => note.id)).toContain(remoteId);
  });

  it('undoing my own change does not remove what someone else added', async () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    renderBoard({ doc, undo });
    const peer = createPeer(doc);

    const theirsId = peerNote(peer, { x: 200, y: 200 }, 'pink');
    const theirs = pos(doc, theirsId);

    const a = placeNote(doc, { x: 400, y: 400 });
    const before = pos(doc, a.id);
    await dragNote(a, { x: 50, y: 50 }, 4);

    undo.undo();
    expect(pos(doc, a.id)).toEqual(before);
    expect(docNotes(doc).map((note) => note.id)).toContain(theirsId);
    expect(pos(doc, theirsId)).toEqual(theirs);
  });
});

describe('undo.boundaries - a note toolbar action is its own step', () => {
  it('a colour change is one step, and undo puts the old colour back', () => {
    const { doc, undo } = setup();
    const a = placeNote(doc, { x: 300, y: 300 });
    pressNote(a);
    const before = noteOf(doc, a.id).color;
    // Selecting a note writes nothing, so there is nothing to undo yet.
    expect(undo.canUndo()).toBe(false);

    fireEvent.click(noteToolbarElement()!.querySelector<HTMLButtonElement>('[data-testid="swatch-pink"]')!);
    expect(noteOf(doc, a.id).color).toBe('pink');
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    expect(noteOf(doc, a.id).color).toBe(before);
    expect(undo.canUndo()).toBe(false);
    // Still selected, so the toolbar is still there to redo from.
    expect(noteToolbarElement()).not.toBeNull();
  });
});
