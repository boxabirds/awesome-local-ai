/**
 * The tool the pointer holds (story 9, tasks 6-7): `text.tool_ui` — TC-14 to TC-18.
 *
 * These run against the real board: the toolbar the app renders, the key listener
 * the board installs, the pointer path the viewport implements. What is asserted
 * is which tool is held and what a press does while it is held, because that is
 * the whole of the contract — a Text tool that is pressed but does not write, or
 * a Select tool that still pans, fails here.
 */

import type { JSX } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import {
  dispatchKey,
  noteById,
  pointerEvent,
  readCamera,
  readNotes,
  renderStickyBoard,
  textOf,
  viewportElement,
  VIEWPORT_SIZE,
  worldElement,
} from './helpers/board';
import { readObjectEntry, textIdsOf } from './helpers/text-board';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useTool } from '../../src/client/board/useTool';
import { useUndo, useUndoController } from '../../src/client/board/useUndo';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: YDoc;

beforeEach(() => {
  doc = new Doc();
  renderStickyBoard(doc);
});

afterEach(cleanup);

const selectButton = () => screen.getByTestId('tool-select');
const textButton = () => screen.getByTestId('tool-text');
const stickyButton = () => screen.getByTestId('create-sticky');

/** aria-pressed is the state a keyboard user can reach, so it is the state checked. */
function pressed(button: HTMLElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

const key = (letter: string): void => void dispatchKey({ key: letter });

/** Let go of what is selected: a click on empty board, which ends an edit too. */
function letGo(point = { x: 60, y: 60 }): void {
  pointerEvent('pointerDown', viewportElement(), point);
  pointerEvent('pointerUp', viewportElement(), point);
}

/** The world point a screen point maps to at the current camera. */
function worldAt(screenPoint: { x: number; y: number }): { x: number; y: number } {
  const camera = readCamera();
  return {
    x: camera.x + screenPoint.x / camera.zoom,
    y: camera.y + screenPoint.y / camera.zoom,
  };
}

/** The one text object the tool made. */
function onlyText(): Record<string, unknown> {
  const ids = textIdsOf(doc);
  expect(ids).toHaveLength(1);
  return readObjectEntry(doc, ids[0]) as unknown as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- *
 * TC-14: the shortcuts.                                                       *
 * -------------------------------------------------------------------------- */

describe('text.tool_ui shortcuts (TC-14)', () => {
  it('starts on Select, and a press on empty space still pans while it is held', () => {
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(textButton())).toBe(false);

    pointerEvent('pointerDown', viewportElement(), { x: 600, y: 400 });
    pointerEvent('pointerMove', viewportElement(), { x: 560, y: 380 });
    pointerEvent('pointerUp', viewportElement(), { x: 560, y: 380 });
    expect(textIdsOf(doc)).toHaveLength(0);
    // board.pan is untouched: the board moved, and nothing was written.
    expect(readCamera().x).not.toBe(0);
  });

  it('T holds the Text tool, V puts Select back, and the buttons say which is held', () => {
    key('t');
    expect(pressed(textButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);

    key('v');
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(textButton())).toBe(false);

    // Presses are not a queue: T T T still holds one Text tool, and has written
    // nothing — a tool is a state, not an action.
    key('t');
    key('t');
    expect(pressed(textButton())).toBe(true);
    expect(textIdsOf(doc)).toHaveLength(0);
  });

  it('N makes one sticky at the view centre — and keeps making them, one per press', () => {
    key('n');

    const notes = readNotes(doc);
    // One note for one press: the toolbar’s command and the key are one command,
    // not two handlers both answering N (TC-18’s negative).
    expect(notes).toHaveLength(1);
    const centre = worldAt({ x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 });
    expect(notes[0].x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2);

    // The note the key made is open for typing, so the next N is a letter in it
    // rather than a second note: while a note is being typed in, the keys belong
    // to the note (story 2’s rule, and story 9 did not move it).
    key('n');
    expect(readNotes(doc)).toHaveLength(1);

    // A click on empty board lets go of the note, and N is a key again.
    letGo();
    key('n');
    expect(readNotes(doc)).toHaveLength(2);
    expect(textIdsOf(doc)).toHaveLength(0);
  });

  it('N while the Text tool is held still makes a note, and does not put the tool down', () => {
    // Story 2’s key was not stolen by story 9 (TC-18).
    key('t');
    key('n');

    expect(readNotes(doc)).toHaveLength(1);
    expect(textIdsOf(doc)).toHaveLength(0); // the key did not become a heading
    expect(pressed(textButton())).toBe(true); // and the pointer still holds Text
  });
});

/* -------------------------------------------------------------------------- *
 * TC-15: a board that cannot be written to does not offer a tool that writes.  *
 * -------------------------------------------------------------------------- */

describe('text.tool_ui permissions (TC-15)', () => {
  it('the Text button is disabled and inert while the board is not editable; Select is not', () => {
    // This case is about the toolbar on a board that cannot be written to, so the
    // editable board from the fixture is taken away first.
    cleanup();
    const history = new Doc();
    let held: string = 'unset';
    let created = 0;

    function ReadOnlyBoard(): JSX.Element {
      const undo = useUndo(useUndoController(history), false);
      const tool = useTool(false);
      held = tool.tool;
      return (
        <Toolbar
          tool={tool}
          disabled
          undo={undo}
          onCreateSticky={() => {
            created += 1;
          }}
        />
      );
    }
    render(<ReadOnlyBoard />);

    expect(textButton().hasAttribute('disabled')).toBe(true);
    expect(selectButton().hasAttribute('disabled')).toBe(false);
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);

    // A press on a disabled button is not a request.
    fireEvent.click(textButton());
    expect(held).toBe('select');
    expect(pressed(textButton())).toBe(false);

    // Sticky creation is unchanged by the tool being offered: the button is there,
    // and disabled for the same reason it always was.
    fireEvent.click(stickyButton());
    expect(created).toBe(0);
  });

  it('the hook refuses Text where writing does not work, and takes it away when writing stops', () => {
    let controller: ReturnType<typeof useTool> | undefined;
    function Probe({ editable }: { editable: boolean }): null {
      controller = useTool(editable);
      return null;
    }
    const { rerender } = render(<Probe editable={false} />);
    act(() => controller?.setTool('text'));
    expect(controller?.tool).toBe('select'); // asked for Text, got Select

    rerender(<Probe editable />);
    act(() => controller?.setTool('text'));
    expect(controller?.tool).toBe('text');
    // The board went read-only with the tool still open: the tool goes with it,
    // which is what stops a click on such a board from looking like a heading
    // that vanished.
    rerender(<Probe editable={false} />);
    expect(controller?.tool).toBe('select');
  });

  it('on a board that can be written to, both tools are offered', () => {
    expect(textButton().hasAttribute('disabled')).toBe(false);
    expect(stickyButton().hasAttribute('disabled')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * TC-16: Escape, and typing in a note.                                        *
 * -------------------------------------------------------------------------- */

describe('text.tool_ui escape and typing (TC-16)', () => {
  it('Escape puts the Select tool back, having let go of the selection', () => {
    key('t');
    expect(pressed(textButton())).toBe(true);
    key('Escape');
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(textButton())).toBe(false);
    expect(textIdsOf(doc)).toHaveLength(0);
  });

  it('letters pressed while a note is open for typing are letters, not tools (negative)', () => {
    // A note, open for typing: the letters belong to the note.
    fireEvent.dblClick(viewportElement(), {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 300,
      button: 0,
    });
    const notes = readNotes(doc);
    expect(notes).toHaveLength(1);
    expect(pressed(selectButton())).toBe(true);

    key('t');
    key('n');
    key('v');
    expect(pressed(textButton())).toBe(false); // no tool moved
    expect(textIdsOf(doc)).toHaveLength(0); // nothing was written
    expect(readNotes(doc)).toHaveLength(1); // not even a note

    // The note itself takes text as usual, and its text is what the board stores.
    const editor = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'ten thousand' } });
    fireEvent.blur(editor);
    expect(textOf(doc, notes[0].id)).toBe('ten thousand');
  });
});

/* -------------------------------------------------------------------------- *
 * TC-17: what the Text tool does to the pointer and to the board.              *
 * -------------------------------------------------------------------------- */

describe('text.tool_ui cursor and click (TC-17)', () => {
  it('the pointer is marked as holding Text, and objects are told to stop answering it', () => {
    expect(viewportElement().dataset.tool).toBe('select');
    key('t');
    // jsdom resolves no stylesheets, so what a test can read is the attribute the
    // CSS rule selects on: `.board-viewport[data-tool="text"] { cursor: text }`
    // and `.board-world[data-tool="text"] * { pointer-events: none }`.
    expect(viewportElement().dataset.tool).toBe('text');
    expect(worldElement().dataset.tool).toBe('text');
    key('v');
    expect(viewportElement().dataset.tool).toBe('select');
  });

  it('a click on the empty board writes exactly one text object where the pointer was', () => {
    key('t');
    const point = { x: 320, y: 210 };
    pointerEvent('pointerDown', viewportElement(), point);
    pointerEvent('pointerUp', viewportElement(), point);

    const world = worldAt(point);
    const text = onlyText();
    expect(text.type).toBe('text');
    // A text is placed by its top-left, where the pointer was (`placement`).
    expect(text.x).toBeCloseTo(world.x);
    expect(text.y).toBeCloseTo(world.y);
    expect(text.createdBy).toBeTypeOf('string');
    expect((text.createdBy as string).length).toBeGreaterThan(0);

    // The tool was used once and is put back down: the click after it selects.
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  it('a press-and-drag while Text is held places nothing, and does not pan', () => {
    key('t');
    const before = { ...readCamera() };
    pointerEvent('pointerDown', viewportElement(), { x: 300, y: 300 });
    pointerEvent('pointerMove', viewportElement(), { x: 420, y: 360 });
    pointerEvent('pointerUp', viewportElement(), { x: 420, y: 360 });

    expect(textIdsOf(doc)).toHaveLength(0); // an interrupted press is nothing (TC-31)
    expect(readCamera()).toEqual(before); // and the board did not move under it
  });

  it('a Shift+drag while Text is held draws no marquee', () => {
    key('t');
    pointerEvent('pointerDown', viewportElement(), { x: 100, y: 100 }, { shiftKey: true });
    pointerEvent('pointerMove', viewportElement(), { x: 700, y: 600 }, { shiftKey: true });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    pointerEvent('pointerUp', viewportElement(), { x: 700, y: 600 }, { shiftKey: true });
    expect(textIdsOf(doc)).toHaveLength(0);
  });

  it('a click while Text is held is not also a double-click shortcut', () => {
    key('t');
    const point = { x: 500, y: 400 };
    pointerEvent('pointerDown', viewportElement(), point);
    pointerEvent('pointerUp', viewportElement(), point);
    fireEvent.dblClick(viewportElement(), {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
    });
    expect(textIdsOf(doc)).toHaveLength(1);
    expect(readNotes(doc)).toHaveLength(0); // the tool owns the press
  });
});

/* -------------------------------------------------------------------------- *
 * TC-18: a press over an object — a heading belongs on top of the cluster.     *
 * -------------------------------------------------------------------------- */

describe('text.tool_ui over objects (TC-18)', () => {
  it('a click that lands where a note is puts the text there instead', () => {
    fireEvent.click(stickyButton());
    const notes = readNotes(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    const camera = readCamera();
    const middle = {
      x: (note.x - camera.x) * camera.zoom + STICKY_SIZE_WORLD / 2,
      y: (note.y - camera.y) * camera.zoom + STICKY_SIZE_WORLD / 2,
    };
    // Leave the note the button just opened, so what is under the pointer is an
    // ordinary note to be selected and not an editor being typed in.
    letGo();

    // While Select is held, a click on the note selects it…
    pointerEvent('pointerDown', noteById(note.id), middle);
    pointerEvent('pointerUp', noteById(note.id), middle);
    expect(noteById(note.id).dataset.selected).toBe('true');
    expect(textIdsOf(doc)).toHaveLength(0);

    // …while Text is held the note is transparent to the pointer, so the press
    // reaches the board and a text object stands where the click was.
    key('t');
    pointerEvent('pointerDown', viewportElement(), middle);
    pointerEvent('pointerUp', viewportElement(), middle);

    const world = worldAt(middle);
    const text = onlyText();
    expect(text.x).toBeCloseTo(world.x);
    expect(text.y).toBeCloseTo(world.y);
    expect(readNotes(doc)).toHaveLength(1); // the note neither moved nor grew
  });
});
