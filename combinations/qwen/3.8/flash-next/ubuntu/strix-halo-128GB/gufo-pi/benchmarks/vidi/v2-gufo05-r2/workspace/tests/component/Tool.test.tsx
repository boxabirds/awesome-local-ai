/**
 * Story 9, `text.tool`: which tool this page is holding, and what a click means
 * while it holds one.
 *
 * Everything here runs on the real board — the real viewport, the real keyboard
 * handlers and the real document — because the two things most likely to go wrong
 * with a tool are a shortcut that fires while somebody is typing a word, and a
 * tool that is still in your hand on a board you may not write to.
 */

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { screenToWorld } from '../../src/client/canvas/camera';
import { getTextContent, textSnapshot } from '../../src/shared/objects/text';
import type { TextSnapshot } from '../../src/shared/objects/text';
import {
  fireKey,
  firePointer,
  flushFrames,
  readBoardDoc,
  readCamera,
  renderBoard,
  surface,
} from './boardHarness';
import { dblClickNote, noteEl, seedNoteWithText, textareaFor } from './stickyHarness';
import { standInRoom } from './standInRoom';

// One board at a time: this project does not use testing-library's automatic
// cleanup, and two boards on the page at once makes every query below ambiguous.
afterEach(() => cleanup());

function textButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
}
function selectButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
}
function texts(doc: Y.Doc): TextSnapshot[] {
  return [...textSnapshot(doc)];
}

/** Press the Text tool and click the board at a screen point. */
function clickBoardWithTextTool(x: number, y: number): void {
  act(() => textButton().click());
  firePointer(surface(), 'pointerdown', x, y);
  firePointer(surface(), 'pointerup', x, y);
  flushFrames();
}

describe('text.tool — picking a tool up and putting it down', () => {
  it('TC-14: T activates the Text tool; Escape and V put it back', () => {
    renderBoard();
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(surface().getAttribute('data-text-tool')).toBe('false');

    fireKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    expect(selectButton().getAttribute('aria-pressed')).toBe('false');
    // The pointer says so too (PRD: the pointer becomes a text cursor).
    expect(surface().getAttribute('data-text-tool')).toBe('true');
    expect(surface().className).toContain('board-viewport--text');

    fireKey('Escape');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');

    fireKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    fireKey('v');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-14b: the buttons themselves pick the tool, and nothing is created', () => {
    renderBoard();
    const doc = readBoardDoc();
    act(() => textButton().click());
    expect(textButton().getAttribute('aria-pressed')).toBe('true');
    act(() => selectButton().click());
    expect(selectButton().getAttribute('aria-pressed')).toBe('true');
    expect(texts(doc)).toHaveLength(0);
  });

  it('TC-15: on a board that could not be loaded the Text tool is disabled and T does nothing', async () => {
    renderBoard();
    const doc = readBoardDoc();
    await act(async () => {});
    act(() => standInRoom.refuseConnections(CLOSE_BOARD_LOAD_FAILED, 'could not read it'));
    await act(async () => {});
    flushFrames();

    expect(textButton().disabled).toBe(true);
    fireKey('t');
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    // A click would create nothing even if the tool had been taken.
    clickBoardWithTextToolQuietly(200, 200);
    expect(texts(doc)).toHaveLength(0);
  });

  it('TC-16: T typed while editing a note is a letter, not a tool change', () => {
    renderBoard();
    const doc = readBoardDoc();
    const noteId = seedNoteWithText(doc, 'existing', { x: 0, y: 0 });
    flushFrames();
    dblClickNote(noteId);
    const field = textareaFor(noteId!);
    expect(field).not.toBeNull();

    // The keydown comes from inside the textarea, the way a real keystroke does.
    const event = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true });
    act(() => {
      field!.dispatchEvent(event);
    });
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(texts(doc)).toHaveLength(0);
  });

  it('TC-18: N still creates a sticky note at the centre of the view', () => {
    renderBoard();
    const doc = readBoardDoc();
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
    fireKey('n');
    flushFrames();
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // Centred on the view: the note's centre is the middle of the visible board.
    const camera = readCamera();
    const centre = screenToWorld(camera, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const note = notes[0]!;
    expect(Math.abs(note.x + 100 - centre.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(note.y + 100 - centre.y)).toBeLessThanOrEqual(1);
    expect(texts(doc)).toHaveLength(0);
  });
});

describe('text.tool — placing text', () => {
  it('TC-17: a click puts a size M text with its top-left under the pointer, editing, and hands Select back', () => {
    renderBoard();
    const doc = readBoardDoc();
    const camera = readCamera();
    const world = screenToWorld(camera, { x: 180, y: 120 });

    act(() => textButton().click());
    firePointer(surface(), 'pointerdown', 180, 120);
    firePointer(surface(), 'pointerup', 180, 120);
    flushFrames();

    const created = texts(doc);
    expect(created).toHaveLength(1);
    expect(created[0]!.x).toBe(world.x);
    expect(created[0]!.y).toBe(world.y);
    expect(created[0]!.size).toBe('M');
    expect(created[0]!.widthMode).toBe('auto');
    // The tool is back in its box, and this text is being typed in.
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('text-editor')).not.toBeNull();
    expect(selectionIdsOf()).toEqual([created[0]!.id]);
    expect(window.__vidi6?.objectCount?.()).toBe(1);
  });

  it('TC-17b: clicking on top of an existing object creates the text there too', () => {
    renderBoard();
    const doc = readBoardDoc();
    const noteId = seedNoteWithText(doc, 'a note', { x: 0, y: 0 });
    flushFrames();
    const box = noteEl(noteId).getBoundingClientRect();
    expect(box.width).toBe(0); // jsdom lays nothing out: the point is the pointer's own

    act(() => textButton().click());
    firePointer(noteEl(noteId), 'pointerdown', 40, 40);
    firePointer(noteEl(noteId), 'pointerup', 40, 40);
    flushFrames();

    expect(texts(doc)).toHaveLength(1);
    // The note was not moved, and was not selected by the press.
    expect(window.__vidi6?.selectedIds?.()).toEqual([texts(doc)[0]!.id]);
  });

  it('TC-17c: the tool handed back, a second click creates nothing — and the empty text leaves', () => {
    renderBoard();
    const doc = readBoardDoc();
    clickBoardWithTextTool(180, 120);
    expect(texts(doc)).toHaveLength(1);
    // This press is an ordinary one: marquee/empty-space, not another heading. The
    // text it clicks away from was never typed in, and never stays (PRD
    // text.empty_removed).
    firePointer(surface(), 'pointerdown', 300, 200);
    firePointer(surface(), 'pointerup', 300, 200);
    flushFrames();
    expect(texts(doc)).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('Escape while the Text tool is held creates nothing (PRD text.tool)', () => {
    renderBoard();
    const doc = readBoardDoc();
    act(() => textButton().click());
    fireKey('Escape');
    flushFrames();
    expect(texts(doc)).toHaveLength(0);
    expect(textButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('text created by the tool, typed in, and left: stays on the board, selected', () => {
    renderBoard();
    const doc = readBoardDoc();
    clickBoardWithTextTool(180, 120);
    const id = texts(doc)[0]!.id;
    const field = screen.getByTestId('text-editor') as HTMLTextAreaElement;
    act(() => {
      field.value = 'Went well';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    flushFrames();
    // Escape inside the editor is handled by the editor: end editing, keep selected.
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    flushFrames();
    expect(getTextContent(doc, id)?.toString()).toBe('Went well');
    expect(texts(doc)).toHaveLength(1);
    expect(window.__vidi6?.selectedIds?.()).toEqual([id]);
  });
});

function selectionIdsOf(): string[] {
  return [...(window.__vidi6?.selectedIds?.() ?? [])];
}

/** A pointer press that arrives while the Text tool is disabled: nothing to catch it. */
function clickBoardWithTextToolQuietly(x: number, y: number): void {
  firePointer(surface(), 'pointerdown', x, y);
  firePointer(surface(), 'pointerup', x, y);
  flushFrames();
}
