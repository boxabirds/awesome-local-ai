/**
 * Moving and resizing what is selected (`sel.transform`).
 *
 * TC-23 press an unselected object while another is selected
 * TC-24 resize a type whose proportions are not locked, and force them with Shift
 * TC-25 a board that failed to load refuses every gesture that would write
 * TC-26 one gesture is announced as beginning once, and as ending once
 * TC-27 (story 9) a resize of a type whose height its content decides
 * plus the two things the browser suite proves at scale, checked here in miniature: a
 * group moves as one arrangement, and a group resize scales the gaps with the objects.
 *
 * Pointer positions are computed from the camera rather than written by hand, because
 * the board opens with the world origin in the middle of the window.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LOCAL_ORIGIN, objectSnapshots } from '../../src/shared/board-model';
import { createText, getText, type TextSnapshot } from '../../src/shared/objects/text';
import { worldToScreen, type Point } from '../../src/client/canvas/camera';
import {
  createTestBox,
  registerTestBox,
  TESTBOX_HEIGHT_WORLD,
  TESTBOX_SIZE_WORLD,
} from '../fixtures/testbox';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

/** Screen point for a world point, with the camera the board opens with. */
const at = (board: StickyAppHandle, world: Point) => worldToScreen(board.camera(), world);

/** What the document says about one piece of text. */
const textOf = (doc: Y.Doc, id: string): TextSnapshot => {
  const found = objectSnapshots(doc).find((object) => object.id === id);
  if (!found) throw new Error('the text is not in the document');
  return found as TextSnapshot;
};

/** Drag an object by a screen delta, in three steps a real pointer makes. */
async function dragBy(
  board: StickyAppHandle,
  target: Node,
  from: Point,
  dx: number,
  dy: number,
  init: { shift?: boolean } = {},
): Promise<void> {
  await board.press(target, from.x, from.y, init);
  await board.moveTo(from.x + dx / 2, from.y + dy / 2);
  await board.moveTo(from.x + dx, from.y + dy);
  await board.release(from.x + dx, from.y + dy);
}

describe('sel.transform: moving', () => {
  it('TC-23 pressing an unselected object selects it alone and moves only it', async () => {
    const board = await renderStickyApp();
    await board.addNote({ x: 0, y: 0 });
    const moved = await board.addNote({ x: 400, y: 0 });
    const still = board.noteIds().find((id) => id !== moved)!;

    // Select the first note.
    const first = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    expect(board.selectedIds()).toEqual([still]);

    // Press and drag the other one: the selection follows the pointer, and the note
    // that was selected stays where it was.
    const before = board.notes().map((note) => ({ id: note.id, x: note.x }));
    await dragBy(board, board.note(1), at(board, { x: 400, y: 0 }), 90, 40);

    expect(board.selectedIds()).toEqual([moved]);
    const after = board.notes().map((note) => ({ id: note.id, x: note.x }));
    expect(after.find((note) => note.id === moved)!.x).toBeCloseTo(
      before.find((note) => note.id === moved)!.x + 90,
      5,
    );
    expect(after.find((note) => note.id === still)!.x).toBe(
      before.find((note) => note.id === still)!.x,
    );
  });

  it('a group moves by one distance, keeping the arrangement inside it', async () => {
    const board = await renderStickyApp();
    const spots = [
      { x: 0, y: 0 },
      { x: 300, y: 120 },
      { x: 120, y: 320 },
    ];
    const ids: string[] = [];
    for (const spot of spots) ids.push(await board.addNote(spot));

    // Select all three with the keyboard, then drag one of them.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    });
    expect(board.selectedIds()).toHaveLength(3);

    const before = new Map(board.notes().map((note) => [note.id, { x: note.x, y: note.y }]));
    await dragBy(board, board.note(0), at(board, spots[0]!), 150, -60);

    for (const id of ids) {
      const was = before.get(id)!;
      const now = board.notes().find((note) => note.id === id)!;
      // Every note moved by exactly the drag, so the space between them is what it was.
      expect(now.x).toBeCloseTo(was.x + 150, 5);
      expect(now.y).toBeCloseTo(was.y - 60, 5);
    }
  });

  it('a dragged group is raised above what it passes, keeping its own order', async () => {
    const board = await renderStickyApp();
    for (const spot of [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 900, y: 0 }]) {
      await board.addNote(spot);
    }
    const ids = board.noteIds();
    const first = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    await board.press(board.note(1), at(board, { x: 300, y: 0 }).x, at(board, { x: 300, y: 0 }).y, {
      shift: true,
    });
    await board.release(at(board, { x: 300, y: 0 }).x, at(board, { x: 300, y: 0 }).y);

    // Drag them past the third note.
    await dragBy(board, board.note(0), at(board, { x: 0, y: 0 }), 900, 0);

    // Stacking order, lowest first.
    const order = board.noteElements().map((element) => element.dataset.noteId);
    // The note they passed is underneath both, and the two moved ones kept their own
    // order between themselves.
    expect(order).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('TC-26 a drag is announced once, and ends once, whatever the pointer does', async () => {
    const board = await renderStickyApp();
    await board.addNote({ x: 0, y: 0 });
    const transforming = () => document.querySelector('.app')?.className.includes('transform--active');
    const centre = at(board, { x: 0, y: 0 });

    // A click is not a gesture: nothing flashes.
    await board.press(board.note(0), centre.x, centre.y);
    expect(transforming()).toBe(false);
    await board.moveTo(centre.x + 2, centre.y);
    expect(transforming()).toBe(false);
    await board.release(centre.x + 2, centre.y);
    expect(transforming()).toBe(false);

    // A drag: on when it crosses the threshold, and it stays on across further moves.
    await board.press(board.note(0), centre.x, centre.y);
    await board.moveTo(centre.x + 30, centre.y);
    expect(transforming()).toBe(true);
    await board.moveTo(centre.x + 60, centre.y + 20);
    expect(transforming()).toBe(true);
    await board.moveTo(centre.x + 90, centre.y + 20);
    expect(transforming()).toBe(true);
    await board.release(centre.x + 90, centre.y + 20);
    expect(transforming()).toBe(false);

    // While it was transforming the bar was hidden, and it comes back after.
    expect(board.selectionBar()).not.toBeNull();
  });

  it('a drag that is interrupted keeps the position it last showed', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    const centre = at(board, { x: 0, y: 0 });
    const before = board.notes().find((note) => note.id === id)!;

    await board.press(board.note(0), centre.x, centre.y);
    await board.moveTo(centre.x + 70, centre.y);
    const during = board.notes().find((note) => note.id === id)!;
    expect(during.x).toBeCloseTo(before.x + 70, 5);

    await board.cancel();
    const after = board.notes().find((note) => note.id === id)!;
    expect(after.x).toBeCloseTo(during.x, 5);
  });
});

describe('sel.transform: resizing', () => {
  beforeEach(() => {
    registerTestBox();
  });

  it('TC-27 a piece of text dragged sideways keeps its top, and its lines set its height', async () => {
    // Story 9 asks a question story 5 never had to answer: what does a resize do to a type
    // whose height belongs to its content? The width is the person's, the height is the
    // words', and neither of them is the number the drag multiplied.
    const board = await renderStickyApp();
    const id = createText(board.doc, { x: 0, y: 0 }, 'someone')!;
    await advanceFrames();
    await act(async () => {
      board.doc.transact(() => {
        getText(board.doc, id)?.insert(0, 'Ship the release notes before Friday standup');
      }, LOCAL_ORIGIN);
    });
    await advanceFrames();
    const before = textOf(board.doc, id);

    const point = at(board, { x: 4, y: 4 });
    await board.press(screen.getByTestId('text-object'), point.x, point.y);
    await board.release(point.x, point.y);
    // Only the two handles that can change a width — and nothing that changes a height.
    expect(board.handles().map((handle) => handle.dataset.handle).sort()).toEqual(['e', 'w']);

    // Narrow the column by half the width of the words: they have nowhere to go but down.
    const grab = at(board, { x: before.width, y: before.height / 2 });
    await dragBy(board, board.handle('e')!, grab, -160, 0);

    const after = textOf(board.doc, id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 160, 5);
    expect(after.height).toBeGreaterThan(before.height);
    // A mid-right handle is anchored on its right edge, so the top edge is the one that
    // must not move: a box that jumped upwards as it wrapped would take the words away
    // from the place they were written at.
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('TC-24 an edge handle of a type with free proportions changes that dimension only', async () => {
    const board = await renderStickyApp();
    await act(async () => {
      createTestBox(board.doc, 0, 0);
    });
    await advanceFrames();

    const box = board.objectElements().find((el) => el.dataset.objectId)!;
    await board.press(box, at(board, { x: 100, y: 100 }).x, at(board, { x: 100, y: 100 }).y);
    await board.release(at(board, { x: 100, y: 100 }).x, at(board, { x: 100, y: 100 }).y);
    expect(board.handles()).toHaveLength(8);

    // The east handle: 60 screen pixels further out. The box is 240x120, so its right
    // edge is at x=240 and its middle at y=60.
    const handle = board.handle('e');
    expect(handle).not.toBeNull();
    const grab = at(board, { x: TESTBOX_SIZE_WORLD, y: TESTBOX_HEIGHT_WORLD / 2 });
    await dragBy(board, handle!, grab, 60, 0);

    const after = board.objectElements()[0]!;
    expect(Number(after.dataset.boxWidth)).toBeCloseTo(TESTBOX_SIZE_WORLD + 60, 5);
    expect(Number(after.dataset.boxHeight)).toBeCloseTo(TESTBOX_HEIGHT_WORLD, 5);
  });

  it('TC-24 Shift forces the ratio, even for a type whose proportions are free', async () => {
    const board = await renderStickyApp();
    await act(async () => {
      createTestBox(board.doc, 0, 0);
    });
    await advanceFrames();

    const box = board.objectElements()[0]!;
    await board.press(box, at(board, { x: 100, y: 100 }).x, at(board, { x: 100, y: 100 }).y);
    await board.release(at(board, { x: 100, y: 100 }).x, at(board, { x: 100, y: 100 }).y);

    const grab = at(board, { x: TESTBOX_SIZE_WORLD, y: TESTBOX_HEIGHT_WORLD / 2 });
    await dragBy(board, board.handle('e')!, grab, 60, 0, { shift: true });

    const after = board.objectElements()[0]!;
    const width = Number(after.dataset.boxWidth);
    const height = Number(after.dataset.boxHeight);
    expect(width).toBeCloseTo(TESTBOX_SIZE_WORLD + 60, 5);
    // 240x120 is 2:1, and 300x150 is 2:1.
    expect(width / height).toBeCloseTo(TESTBOX_SIZE_WORLD / TESTBOX_HEIGHT_WORLD, 5);
  });

  it('a sticky note stays square, because its type says the proportions are locked', async () => {
    const board = await renderStickyApp();
    await board.addNote({ x: 0, y: 0 });
    const centre = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), centre.x, centre.y);
    await board.release(centre.x, centre.y);

    const corner = at(board, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
    await dragBy(board, board.handle('se')!, corner, 40, 0);

    const after = board.notes()[0]!;
    expect(after.width).toBeCloseTo(after.height, 5);
    expect(after.width).toBeGreaterThan(STICKY_SIZE_WORLD);
  });

  it('a group resize scales the gaps between objects as well as their sizes', async () => {
    const board = await renderStickyApp();
    await board.addNote({ x: 0, y: 0 });
    await board.addNote({ x: 500, y: 0 });
    const first = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    const second = at(board, { x: 500, y: 0 });
    await board.press(board.note(1), second.x, second.y, { shift: true });
    await board.release(second.x, second.y);
    expect(board.selectedIds()).toHaveLength(2);

    const before = board.notes().map((note) => ({ x: note.x, width: note.width }));
    // The bounding box runs from -100 to 600: 700 wide. Grow the east edge by 700, so
    // the box doubles and everything inside it, gaps included, doubles with it.
    const corner = at(board, { x: 600, y: 0 });
    await dragBy(board, board.handle('e')!, corner, 700, 0);

    const after = board.notes().map((note) => ({ x: note.x, width: note.width }));
    expect(after[0]!.width).toBeCloseTo(before[0]!.width * 2, 3);
    expect(after[1]!.width).toBeCloseTo(before[1]!.width * 2, 3);
    const gapBefore = before[1]!.x - (before[0]!.x + before[0]!.width);
    const gapAfter = after[1]!.x - (after[0]!.x + after[0]!.width);
    expect(gapAfter).toBeCloseTo(gapBefore * 2, 3);
  });

  it('nothing shrinks below the minimum its type sets, and the group stops with it', async () => {
    const board = await renderStickyApp();
    await board.addNote({ x: 0, y: 0 });
    await board.addNote({ x: 400, y: 0 });
    const first = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    const second = at(board, { x: 400, y: 0 });
    await board.press(board.note(1), second.x, second.y, { shift: true });
    await board.release(second.x, second.y);

    // Push the west edge far to the right: the two notes would vanish.
    const corner = at(board, { x: -100, y: 0 });
    await dragBy(board, board.handle('w')!, corner, 1200, 0);

    for (const note of board.notes()) {
      expect(note.width).toBeGreaterThanOrEqual(50 - 0.001);
      expect(note.height).toBeGreaterThanOrEqual(50 - 0.001);
    }
    // Both stopped at the same scale, so the arrangement is still an arrangement.
    const [a, b] = board.notes();
    expect(a!.width).toBeCloseTo(b!.width, 3);
  });

  it('TC-25 a board that could not be loaded refuses the gestures that would write', async () => {
    const socket = installFakeWebSocket();
    const board = await renderStickyApp(new Y.Doc(), 'board-under-test');
    const id = await board.addNote({ x: 0, y: 0 });

    // The room sends the object out of storage and refuses to hand over this board.
    await socket.refuseLoad();
    expect(screen.getByTestId('connection-status').textContent).toContain("couldn't be loaded");

    // Looking and selecting are still allowed: there is something on the screen, and
    // the person has to be able to see what they are being told they cannot edit.
    const centre = at(board, { x: 0, y: 0 });
    await board.press(board.note(0), centre.x, centre.y);
    await board.release(centre.x, centre.y);
    expect(board.selectedIds()).toEqual([id]);

    // Dragging it writes nothing.
    const before = board.notes().find((note) => note.id === id)!;
    await dragBy(board, board.note(0), centre, 200, 200);
    expect(board.notes().find((note) => note.id === id)!.x).toBe(before.x);
    expect(board.notes().find((note) => note.id === id)!.y).toBe(before.y);

    // Neither does the Delete key, nor an arrow, nor the bar's delete button.
    await board.pressKey('Delete');
    expect(board.notes()).toHaveLength(1);
    await board.pressKey('ArrowRight');
    expect(board.notes().find((note) => note.id === id)!.x).toBe(before.x);
    const remove = board.selectionBar()?.querySelector<HTMLElement>('[aria-label="Delete note"]');
    await act(async () => {
      remove?.click();
    });
    expect(board.notes()).toHaveLength(1);

    // And the toolbar cannot put a new note on it.
    const before2 = board.notes().length;
    await act(async () => {
      // The label carries its shortcut since story 9: "Sticky note (N)".
      screen.getByRole('button', { name: /Sticky note/ }).click();
    });
    expect(board.notes()).toHaveLength(before2);
  });
});

/**
 * A WebSocket that does nothing but let a test close the connection with a chosen code.
 *
 * `connectBoard` hands this to y-websocket, which is what emits the `connection-close`
 * event the app turns into `load_failed` — so the test drives the real path from the
 * server's refusal to the board refusing to be edited.
 */
function installFakeWebSocket() {
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    binaryType = 'arraybuffer';
    readyState = 1;
    onopen: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;

    constructor(
      readonly url: string,
      readonly protocols?: string | string[],
    ) {
      FakeWebSocket.instances.push(this);
    }

    send(): void {
      // Nothing arrives: this board never syncs, which is the point.
    }

    close(): void {
      this.readyState = 3;
    }
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);

  return {
    /** Close the socket the way the room does when the object will not load. */
    refuseLoad: async () => {
      const socket = FakeWebSocket.instances[0];
      if (!socket) throw new Error('the board never tried to connect');
      await act(async () => {
        socket.onclose?.({ code: LOAD_FAILED_CLOSE_CODE });
      });
      await advanceFrames();
    },
  };
}

/** The close code the room uses for "this board could not be read from storage". */
const LOAD_FAILED_CLOSE_CODE = 4500;

afterEach(() => {
  vi.unstubAllGlobals();
});
