/**
 * Story 9 component tests: the Text tool (`text.tool`).
 *
 * These drive the real component tree — the palette, the keyboard hook, the viewport and
 * the board screen together — because the tool is only meaningful as the agreement between
 * them: the key that picks it up, the button that says which one is held, the cursor that
 * changes, the click that it turns into an object, and the way it lets go afterwards.
 *
 * Two rules are asserted over and over because they are the ones a future change is most
 * likely to break:
 *
 *  - the tool is **spent by one use**. The click that places text also puts the pointer
 *    back to Select, so a second click selects rather than laying down another empty text;
 *  - the tool **does not exist on a board that cannot be written to** (`text.limit_access`),
 *    and typing into an object is not the board being asked for a tool (`text.tool`).
 *
 * The board document is reached through `useBoardDoc`, which is mocked only to make one
 * scenario real and otherwise awkward: a board whose room failed to load.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import {
  STICKY_OBJECT_TYPE,
  boardObjects,
  createSticky,
  objectBounds,
  type ObjectSnapshot
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { TextSnapshot } from '../../src/shared/objects/text';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  CENTRE,
  doubleClick,
  fireInput,
  fireKey,
  firePointer,
  flushCameraFrame,
  stubResizeObserver,
  stubViewportGeometry,
  testCamera,
  textEditor,
  textElements,
  toolButton,
  toolPressed,
  viewportElement
} from './harness';

/**
 * What `useBoardDoc` reports as the connection. A board the room could not load is a real
 * state of the application (`board.load_failed`) and the only way to ask a component test
 * for it without running a server that refuses the board.
 */
const connection: { current: ConnectionState } = { current: 'connected' };

vi.mock('../../src/client/board/useBoardDoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/board/useBoardDoc')>();
  return {
    ...actual,
    useBoardDoc: (options: Parameters<typeof actual.useBoardDoc>[0]) => ({
      ...actual.useBoardDoc(options),
      connection: connection.current
    })
  };
});

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  connection.current = 'connected';
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** The free texts on the board, as the document holds them. */
function textObjects(board: BoardFixture): TextSnapshot[] {
  return board.objects().filter((object) => object.type === 'text') as TextSnapshot[];
}

/** Press and release the board itself, at a screen point: a click on nothing. */
function clickBoard(board: BoardFixture, screen: { x: number; y: number }): void {
  const viewport = viewportElement(board.root);
  firePointer(viewport, 'pointerdown', screen.x, screen.y);
  firePointer(viewport, 'pointerup', screen.x, screen.y);
}

function pressedTool(board: BoardFixture): string {
  const viewport = viewportElement(board.root);
  return viewport.dataset.tool ?? 'missing';
}

describe('the Text tool (text.tool)', () => {
  it('TC-14: T picks up the Text tool, Escape and V put it back', async () => {
    const board = await renderBoard();

    // The board rests on Select, and says so in the palette.
    expect(pressedTool(board)).toBe('select');
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(true);
    expect(toolPressed(toolButton(board.root, 'text'))).toBe(false);

    fireKey('T');
    expect(toolPressed(toolButton(board.root, 'text'))).toBe(true);
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(false);
    // The viewport knows too, because that is where the cursor and the inert objects hang.
    expect(pressedTool(board)).toBe('text');

    // Escape is "never mind": the tool goes, and so does the selection.
    fireKey('Escape');
    expect(toolPressed(toolButton(board.root, 'text'))).toBe(false);
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(true);
    expect(pressedTool(board)).toBe('select');

    // V is the same key as always, and the only other way out of the tool.
    fireKey('T');
    expect(pressedTool(board)).toBe('text');
    fireKey('v');
    expect(pressedTool(board)).toBe('select');
    expect(toolPressed(toolButton(board.root, 'select'))).toBe(true);

    // Picking up a tool changed nothing on the board: it is the click that does that.
    expect(board.objects()).toHaveLength(0);
  });

  it('TC-15: on a board that could not be loaded there is no Text tool', async () => {
    connection.current = 'load_failed';
    const board = await renderBoard();

    // The button is switched off rather than silent, so the reason is at least findable.
    const button = toolButton(board.root, 'text');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(toolPressed(button)).toBe(false);

    // The key is refused as firmly as the button is: no tool, and so nothing to place.
    fireKey('T');
    expect(pressedTool(board)).toBe('select');
    expect(board.objects()).toHaveLength(0);
  });

  it('TC-16: T typed into a note is a letter, not a tool', async () => {
    const board = await renderBoard();

    // Open a note's editor the way a visitor does: put a note on the board, double-click
    // it, and type into it — the letter `t` among them.
    let note = '';
    act(() => {
      note = createSticky(board.doc, { x: 100, y: 100 });
    });
    await flushCameraFrame();
    const noteElement = board.root.querySelector<HTMLElement>(`[data-object-id="${note}"]`)!;
    doubleClick(noteElement);
    const editor = textArea(noteElement);

    // jsdom does not insert characters for a synthetic key press, so the typing is the
    // input event a real keystroke ends in; the key press below is the same keystroke
    // reaching the board's own key handler, which is where a tool would be picked up.
    fireInput(editor, 'tex');
    fireKey('T', { target: editor });

    // Still on Select, and no text was placed by the letter t.
    expect(pressedTool(board)).toBe('select');
    expect(textObjects(board)).toHaveLength(0);
    // The characters went into the note, which is where a typed letter belongs.
    expect(editor.value).toBe('tex');
  });

  it('TC-17: with the Text tool held, one click places text and spends the tool', async () => {
    const board = await renderBoard();
    fireKey('T');

    const screen = { x: 300, y: 200 };
    const expected = screenToWorld(testCamera(), screen);
    clickBoard(board, screen);
    await flushCameraFrame();

    const created = textObjects(board);
    expect(created).toHaveLength(1);
    // Top-left where the pointer landed: the text starts at the click, not centred on it.
    expect(created[0]!.x).toBeCloseTo(expected.x, 6);
    expect(created[0]!.y).toBeCloseTo(expected.y, 6);
    expect(created[0]!.size).toBe('M');
    expect(created[0]!.widthMode).toBe('auto');

    // It is already being typed into — a placed text you have to click again is one click
    // too many on the way to writing something down.
    expect(textEditor(board.root)).not.toBeNull();

    // And the tool is spent: the next click selects, it does not place another text.
    expect(pressedTool(board)).toBe('select');
    expect(toolPressed(toolButton(board.root, 'text'))).toBe(false);

    // Type something, so what the next click ends is an edit with words in it rather than
    // an empty text, which the board would be right to remove (`text.empty_delete`).
    const editor = textEditor(board.root)!;
    fireInput(editor, 'Went well');

    clickBoard(board, { x: 500, y: 400 });
    await flushCameraFrame();
    expect(textObjects(board)).toHaveLength(1);
    expect(textObjects(board)[0]!.text).toBe('Went well');
  });

  it('TC-18: N still makes a sticky note in the middle of the view', async () => {
    const board = await renderBoard();

    fireKey('n');
    await flushCameraFrame();

    const notes = board.objects().filter((object) => object.type === STICKY_OBJECT_TYPE);
    expect(notes).toHaveLength(1);
    // Story 2's behaviour, unchanged: the note lands in the middle of what you are looking
    // at, not wherever the board's origin happens to be.
    const centre = screenToWorld(testCamera(), CENTRE);
    const bounds = objectBounds(notes[0]!);
    expect(bounds.width).toBe(STICKY_SIZE_WORLD);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(centre.x, 6);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(centre.y, 6);
    // It is a note, not a text: the Text tool did not get involved.
    expect(textElements(board.root)).toHaveLength(0);
  });
});

/** The textarea a note shows once it is being edited. */
function textArea(note: HTMLElement): HTMLTextAreaElement {
  const editor = note.querySelector<HTMLTextAreaElement>('[data-testid="sticky-input"]');
  if (!editor) throw new Error('the note is not being edited');
  return editor;
}
