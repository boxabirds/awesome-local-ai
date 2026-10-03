/**
 * The tool modes and their keys (`text.tool_ui`) — Select, Text, and the note button
 * that keeps its shortcut.
 *
 * A tool is a mode, so these tests are about what the *next click* does: which button
 * reads as pressed, what the pointer looks like, and whether the board was written.
 * They also cover the two ways a mode could be wrong without anybody noticing: a board
 * that cannot be written arming a tool whose clicks go nowhere (TC-15), and a letter
 * typed into an object being taken as a command (TC-16).
 *
 * TC-14 T arms Text (button pressed); Escape and V put Select back
 * TC-15 a board that could not be loaded ignores T and disables the button (negative)
 * TC-16 T typed while editing a note stays a letter (negative)
 * TC-17 Text armed + click → text at that world point, tool back to Select
 * TC-18 N still creates a sticky note in the middle of the view
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { objectSnapshots } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { readTextSnapshot } from '../../src/shared/objects/text';
import { renderStickyApp, advanceFrames, viewportCentre, worldAt } from './stickyHarness';
import { installFakeWebSocket } from '../fixtures/fake-socket';

afterEach(() => {
  // The read-only tests stub `WebSocket`; the next test needs the real one back.
  vi.unstubAllGlobals();
});

const textButton = () => screen.getByRole('button', { name: 'Text (T)' });
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });

function pressed(button: HTMLElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

function armed(board: { viewport(): HTMLElement }): boolean {
  return board.viewport().className.includes('board-viewport--text');
}

/** The text objects on the board, read from the document. */
function texts(doc: Y.Doc) {
  return objectSnapshots(doc)
    .filter((object) => object.type === 'text')
    .map((object) => readTextSnapshot(doc, object.id));
}

describe('text.tool_ui: arming and leaving the Text tool', () => {
  it('TC-14 T arms Text, Escape and V put Select back', async () => {
    const board = await renderStickyApp();

    // Select is the resting state, and the toolbar says so.
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(textButton())).toBe(false);
    expect(armed(board)).toBe(false);

    await board.pressKey('t');
    expect(pressed(textButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);
    // The pointer says "write here", which is the only visible sign the mode changed.
    expect(armed(board)).toBe(true);

    await board.pressKey('Escape');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(armed(board)).toBe(false);

    // V is the other way out, and it is also a way back in through Select.
    await board.pressKey('t');
    expect(pressed(textButton())).toBe(true);
    await board.pressKey('v');
    expect(pressed(selectButton())).toBe(true);
    expect(armed(board)).toBe(false);
  });

  it('the toolbar buttons arm the tools, and Ctrl+V stays the paste', async () => {
    const board = await renderStickyApp();

    await act(async () => {
      textButton().click();
    });
    expect(pressed(textButton())).toBe(true);

    // A chord with Ctrl or Cmd is never a tool key: this is a paste, not "V for Select".
    await act(async () => {
      fireEvent.keyDown(window, { key: 'v', ctrlKey: true, bubbles: true });
    });
    expect(pressed(textButton())).toBe(true);

    // On its own, V is the tool key the toolbar shows next to the label.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'v', bubbles: true });
    });
    expect(pressed(selectButton())).toBe(true);
    expect(board.viewport().className.includes('board-viewport--text')).toBe(false);
  });

  it('a click on the board while nothing else is armed is left alone', async () => {
    const board = await renderStickyApp();
    await board.clickEmpty(300, 200);
    expect(texts(board.doc)).toHaveLength(0);
  });
});

describe('text.tool_ui: a board that cannot be written', () => {
  it('TC-15 ignores T and disables the Text button (negative)', async () => {
    const socket = installFakeWebSocket();
    const board = await renderStickyApp(new Y.Doc(), 'board-under-test');
    await socket.refuseLoad();
    await advanceFrames();
    expect(screen.getByTestId('connection-status').textContent).toContain("couldn't be loaded");

    expect(textButton().hasAttribute('disabled')).toBe(true);

    await board.pressKey('t');
    expect(pressed(textButton())).toBe(false);
    expect(armed(board)).toBe(false);

    // And the click that would have placed text places nothing at all.
    await board.clickEmpty(200, 200);
    expect(texts(board.doc)).toHaveLength(0);
  });

  it('a Text tool that was armed is put away when the board stops being editable', async () => {
    const socket = installFakeWebSocket();
    const board = await renderStickyApp(new Y.Doc(), 'board-under-test');
    await board.pressKey('t');
    expect(pressed(textButton())).toBe(true);

    await socket.refuseLoad();
    await advanceFrames();

    // Otherwise the board would sit in a mode whose clicks do nothing, with no way to
    // tell that from a mode that works.
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(armed(board)).toBe(false);
  });
});

describe('text.tool_ui: keys that belong to the object being typed into', () => {
  it('TC-16 T typed into a note stays a letter, and the tool does not change', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 0, y: 0 });
    // Story 2's way in: select the note, press Enter.
    const centre = { x: 0, y: 0 };
    await board.press(board.note(0), centre.x, centre.y);
    await board.release(centre.x, centre.y);
    await board.pressKey('Enter');
    const field = board.textarea();

    // A real browser sends the key to the focused textarea; both routes must be inert,
    // because the board's rule is "somebody is typing", not "somebody clicked a letter".
    await board.pressKey('t', field);
    expect(pressed(textButton())).toBe(false);
    await board.pressKey('n', field);
    expect(pressed(textButton())).toBe(false);
    // The letters are still the note's business: nothing was created by pressing them.
    expect(board.notes()).toHaveLength(1);
    expect(texts(board.doc)).toHaveLength(0);

    // Even a key that reaches the window while a note is being edited is not a command.
    await board.pressKey('t');
    expect(pressed(textButton())).toBe(false);
    await board.pressKey('n');
    expect(board.notes()).toHaveLength(1);
    expect(id).toBe(board.notes()[0]!.id);
  });
});

describe('text.tool_ui: the Text tool places text', () => {
  it('TC-17 clicking the board with Text armed puts text at that point and hands back', async () => {
    const board = await renderStickyApp();
    // Move the view so that a screen point and a world point are not the same number,
    // which is the only way to tell "clicked" from "placed where the document says".
    await board.setCamera({ x: -120, y: -80, zoom: 1 });

    await board.pressKey('t');
    expect(pressed(textButton())).toBe(true);
    await board.clickEmpty(400, 300);
    await advanceFrames();

    const placed = texts(board.doc);
    expect(placed).toHaveLength(1);
    const text = placed[0];
    expect(text).toBeTruthy();
    // The viewport is 1024x768 at camera (-120, -80) zoom 1, so the click at
    // (400, 300) is world (280, 220) — and it is the top-left of the text, not its
    // centre: a person clicking to write means "the words start here".
    expect(text!.x).toBeCloseTo(280, 3);
    expect(text!.y).toBeCloseTo(220, 3);
    expect(text!.type).toBe('text');
    expect(text!.text).toBe('');
    expect(text!.size).toBe('M');
    expect(text!.createdBy).not.toBe('');

    // One click, one tool: the next click is for selecting and moving again.
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(armed(board)).toBe(false);
  });

  it('clicking on top of an object writes there rather than dragging it', async () => {
    const board = await renderStickyApp();
    const id = await board.addNote({ x: 300, y: 200 });
    const before = board.notes().find((note) => note.id === id)!;

    await board.pressKey('t');
    // Press on the note itself: the Text tool is about the point, not about what is
    // already there, so this writes on top of the note instead of moving it.
    await board.press(board.note(0), 300, 200);
    await board.release(300, 200);
    await advanceFrames();

    expect(texts(board.doc)).toHaveLength(1);
    expect(board.notes().find((note) => note.id === id)!.x).toBe(before.x);
    expect(board.notes().find((note) => note.id === id)!.y).toBe(before.y);
  });

  it('a double-click with Text armed writes no sticky note, and abandons the empty box', async () => {
    const board = await renderStickyApp();
    await board.pressKey('t');

    // What a browser sends for a double-click: press, release, press, release, dblclick.
    await board.press(board.viewport(), 250, 250);
    await board.release(250, 250);
    // The first press placed the text and opened it for typing.
    expect(texts(board.doc)).toHaveLength(1);

    await board.press(board.viewport(), 250, 250);
    await board.release(250, 250);
    await act(async () => {
      fireEvent.doubleClick(board.viewport(), { clientX: 250, clientY: 250, button: 0 });
    });
    await advanceFrames();

    // Two things happen and neither is a second object. The second press is the same
    // gesture, so it creates no second box of text, and it is not the board's own
    // double-click either, so it creates no sticky note. And because it lands away from
    // the box that had just been opened, it ends the edit — which is the board's rule for
    // text nobody wrote into (`text.delete_empty`), tool armed or not.
    expect(texts(board.doc)).toHaveLength(0);
    expect(board.notes()).toHaveLength(0);
    expect(pressed(selectButton())).toBe(true);
  });
});

describe('text.tool_ui: the sticky note keeps its key', () => {
  it('TC-18 N creates a note in the middle of the view, already editing', async () => {
    const board = await renderStickyApp();

    await board.pressKey('n');
    await advanceFrames();

    expect(board.notes()).toHaveLength(1);
    const note = board.notes()[0]!;
    // The middle of the visible board, in world coordinates — the same point the
    // toolbar's Sticky note button uses, because `N` is that button's key.
    const centre = worldAt(board, viewportCentre());
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 3);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 3);
    // And it opens straight into typing, as it did before this story.
    expect(board.textarea()).toBeTruthy();
    expect(texts(board.doc)).toHaveLength(0);
  });

  it('N on a board that cannot be written creates nothing', async () => {
    const socket = installFakeWebSocket();
    const board = await renderStickyApp(new Y.Doc(), 'board-under-test');
    await socket.refuseLoad();
    await advanceFrames();

    await board.pressKey('n');
    expect(board.notes()).toHaveLength(0);
  });
});
