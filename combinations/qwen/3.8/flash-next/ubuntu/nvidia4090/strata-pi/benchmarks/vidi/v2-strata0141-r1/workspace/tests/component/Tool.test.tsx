import { describe, expect, it } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { FakeBoardProvider } from '../fixtures/fakeProvider';
import {
  activeTool,
  boardElement,
  createNote,
  docNotes,
  docTexts,
  doubleClickElement,
  editingId,
  editorElement,
  flushFrame,
  noteElement,
  noteOf,
  pasteIntoEditor,
  pointerEvent,
  pressKey,
  renderBoard,
  selectionCount,
  toolButton,
  toolPressed,
  typeIntoEditor,
  worldOf,
} from './harness';

/**
 * The tool mode (anchor `text.tool_ui`), TC-14 to TC-18: the Text tool is a piece
 * of per-client state with two buttons, four shortcuts and one click behaviour. It
 * writes nothing itself - the board does when it reports the click - and a board
 * this client may not edit never gets it.
 */

const HALF = STICKY_SIZE_WORLD / 2;

const clickBoard = (x: number, y: number): void => {
  pointerEvent('pointerdown', x, y);
  pointerEvent('pointerup', x, y);
};

describe('text.tool_ui - choosing a tool (TC-14)', () => {
  it('TC-14 T holds the Text tool, Escape and V give it back', () => {
    renderBoard();

    expect(activeTool()).toBe('select');
    expect(toolPressed('select')).toBe(true);
    expect(toolPressed('text')).toBe(false);

    pressKey('t');
    expect(activeTool()).toBe('text');
    expect(toolPressed('text')).toBe(true);
    expect(toolPressed('select')).toBe(false);
    // The board says so too, so the cursor rule can apply (`text.tool_ui`).
    expect(boardElement().getAttribute('data-tool')).toBe('text');

    pressKey('Escape');
    expect(activeTool()).toBe('select');
    expect(toolPressed('select')).toBe(true);

    pressKey('t');
    expect(activeTool()).toBe('text');
    pressKey('v');
    expect(activeTool()).toBe('select');
  });

  it('the toolbar buttons choose the tool as well, and the shortcut is in the name', () => {
    renderBoard();

    expect(toolButton('text').getAttribute('aria-label')).toBe('Text (T)');
    expect(toolButton('select').getAttribute('aria-label')).toBe('Select (V)');

    fireEvent.click(toolButton('text'));
    expect(activeTool()).toBe('text');
    fireEvent.click(toolButton('select'));
    expect(activeTool()).toBe('select');
  });

  it('holding Text does not change the document', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('t');

    expect(docNotes(doc)).toHaveLength(0);
    expect(docTexts(doc)).toHaveLength(0);
  });
});

describe('text.tool_ui - a board nobody was given (TC-15)', () => {
  it('TC-15 T is ignored and the Text button is disabled (negative)', async () => {
    const doc = new Y.Doc();
    const provider = new FakeBoardProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();
    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();

    expect(toolButton('text').disabled).toBe(true);

    pressKey('t');
    expect(activeTool()).toBe('select');
    expect(toolPressed('text')).toBe(false);

    // And a click cannot create anything either.
    clickBoard(240, 180);
    expect(docTexts(doc)).toHaveLength(0);
  });

  it('TC-15 a tool held when the board is taken away goes back to Select', async () => {
    const provider = new FakeBoardProvider();
    renderBoard({ connect: true, providerFactory: () => provider });
    await flushFrame();

    pressKey('t');
    expect(activeTool()).toBe('text');

    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();

    expect(activeTool()).toBe('select');
    expect(toolButton('text').disabled).toBe(true);
  });
});

describe('text.tool_ui - shortcuts never hijack typing (TC-16)', () => {
  it('TC-16 T while a note is being edited types the letter and leaves the tool alone (negative)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createNote(doc, { x: 300, y: 300 });

    doubleClickElement(noteElement(id));
    const editor = editorElement();
    if (!editor) {
      throw new Error('the note editor did not open');
    }

    pressKey('t'); // the browser would also deliver the character to the textarea
    typeIntoEditor('t');

    expect(activeTool()).toBe('select');
    expect(toolPressed('text')).toBe(false);
    expect(noteOf(doc, id).text).toBe('t');
    // Still editing: the letter was typing, not a command.
    expect(editingId()).toBe(id);
  });

  it('TC-16 the same for a sticky that only has focus (Delete is a board key, letters are not)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createNote(doc, { x: 0, y: 0 });

    noteElement(id).focus();
    pressKey('n'); // focus is on the note, not a field, so N is a board command
    expect(docNotes(doc)).toHaveLength(2);

    pasteIntoEditor('kept');
    expect(activeTool()).toBe('select');
  });
});

describe('text.tool_ui - the Text tool places text (TC-17)', () => {
  it('TC-17 clicking the board creates a text object with its top-left at the click', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('t');
    clickBoard(300, 200);

    const texts = docTexts(doc);
    expect(texts).toHaveLength(1);
    const created = texts[0]!;

    // The click point, in world units, is the top-left corner (`text.create`).
    const world = worldOf({ x: 300, y: 200 });
    expect(created.x).toBeCloseTo(world.x, 6);
    expect(created.y).toBeCloseTo(world.y, 6);
    expect(created.size).toBe('M');
    expect(created.widthMode).toBe('auto');
    expect(created.text).toBe('');
    expect(created.createdBy).not.toBe('');

    // The tool is a one-shot: it put the text down and gave Select back.
    expect(activeTool()).toBe('select');
    expect(toolPressed('text')).toBe(false);

    // And the new object is selected and being edited, so typing starts at once.
    expect(selectionCount()).toBe(1);
    expect(editingId()).toBe(created.id);
  });

  it('TC-17 a created text object sits above what was already on the board', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const noteId = createNote(doc, { x: 400, y: 400 });
    const noteBefore = noteOf(doc, noteId);

    pressKey('t');
    clickBoard(120, 120);

    const created = docTexts(doc)[0]!;
    expect(created.z).toBeGreaterThan(noteBefore.z ?? 0);
    // The click did not move or select the note it landed next to.
    expect(noteOf(doc, noteId).x).toBe(noteBefore.x);
  });

  it('Text then a drag is not a placement: a press that moves creates nothing', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('t');
    pointerEvent('pointerdown', 100, 100);
    pointerEvent('pointermove', 320, 300);
    pointerEvent('pointerup', 320, 300);

    expect(docTexts(doc)).toHaveLength(0);
  });

  it('a click with the Select tool still just clears the selection', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    createNote(doc, { x: 200, y: 200 });

    clickBoard(40, 40);
    expect(docTexts(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
  });
});

describe('text.tool_ui - N is still story 2 (TC-18)', () => {
  it('TC-18 N creates a sticky note at the centre of the view', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('n');

    const notes = docNotes(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    // The same placement the toolbar button produces: the centre of the visible
    // board, whatever the camera is showing.
    const centre = worldOf({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(note.x).toBeCloseTo(centre.x - HALF, 6);
    expect(note.y).toBeCloseTo(centre.y - HALF, 6);
    expect(note.text).toBe('');
    expect(editingId()).toBe(note.id);
    expect(activeTool()).toBe('select');
  });

  it('TC-18 N works while the Text tool is held, and does not place text', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });

    pressKey('t');
    pressKey('n');

    expect(docNotes(doc)).toHaveLength(1);
    expect(docTexts(doc)).toHaveLength(0);
    expect(activeTool()).toBe('text'); // N made a note; the tool this client holds is unchanged
  });
});
