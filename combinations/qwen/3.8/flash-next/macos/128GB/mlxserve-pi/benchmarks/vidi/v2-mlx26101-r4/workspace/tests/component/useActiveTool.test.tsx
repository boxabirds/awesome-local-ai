/**
 * Story 10 — one tool at a time (TC-22).
 *
 * `src/client/tools/useActiveTool.ts` holds which tool the board is in, and it is the only thing that holds it.
 * Story 9 had one tool and one hook; story 10 has three, and the toolbar, the shape sheet and the connector
 * sheet are three readers of one fact. The moment two things can answer *which tool is it?* is the moment a
 * toolbar reads as Select while the viewport is still drawing diamonds.
 *
 * So these tests are about the state and nothing else — the tools' own work has its own files
 * (`ShapeTool.test.tsx`, `Connector.test.tsx`):
 *
 *   - TC-22 — four tools, armed from the toolbar or the keyboard, one at a time, and each one's UI arrives
 *     with it and leaves with it.
 *   - TC-22 — Escape gives the tool back, and stops there: a person backing out of a tool has said nothing
 *     about what is selected. While the tool is Select, Escape was never the tool's business and travels on to
 *     the board, which uses it to let go of the selection.
 *   - TC-22 — a keystroke typed into a label is a letter, and a keystroke the tool was never given — `p`,
 *     Ctrl+T, Tab — is left alone. A tool that swallows what it does not use is a tool that stops the board.
 *   - and the thing a tool is *not*: choosing one writes nothing to the document, so it is not something five
 *     people synchronise and not something anybody can undo.
 */
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_KINDS } from '../../src/shared/config';
import { SHAPE_OBJECT_TYPE } from '../../src/shared/objects/shape';
import {
  activeTool,
  addNote,
  addShape,
  allObjects,
  armConnectorTool,
  armShapeTool,
  centreOf,
  connectorSheet,
  frameAtOrigin,
  pressKey,
  pressShape,
  renderBoard,
  screenOf,
  shapeById,
  shapeSheet,
  shapes,
  somebodyElse,
  stickies,
  toolOverlayPresent,
  WORLD_CENTRE,
} from './helpers/tools';
import { outlinedIds } from './helpers/selection';

/** A point as the two numbers a pointer event wants. */
function xy(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}

/** A rectangle nobody can mistake for another one. */
const A = { x: 100, y: 100, width: 200, height: 120 };

/** What the toolbar says about a tool, without asking the board's internals. */
function toolButton(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

/** Which shapes the board says are picked up. */
function selectedShapes(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-shape-id]'))
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.shapeId ?? '');
}

describe('arming a tool (TC-22)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-22: the tools are armed one at a time, and each brings its own thing and takes it away again', async () => {
    addNote(WORLD_CENTRE);

    // Nothing of the tool layer is on the board before a tool is armed: the board a person arrives at is the
    // board, not a tool waiting to be used.
    expect(activeTool()).toBe('select');
    expect(toolOverlayPresent()).toBe(false);

    // The text tool was here before story 10 and keeps its place: it is a tool, so it goes through the same
    // door as the two that are new. It has no sheet of its own because it has nothing to choose.
    fireEvent.click(toolButton(/Text/));
    expect(activeTool()).toBe('text');
    expect(toolOverlayPresent()).toBe(false);

    fireEvent.click(toolButton(/Shape/));
    await waitFor(() => expect(shapeSheet()).toBeDefined());
    expect(activeTool()).toBe('shape');
    expect(screen.queryByTestId('connector-tool')).toBeNull();

    fireEvent.click(toolButton(/Connector/));
    await waitFor(() => expect(connectorSheet()).toBeDefined());
    expect(activeTool()).toBe('connector');
    // The shape's sheet is gone with the shape tool: one tool at a time, so the screen only ever offers one
    // tool's choices.
    expect(screen.queryByTestId('shape-tool')).toBeNull();
  });

  it('TC-22: the keyboard arms the same tools, and the toolbar shows which one is in hand', () => {
    addNote(WORLD_CENTRE);

    pressKey('s');
    expect(activeTool()).toBe('shape');
    // A person who looks up from the keyboard has to be able to see what the board will do with their next
    // click, so exactly one toolbar button is pressed.
    expect(toolButton(/Shape/).getAttribute('aria-pressed')).toBe('true');
    expect(toolButton(/Connector/).getAttribute('aria-pressed')).toBe('false');
    expect(toolButton(/Select/).getAttribute('aria-pressed')).toBe('false');

    pressKey('l');
    expect(activeTool()).toBe('connector');
    expect(toolButton(/Connector/).getAttribute('aria-pressed')).toBe('true');

    pressKey('t');
    expect(activeTool()).toBe('text');
    pressKey('v');
    expect(activeTool()).toBe('select');
    expect(toolButton(/Select/).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-22: Escape gives the tool back, and does not also let go of the selection', async () => {
    const a = addShape(A);
    pressShape(a);
    await armConnectorTool();
    // Arming the tool left the shape picked up; Escape is about the tool.
    expect(selectedShapes()).toEqual([a]);

    pressKey('Escape');

    await waitFor(() => expect(activeTool()).toBe('select'));
    expect(toolOverlayPresent()).toBe(false);
    // The person backed out of drawing an arrow. They said nothing about the shape, so the shape is still
    // theirs: one keypress, one meaning.
    expect(selectedShapes()).toEqual([a]);
    expect(outlinedIds()).toEqual([a]);
  });

  it('TC-22: while the tool is Select, Escape is the board’s, and the board lets go of the selection', () => {
    const a = addShape(A);
    pressShape(a);
    expect(selectedShapes()).toEqual([a]);

    // The same key, one step later, with a different tool in hand — and a different answer. Escape belongs to
    // whoever has the pointer, and the pointer is back on the board.
    pressKey('Escape');

    expect(activeTool()).toBe('select');
    expect(selectedShapes()).toEqual([]);
    expect(outlinedIds()).toEqual([]);
  });

  it('TC-22: choosing a tool leaves the selection where it was', async () => {
    const a = addShape(A);
    pressShape(a);

    // The person is deciding what to do next, not un-saying what they picked up: undo, the delete key and the
    // arrow keys all still have work to do on a selection while a tool is armed.
    await armShapeTool();
    expect(selectedShapes()).toEqual([a]);
    pressKey('l');
    await waitFor(() => expect(connectorSheet()).toBeDefined());
    expect(selectedShapes()).toEqual([a]);
    pressKey('t');
    expect(selectedShapes()).toEqual([a]);
  });

  it('TC-22: a tool takes the letters it was given and leaves the rest of the keyboard alone', async () => {
    await armShapeTool();

    // Ctrl+T is a browser tab. A tool that stole it would be a tool that stops people opening boards.
    // `true` is the keystroke being left for the browser to get on with.
    expect(fireEvent.keyDown(window, { key: 't', ctrlKey: true })).toBe(true);
    // Tab is how a person without a mouse gets around the board and the toolbar.
    expect(fireEvent.keyDown(window, { key: 'Tab' })).toBe(true);
    // A letter in the design's map that this build does not have: the pen is a tool in a story not told yet,
    // and its letter does nothing at all rather than arming a cursor that draws nothing.
    expect(fireEvent.keyDown(window, { key: 'p' })).toBe(true);
    // The keystroke a screen reader uses to interrupt.
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(true);

    // Ctrl+Z and Ctrl+Shift+Z are taken — by the board's own history, which is the answer these keystrokes
    // were always going to get. The tool layer's job is to have no opinion about them, and the shape tool is
    // still in hand afterwards because nothing about the tool was involved. (That the history itself works is
    // the test further down that undoes a shape after arming four tools.)
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);

    expect(activeTool()).toBe('shape');
    expect(screen.queryByTestId('connector-tool')).toBeNull();
  });

  it('TC-22: a letter typed into a label is a letter, whichever tool is armed', async () => {
    const a = addShape(A);
    pressShape(a);
    // The label is open for typing: the shape's own textarea has the keystrokes.
    const at = screenOf(centreOf(shapeById(a)));
    fireEvent.doubleClick(screen.getByTestId('shape-object'), { clientX: at.x, clientY: at.y });
    const editor = screen.getByTestId('shape-textarea');

    // Every letter the tools were given is also a letter somebody types. The rule that decides which one it
    // was has one answer: what had the keystroke. `true` is the browser being allowed to do what it was about
    // to do anyway, which is put the letter in the words.
    for (const key of ['s', 'l', 't', 'v']) {
      expect(fireEvent.keyDown(editor, { key })).toBe(true);
      expect(activeTool()).toBe('select');
    }
    // The label is still open, and no shape was drawn behind it: the tool layer was never told about any of it.
    expect(screen.getByTestId('shape-textarea')).toBeInTheDocument();
    expect(shapes().map((shape) => shape.id)).toEqual([a]);

    // Escape is the label's own, and it stops there: the editor closes and the tool layer is not told, because
    // a person who has just left a label has not asked to be holding a different tool.
    expect(fireEvent.keyDown(editor, { key: 'Escape' })).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeNull());
    expect(activeTool()).toBe('select');
  });

  it('TC-22: making a note is a thing the board does, not a tool it becomes', () => {
    pressKey('s');
    expect(activeTool()).toBe('shape');

    // `N` is in the design's map and is deliberately not a tool: making a note is an action the board already
    // answers on the key, and a mode waiting for a click would be two gestures for one object. So the note
    // arrives, the keystroke is the board's (it is taken from the browser, which would otherwise type an `n`
    // into nothing), and the tool that was armed is still armed afterwards.
    const before = stickies().length;
    expect(fireEvent.keyDown(window, { key: 'n' })).toBe(false);

    expect(stickies().length).toBe(before + 1);
    expect(activeTool()).toBe('shape');
    expect(shapeSheet()).toBeDefined();
  });

  it('TC-22: choosing a tool writes nothing, so there is nothing to undo and nothing to sync', () => {
    const a = addShape(A);
    const before = allObjects().map((object) => `${object.type}:${object.id}@${object.x},${object.y}`).join(' ');

    pressKey('s');
    pressKey('l');
    pressKey('t');
    pressKey('v');
    pressKey('Escape');

    // Five tools armed and handed back, and the document is what it was: a tool is not a thing five people
    // are synchronising, and it is not something anybody can undo.
    expect(allObjects().map((object) => `${object.type}:${object.id}@${object.x},${object.y}`).join(' ')).toBe(
      before,
    );

    // Which is why the undo that follows choosing a tool undoes the shape, and not the choosing of the diamond:
    // there was nothing in between to undo, because arming a tool is not a thing a person does to the board.
    pressKey('z', { ctrlKey: true });
    expect(shapes().some((shape) => shape.id === a)).toBe(false);
  });

  it('TC-22: a tool that made something steps aside and leaves that thing in hand', async () => {
    const sheet = await armShapeTool();

    fireEvent.pointerDown(sheet, xy(WORLD_CENTRE));
    fireEvent.pointerMove(window, xy({ x: WORLD_CENTRE.x + 30, y: WORLD_CENTRE.y + 30 }));
    fireEvent.pointerUp(window, xy({ x: WORLD_CENTRE.x + 30, y: WORLD_CENTRE.y + 30 }));

    await waitFor(() => expect(activeTool()).toBe('select'));
    expect(toolOverlayPresent()).toBe(false);
    // The person asked for a shape and got one: the tool that made it is out of the way and the shape is
    // already picked up, so the next letter they press goes into its label rather than into the board.
    expect(selectedShapes()).toEqual(shapes().map((shape) => shape.id));
    expect(selectedShapes()).toHaveLength(1);
  });

  it('TC-22: the shape kind menu is the Shape tool’s, and only the Shape tool’s', async () => {
    // Not on screen while the board is in Select.
    expect(screen.queryByTestId('shape-kind')).toBeNull();

    fireEvent.click(toolButton(/Shape/));
    await waitFor(() => expect(shapeSheet()).toBeDefined());
    const menu = screen.getByTestId<HTMLSelectElement>('shape-kind');
    // A choice the toolbar shows, because the person has to know which shape their next click will make.
    expect(menu.getAttribute('aria-label')).toBe('Shape kind');
    expect(Array.from(menu.querySelectorAll('option')).map((option) => option.value)).toEqual(
      SHAPE_KINDS.map((kind) => kind as string),
    );

    fireEvent.change(menu, { target: { value: 'diamond' } });
    expect(menu.value).toBe('diamond');

    pressKey('l');
    await waitFor(() => expect(connectorSheet()).toBeDefined());
    // The connector tool has no kind to choose, so the menu goes with the tool that had it.
    expect(screen.queryByTestId('shape-kind')).toBeNull();
  });

  it('TC-22: a shape written by somebody else’s client is drawn, hit and selected like any other object', () => {
    // The board reads every object through one generic snapshot, which is what lets a shape arrive from a
    // client this one has never spoken to — including one that stores a kind this build does not draw.
    somebodyElse((there) => {
      const objects = there.getMap('objects');
      const shape = new Y.Map<unknown>();
      shape.set('type', SHAPE_OBJECT_TYPE);
      shape.set('x', 200);
      shape.set('y', 200);
      shape.set('width', SHAPE_DEFAULT_SIZE_WORLD);
      shape.set('height', SHAPE_DEFAULT_SIZE_WORLD);
      shape.set('z', 1);
      objects.set('foreign', shape);
    });

    expect(shapeById('foreign')).toMatchObject({ id: 'foreign', kind: 'rect' });

    const at = screenOf({ x: 200 + SHAPE_DEFAULT_SIZE_WORLD / 2, y: 200 + SHAPE_DEFAULT_SIZE_WORLD / 2 });
    fireEvent.pointerDown(screen.getByTestId('shape-object'), { clientX: at.x, clientY: at.y, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, pointerId: 1, buttons: 0 });

    expect(selectedShapes()).toEqual(['foreign']);
    expect(outlinedIds()).toEqual(['foreign']);
  });
});
