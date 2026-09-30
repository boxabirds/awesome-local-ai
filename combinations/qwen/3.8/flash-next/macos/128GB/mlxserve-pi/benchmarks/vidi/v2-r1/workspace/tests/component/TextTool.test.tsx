// The tool that is up, and what its keys do (`text.tool_ui`).
//
// Story 9 is the first time the board has a *mode*: press T, and a click stops meaning
// "select" and starts meaning "write here". Modes are exactly the kind of thing that
// looks fine in a unit test and is useless in a hand, so all of this runs against the
// real `<Board>` — the rail's buttons, the keyboard, the click, the object that comes
// of it — and reads the document back.
//
// The four things worth pinning down are the four this file has:
//   - the tool is *visible* (the button says which one is up), because an invisible
//     mode is a click that does something inexplicable;
//   - a board that could not be read neither gets the tool that writes nor keeps it;
//   - typing beats the mode: a `t` typed into an open editor types a letter;
//   - the tool leaves the moment it has done its job, because a second click making a
//     second object is a stamp, not a tool.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md (text.tool_ui)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { objectBounds, snapshotObjects } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { StickySnapshot } from '../../src/shared/board-model';
import { makeNote, openNoteEditor } from './helpers/board-ui';
import {
  camera,
  clickEmpty,
  doc,
  FakeWebsocketProvider,
  flush,
  open,
  pressEscape,
  pressNewNote,
  pressSelectTool,
  pressTextTool,
  selectToolActive,
  textEditor,
  textIds,
  textIsBeingEdited,
  textObject,
  textToolActive,
  textToolButton,
  VIEWPORT,
} from './helpers/text-ui';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'text-tool-under-test';
const NOTE_WORLD = { x: 300, y: 300 };

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('text.tool', () => {
  // TC-14
  it('TC-14 turns the tool on with T, and Escape and V put it back', () => {
    // Story 7's board had one tool and said nothing; the board now says which it is.
    expect(selectToolActive()).toBe(true);
    expect(textToolActive()).toBe(false);

    pressTextTool();
    expect(textToolActive()).toBe(true);
    expect(selectToolActive()).toBe(false);

    // Escape is how a person gets out of a mode they did not mean to enter.
    pressEscape();
    expect(textToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);

    // ... and V is the other way out, for someone who never found Escape.
    pressTextTool();
    expect(textToolActive()).toBe(true);
    pressSelectTool();
    expect(textToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
  });

  // TC-15
  it('TC-15 ignores T and disables the button on a board that could not be read', () => {
    boardCannotBeRead();

    expect(textToolButton().disabled).toBe(true);

    pressTextTool();
    expect(textToolActive()).toBe(false);
    // The key did not only fail to switch: the click that follows places nothing.
    clickEmpty({ x: 100, y: 100 });
    expect(textIds()).toHaveLength(0);

    // A read-only board cannot be written with the note button either, and the tool
    // that was up before the board went out of reach is not left standing there.
    fireEvent.click(screen.getByTestId('tool-text') as HTMLButtonElement);
    expect(textToolActive()).toBe(false);
  });

  // TC-16
  it('TC-16 types a letter instead of switching tools while a note is open', () => {
    const note = makeNote(NOTE_WORLD.x, NOTE_WORLD.y);
    openNoteEditor(note);
    expect(textToolActive()).toBe(false);

    // A `t` typed into the note is the letter t. The tool must not move under the
    // person who is typing — and the keystroke must not be swallowed on the way.
    const editor = noteEditor(note);
    // fireEvent returns true when the keystroke was left alone (not preventDefault-ed).
    expect(fireEvent.keyDown(editor, { key: 't' })).toBe(true);
    setInput(editor, 't');

    expect(textToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(textOfSticky(note)).toBe('t');

    // The other tool keys are typing too, while the caret is in a box.
    for (const key of ['v', 'n']) {
      expect(fireEvent.keyDown(noteEditor(note), { key })).toBe(true);
      setInput(noteEditor(note), textOfSticky(note) + key);
    }
    expect(textToolActive()).toBe(false);
    expect(textOfSticky(note)).toBe('tvn');
    // `N` did not make a second note on top of the one being typed in.
    expect(stickyIds()).toHaveLength(1);
  });

  // TC-17
  it('TC-17 places text with the top-left under the click, selects it and edits it', () => {
    pressTextTool();
    const world = { x: 120, y: -60 };
    clickEmpty(world);
    flush();

    const ids = textIds();
    expect(ids).toHaveLength(1);
    const object = textObject(ids[0]);

    // The top-left is where the click was — not the centre, which is how a note works.
    const expected = screenToWorld(camera(), screenPointOf(world));
    expect(object.x).toBeCloseTo(expected.x, 0);
    expect(object.y).toBeCloseTo(expected.y, 0);
    expect(object.size).toBe('M');
    expect(object.widthMode).toBe('auto');
    expect(object.text).toBe('');

    // The tool is done with: it asked what goes here, and it went.
    expect(textToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);

    // And the caret is already in it, so the very next keystroke is the text.
    expect(textIsBeingEdited()).toBe(true);
    fireEvent.input(textEditor(), { target: { value: 'Ship it' } });
    flush();
    expect(textObject(ids[0]).text).toBe('Ship it');
  });

  // TC-17, the other door: the button on the rail rather than the letter.
  it('TC-17b the rail button puts the tool up as well', () => {
    fireEvent.click(textToolButton());
    flush();
    expect(textToolActive()).toBe(true);
    clickEmpty({ x: 40, y: 40 });
    expect(textIds()).toHaveLength(1);
  });

  // TC-17, and the one thing a mode must never do: stay after it has placed.
  it('TC-17c a second click places a second object only when the tool is asked for again', () => {
    pressTextTool();
    clickEmpty({ x: 40, y: 40 });
    fireEvent.input(textEditor(), { target: { value: 'first' } });
    flush();

    // A click somewhere else commits it and clears; the tool is Select again, so this
    // click places nothing.
    clickEmpty({ x: 640, y: 400 });
    expect(textIds()).toHaveLength(1);
    expect(textToolActive()).toBe(false);

    pressTextTool();
    clickEmpty({ x: 340, y: 140 });
    expect(textIds()).toHaveLength(2);
  });

  // TC-18
  it('TC-18 still makes a sticky note at the middle of the view with N', () => {
    pressNewNote();
    const ids = stickyIds();
    expect(ids).toHaveLength(1);
    const object = snapshotObjects(doc()).find((candidate) => candidate.id === ids[0]);
    if (!object) throw new Error('N made no note');
    const bounds = objectBounds(object);
    // The middle of what is on screen, wherever that is on this board.
    const centre = screenToWorld(camera(), { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
    expect(bounds.x + bounds.width / 2).toBeCloseTo(centre.x, 0);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(centre.y, 0);
  });

  it('TC-18b a board that cannot be read gets no note from N either', () => {
    boardCannotBeRead();
    pressNewNote();
    expect(stickyIds()).toHaveLength(0);
  });
});

// --- helpers local to this file ---------------------------------------------

/** The room closed the connection because it could not read the board. */
function boardCannotBeRead(): void {
  act(() => {
    FakeWebsocketProvider.last().markRoomClosed(CLOSE_BOARD_LOAD_FAILED);
  });
  flush();
}

const stickyIds = (): string[] =>
  snapshotObjects(doc())
    .filter((object) => object.type === 'sticky')
    .map((object) => object.id);

function textOfSticky(id: string): string {
  const object = snapshotObjects(doc()).find((candidate) => candidate.id === id) as
    | StickySnapshot
    | undefined;
  return object ? object.text : '';
}

/** Type a whole value into the note's editor the way the browser reports it. */
function setInput(editor: HTMLTextAreaElement, value: string): void {
  fireEvent.input(editor, { target: { value } });
  flush();
}

function noteEditor(id: string): HTMLTextAreaElement {
  const note = (screen.queryAllByTestId('sticky-note') as HTMLElement[]).find(
    (element) => element.dataset.id === id,
  );
  const editor = note?.querySelector('[data-testid="sticky-note-text"]');
  if (!editor) throw new Error(`no open editor for note "${id}"`);
  return editor as HTMLTextAreaElement;
}

/** Where on the screen the board would draw a given world point. */
function screenPointOf(world: { x: number; y: number }): { x: number; y: number } {
  const cameraNow = camera();
  return {
    x: (world.x - cameraNow.x) * cameraNow.zoom,
    y: (world.y - cameraNow.y) * cameraNow.zoom,
  };
}
