// text.tool (ui-component): holding the Text tool, and what the next click does.
//
// The tool is a state of the screen, not of the document: it says which of two
// things a click on the board means. Everything the board did before story 9 has
// to go on working while the tool is held - the wheel, the keyboard, the sticky
// note button - and nothing it does may be a tool's business: a tool that could
// not let go would be a board you can no longer move.

import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  allObjects,
  clickBoard,
  clickOn,
  clickTextToolLayer,
  doubleClickOn,
  flushFrames,
  forceConnectionState,
  holdTextTool,
  newNote,
  noteAt,
  noteCount,
  notePosition,
  pointerOn,
  pressKey,
  pressKeyOn,
  readCamera,
  renderBoard,
  screenCentre,
  selectionCount,
  snapshotTexts,
  stickyToolButton,
  stubTextHeight,
  textCount,
  textEditorElement,
  textToolLayer,
  textToolSelectButton,
  textToolTextButton,
  unstubTextHeight,
  viewportEl,
  useBoardTestLifecycle,
  wheelAt,
} from './helpers';

/** The world point a click at this screen point names, right now. */
function worldPoint(clientX: number, clientY: number): { x: number; y: number } {
  return screenToWorld(readCamera(), { x: clientX, y: clientY });
}

/** The open sticky note editor, if that is the kind of text being typed. */
function noteEditor(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea[data-testid="sticky-text"]');
}

/** How many text objects carry the selection outline. */
function selectedTextCount(): number {
  return document.querySelectorAll('[data-testid="text-object"][data-selected="true"]').length;
}

/** The tool button as a button, so its `disabled` state is readable. */
function button(testId: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`no button ${testId}`);
  return el;
}

describe('the Text tool', () => {
  useBoardTestLifecycle();

  it('TC-14 T holds the tool, Escape and V let it go, and the rail says which is held', () => {
    renderBoard();
    expect(textToolLayer()).toBeNull();
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(textToolSelectButton()?.getAttribute('aria-label')).toBe('Select (V)');
    expect(textToolTextButton()?.getAttribute('aria-label')).toBe('Text (T)');

    holdTextTool();
    expect(textToolLayer()).not.toBeNull();
    expect(textToolTextButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('false');

    // Escape backs out of the tool first, because a tool still held would place an
    // object with the next click
    pressKey('Escape');
    expect(textToolLayer()).toBeNull();
    expect(textToolTextButton()?.getAttribute('aria-pressed')).toBe('false');

    // and the key that names a tool works whatever tool was held
    holdTextTool();
    expect(textToolLayer()).not.toBeNull();
    pressKey('v');
    expect(textToolLayer()).toBeNull();
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');

    // the rail's buttons are the same action as the keys
    clickOn(textToolTextButton());
    expect(textToolLayer()).not.toBeNull();
    clickOn(textToolSelectButton());
    expect(textToolLayer()).toBeNull();
  });

  it('TC-14 the tool is held over the whole board, above every object', () => {
    renderBoard();
    // Where the layer sits is what decides its behaviour, so that is what this
    // checks. The cursor it draws is CSS, which a jsdom test cannot see - the
    // end-to-end spec asserts that, in a browser that has the stylesheet.
    holdTextTool();
    const layer = textToolLayer()!;
    expect(layer.className).toBe('text-tool-layer');
    // It belongs to the board surface, not to the world: the next click on the
    // board is what is in question, at any zoom or pan.
    const board = viewportEl();
    expect(layer.parentElement).toBe(board);
    // and it is painted after the world, which is what puts it above the objects:
    // text is placed on top of what is already there
    expect(Array.from(board.children).indexOf(layer)).toBe(board.children.length - 1);
    expect(board.querySelector('[data-testid="board-world"]')).not.toBeNull();
  });

  it('TC-15 a board the room could not read takes no tool: T is ignored, the button is off', () => {
    const { doc } = renderBoard();
    forceConnectionState('load_failed');

    holdTextTool();
    expect(textToolLayer()).toBeNull();
    expect(textToolTextButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(button('tool-text').disabled).toBe(true);
    expect(button('tool-select').disabled).toBe(true);

    // the rail's button cannot do what the key could not either
    clickOn(textToolTextButton());
    expect(textToolLayer()).toBeNull();
    // and nothing arrived from any of it
    expect(allObjects(doc)).toHaveLength(0);
  });

  it('TC-15 a board that stops being editable lets go of the tool', () => {
    renderBoard();
    holdTextTool();
    expect(textToolLayer()).not.toBeNull();

    forceConnectionState('load_failed');
    // a tool that would place an object on a board that keeps nothing is not left
    // in anybody's way
    expect(textToolLayer()).toBeNull();
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-16 T typed into a note belongs to the note, not to the tool', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    doubleClickOn(noteAt(0));
    const editor = noteEditor();
    expect(editor).not.toBeNull();

    // the keystroke goes to the focused field, as the browser sends it
    const event = pressKeyOn(editor, 't');

    // The board never claims a key the caret is in front of: nothing is prevented,
    // so the character goes into the text, which is what the person typing means.
    expect(event.defaultPrevented).toBe(false);
    expect(textToolLayer()).toBeNull();
    expect(textToolTextButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(allObjects(doc)).toHaveLength(1);
  });

  it('TC-17 a click on the board places a text where it was clicked, opens it, and stands down', () => {
    const { doc } = renderBoard();
    holdTextTool();

    clickTextToolLayer(320, 210);

    const texts = snapshotTexts(doc);
    expect(texts).toHaveLength(1);
    // the point clicked, not the middle of the board: writing where you mean
    expect({ x: texts[0].x, y: texts[0].y }).toEqual(worldPoint(320, 210));
    expect(texts[0].type).toBe('text');
    // the tool let go of itself: the next click selects the text, not another one
    expect(textToolLayer()).toBeNull();
    expect(textToolTextButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
    // and the caret is already in it
    const editor = textEditorElement();
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(textCount()).toBe(1);
    expect(selectedTextCount()).toBe(1);
  });

  it('TC-17 a click on top of a note places the text just the same', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: -100, y: -100 });
    const whereTheNoteWas = notePosition(0);
    holdTextTool();

    // Writing across what is already on the board is the whole point, so the layer
    // answers for clicks on top of an object as well as on empty board.
    clickTextToolLayer(40, 40);

    expect(allObjects(doc)).toHaveLength(2);
    expect(snapshotTexts(doc)[0]).toMatchObject(worldPoint(40, 40));
    expect(noteCount()).toBe(1);
    // the note was not selected, moved or opened by the click
    expect(selectionCount()).toBe(0);
    expect(notePosition(0)).toEqual(whereTheNoteWas);
  });

  it('TC-17 a drag with the tool held places nothing and does not move the board', () => {
    const { doc } = renderBoard();
    const before = readCamera();
    holdTextTool();

    const layer = textToolLayer()!;
    pointerOn(layer, 'pointerdown', { clientX: 300, clientY: 200 });
    for (let step = 1; step <= 4; step += 1) {
      fireEvent.pointerMove(layer, {
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 1,
        clientX: 300 + step * 30,
        clientY: 200 + step * 20,
      });
    }
    fireEvent.pointerUp(layer, { pointerId: 1, pointerType: 'mouse', clientX: 420, clientY: 280 });
    flushFrames();

    expect(allObjects(doc)).toHaveLength(0);
    expect(readCamera()).toEqual(before);
  });

  it('TC-17 the wheel still belongs to the board while the tool is held', () => {
    const { doc } = renderBoard();
    const before = readCamera();
    holdTextTool();

    wheelAt(textToolLayer()!, { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300 });
    flushFrames();

    expect(readCamera().zoom).toBeGreaterThan(before.zoom);
    expect(allObjects(doc)).toHaveLength(0);
  });

  it('TC-18 N still makes a sticky note in the middle of the view', () => {
    stubTextHeight(60);
    const { doc } = renderBoard();
    const centre = screenCentre();

    holdTextTool();
    pressKey('n');
    flushFrames();

    expect(noteCount()).toBe(1);
    expect(notePosition(0)).toEqual({
      x: centre.x - STICKY_SIZE_WORLD / 2,
      y: centre.y - STICKY_SIZE_WORLD / 2,
    });
    expect(snapshotTexts(doc)).toHaveLength(0);
    // the note's own editor is the one that opened
    expect(textEditorElement()).toBeNull();
    expect(noteEditor()).not.toBeNull();
    unstubTextHeight();
  });

  it('TC-18 the sticky note button works with the tool held too', () => {
    stubTextHeight(60);
    const { doc } = renderBoard();
    holdTextTool();

    clickOn(stickyToolButton());
    flushFrames();

    expect(noteCount()).toBe(1);
    // the one object on the board is the note the button made: holding a tool
    // never turns another tool's button into it
    expect(allObjects(doc)).toHaveLength(1);
    expect(snapshotTexts(doc)).toHaveLength(0);
    unstubTextHeight();
  });

  it('Escape with the tool held and something selected lets go of the tool first', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    expect(selectionCount()).toBe(1);

    holdTextTool();
    pressKey('Escape');
    // the tool is gone; the selection is still there
    expect(textToolLayer()).toBeNull();
    expect(selectionCount()).toBe(1);

    // and the next Escape is the one that clears the selection
    pressKey('Escape');
    expect(selectionCount()).toBe(0);
  });

  it('a click on the board with no tool held places nothing at all', () => {
    const { doc } = renderBoard();

    clickBoard(320, 210);
    flushFrames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(allObjects(doc)).toHaveLength(0);
    expect(textToolLayer()).toBeNull();
  });

  it('a double-click while the tool is held places one text and no sticky note', () => {
    const { doc } = renderBoard();
    holdTextTool();

    const layer = textToolLayer()!;
    pointerOn(layer, 'pointerdown', { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(layer, { pointerId: 1, pointerType: 'mouse', clientX: 300, clientY: 200 });
    fireEvent.click(layer, { clientX: 300, clientY: 200, detail: 2 });
    fireEvent.doubleClick(layer, { clientX: 300, clientY: 200, detail: 2 });
    flushFrames();

    expect(noteCount()).toBe(0);
    expect(textCount()).toBe(1);
    // exactly one object came of it
    expect(allObjects(doc)).toHaveLength(1);
  });
});
