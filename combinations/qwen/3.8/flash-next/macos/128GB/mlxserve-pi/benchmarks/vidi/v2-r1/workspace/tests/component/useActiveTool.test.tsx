// Which tool is up, and what happens the moment it has drawn (`tools.active_tool`,
// `tools.return_to_select`).
//
// Story 10 doubles the number of tools on this board, so what is worth testing is not each
// tool's own behaviour - the two files beside this one do that - but the one idea all of
// them share: the rail says which tool is up, the keys pick tools and nothing else, and a
// drawing tool is put away by the act of drawing. A tool that stayed up after making one
// would turn the next click into a second one of the same, which is the difference between
// a tool and a stamp.
//
// Story 11 adds a tool that is deliberately not part of that last rule: a pen that drew one
// line and then handed itself back would make every sketch three drags and three keypresses
// long. So this file holds the rule, the exception and the reason the two can live together
// - and the pen is the only tool of the five that does not go back to Select on its own.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (tool_ui, tools.stay_active)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { objectBounds, snapshotObjects } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { makeNote, openNoteEditor } from './helpers/board-ui';
import {
  connectorIds,
  connectorSheet,
  connectorToolActive,
  doc,
  drawConnector,
  drawShape,
  dropShape,
  FakeWebsocketProvider,
  flush,
  makeShape,
  open,
  pressConnectorTool,
  pressEscape,
  pressKey,
  pressSelectTool,
  pressShapeTool,
  pressTextTool,
  screenOfPoint,
  selectToolActive,
  shapeIds,
  shapeSheet,
  shapeToolActive,
  selectedConnectorIds,
  selectedShapeIds,
  textToolActive,
  noSheetIsUp,
} from './helpers/shape-ui';
import {
  drawStroke,
  penSheet,
  penToolActive,
  penToolbar,
  pressPenTool,
  selectedStrokeIds,
  strokeIds,
} from './helpers/pen-ui';
import { handwrittenLoop } from '../fixtures/pen-paths';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'active-tool-under-test';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('tools.active_tool', () => {
  // TC-22
  it('TC-22 puts the tool a key names up, and only that one', () => {
    // The board starts as itself: selecting.
    expect(selectToolActive()).toBe(true);
    expect(noSheetIsUp()).toBe(true);

    pressShapeTool();
    expect(shapeToolActive()).toBe(true);
    expect(selectToolActive()).toBe(false);
    expect(textToolActive()).toBe(false);
    expect(connectorToolActive()).toBe(false);

    pressConnectorTool();
    expect(connectorToolActive()).toBe(true);
    expect(shapeToolActive()).toBe(false);

    pressTextTool();
    expect(textToolActive()).toBe(true);
    expect(connectorToolActive()).toBe(false);

    pressPenTool();
    expect(penToolActive()).toBe(true);
    expect(textToolActive()).toBe(false);

    pressSelectTool();
    expect(selectToolActive()).toBe(true);
    expect(noSheetIsUp()).toBe(true);
  });

  // TC-22: the drawing tools put a sheet over the board, and only while they are up.
  it('TC-22 puts a sheet over the board for the tools that draw', () => {
    pressShapeTool();
    expect(shapeSheet()).toBeTruthy();

    pressConnectorTool();
    // The Shape tool's sheet is gone, not merely hidden: two sheets would mean two tools
    // both taking the pointer.
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(connectorSheet()).toBeTruthy();

    pressSelectTool();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(noSheetIsUp()).toBe(true);
  });

  // Story 11's tool is a sheet over the board like the other two, and the sheet it puts up
  // is the one place a freehand drag can be recorded without moving anything.
  it('TC-22 puts the sheet of the pen over the board instead of the others', () => {
    pressShapeTool();
    pressPenTool();
    // Not two sheets and not the shape tool's: asking for a tool takes the last one away.
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(penSheet()).toBeTruthy();
    // The pen's options come up with it and are the only thing on the board that changes.
    expect(penToolbar()).toBeTruthy();

    pressSelectTool();
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
  });

  // TC-22: the return to Select that every drawing tool makes after it has drawn.
  it('TC-22 is back to Select with the new shape chosen once it has drawn one', () => {
    const shape = drawShape({ x: -420, y: -300 }, { x: -180, y: -140 });

    expect(shapeToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(selectedShapeIds()).toEqual([shape]);
    expect(screen.queryByTestId('shape-tool')).toBeNull();

    // The next click is therefore a click on the board, not a second shape.
    pressShapeTool();
    const second = dropShape({ x: 200, y: 100 });
    expect(shapeIds()).toHaveLength(2);
    expect(selectedShapeIds()).toEqual([second]);
  });

  // TC-22, the same rule from the other tool.
  it('TC-22 is back to Select with the new arrow chosen once it has drawn one', () => {
    const left = makeShape({ x: -420, y: -220 });
    const right = makeShape({ x: 60, y: -220 });

    const arrow = drawConnector(centreOf(left), centreOf(right));

    if (arrow === null) throw new Error('no arrow came of the drag');
    expect(connectorToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(selectedConnectorIds()).toEqual([arrow]);
    expect(screen.queryByTestId('connector-tool')).toBeNull();
  });

  // Story 11's exception, and the reason it is worth an exception: a pen that went back to
  // Select after each line would make a sketch into a series of trips to the rail. This is
  // the one tool of the five that is still up when it has drawn, and the one drawing whose
  // result is not selected - because the next thing the pointer does is another line, not a
  // move of the last one.
  it('TC-22 keeps the pen up after it has drawn, which is the one exception', () => {
    const first = drawStroke(handwrittenLoop({ x: -200, y: -100 }, 150, 60));

    expect(strokeIds()).toHaveLength(1);
    expect(penToolActive()).toBe(true);
    expect(selectToolActive()).toBe(false);
    expect(penSheet()).toBeTruthy();
    expect(selectedStrokeIds()).toEqual([]);

    // The next drag is the next line and not a second of anything else: no keypress and no
    // click on the rail between them.
    const second = drawStroke(handwrittenLoop({ x: 120, y: 60 }, 90, 40), { pressTool: false });
    expect(strokeIds()).toHaveLength(2);
    expect(first).not.toEqual(second);
    expect(penToolActive()).toBe(true);

    // And the pen is put away the way every tool is: by being asked not to be up.
    pressSelectTool();
    expect(penToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
  });

  // TC-22: Escape leaves the tool and creates nothing, including halfway through a drag.
  it('TC-22 leaves the tool on Escape and creates nothing', () => {    pressShapeTool();
    dragPartway();
    pressEscape();
    expect(shapeToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(shapeIds()).toHaveLength(0);

    pressConnectorTool();
    dragPartway();
    pressEscape();
    expect(connectorToolActive()).toBe(false);
    expect(connectorIds()).toHaveLength(0);

    // The exception to the return to Select is not an exception to this: Escape puts the pen
    // away, and the line that was halfway drawn is not left behind as an object.
    pressPenTool();
    dragPartway();
    pressEscape();
    expect(penToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(strokeIds()).toHaveLength(0);
  });

  // A tool that could be picked by key but not by mouse is half a tool.
  it('TC-22 takes the tool that the rail button names', () => {
    clickButton('tool-shape');
    expect(shapeToolActive()).toBe(true);
    expect(screen.queryByTestId('tool-ellipse')).toBeNull();
    expect(screen.getByTestId('shape-kind-ellipse')).toBeTruthy();

    clickButton('shape-kind-ellipse');
    expect(shapeToolActive()).toBe(true);
    expect(screen.getByTestId('shape-kind-ellipse').getAttribute('aria-pressed')).toBe('true');

    clickButton('tool-connector');
    expect(connectorToolActive()).toBe(true);
    // The kind menu belongs to the Shape tool, so it leaves with it.
    expect(screen.queryByTestId('shape-kind-ellipse')).toBeNull();

    clickButton('tool-pen');
    expect(penToolActive()).toBe(true);
    // The pen offers its own six and three, and no shape kinds.
    expect(screen.queryByTestId('shape-kind-ellipse')).toBeNull();
    expect(screen.getByTestId('pen-color-red')).toBeTruthy();
    expect(screen.getByTestId('pen-thickness-thick')).toBeTruthy();
  });

  // The keys are only ever keys: `n` is still story 7's note, not a mode.
  it('TC-22 still makes a note with N and leaves the tool alone', () => {
    pressShapeTool();
    pressKey({ key: 'n' });
    expect(stickyIds()).toHaveLength(1);
    expect(shapeToolActive()).toBe(true);
    expect(selectedShapeIds()).toEqual([]);
  });

  // A letter typed where letters are being typed is a letter (`tool_ui`, story 9's rule,
  // now holding for six keys instead of three).
  it('TC-22 types letters instead of switching tools while a note is open', () => {
    const note = makeNote(300, 300);
    openNoteEditor(note);

    // Each keystroke is left alone (not swallowed on its way to the board), and no tool
    // moves under the person who is typing.
    for (const key of ['s', 'l', 't', 'v', 'p']) expect(typeInNote(key)).toBe(true);
    expect(selectToolActive()).toBe(true);
    expect(shapeToolActive()).toBe(false);
    expect(connectorToolActive()).toBe(false);
    expect(textToolActive()).toBe(false);
    expect(penToolActive()).toBe(false);
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(strokeIds()).toHaveLength(0);
  });

  // A tool this build has no drawing code for is not a mode you can be stuck in. `p` used
  // to be one of them; story 11 built it, and the other two are still only names.
  it('TC-22 leaves the tools that are not built as Select', () => {
    for (const key of ['i', 'c']) {
      pressKey({ key });
      expect(selectToolActive()).toBe(true);
      expect(shapeToolActive()).toBe(false);
      expect(connectorToolActive()).toBe(false);
      expect(penToolActive()).toBe(false);
      expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    }
  });

  // A board that cannot be written holds no tool that writes (TC-30's rule, for all of them).
  it('TC-22 holds no drawing tool on a board that could not be read', () => {
    boardCannotBeRead();

    expect(shapeToolButton().disabled).toBe(true);
    expect(connectorToolButton().disabled).toBe(true);
    expect(penToolButton().disabled).toBe(true);

    pressShapeTool();
    expect(shapeToolActive()).toBe(false);
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    pressConnectorTool();
    expect(connectorToolActive()).toBe(false);
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    // The pen cannot draw on a board it cannot write to, and does not pretend otherwise:
    // no sheet, no options, and nothing to draw with.
    pressPenTool();
    expect(penToolActive()).toBe(false);
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();

    // The tool that was up when the board went out of reach is not left standing there.
    expect(selectToolActive()).toBe(true);
  });

  it('TC-22 puts the tool down with the keyboard rather than the mouse', () => {
    pressShapeTool();
    expect(shapeToolActive()).toBe(true);
    // The rail's own button is a toggle in story 9's sense: asking for the tool that is up
    // again is not a way of asking for nothing.
    clickButton('tool-shape');
    expect(shapeToolActive()).toBe(true);
    pressSelectTool();
    expect(shapeToolActive()).toBe(false);
  });
});

// --- helpers local to this file ---------------------------------------------

const centreOf = (id: string): { x: number; y: number } => {
  const object = snapshotObjects(doc()).find((candidate: { id: string }) => candidate.id === id);
  if (!object) throw new Error(`"${id}" is not on the board`);
  const box = objectBounds(object);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const stickyIds = (): string[] =>
  snapshotObjects(doc())
    .filter((object: { type: string }) => object.type === 'sticky')
    .map((object: { id: string }) => object.id);

const shapeToolButton = (): HTMLButtonElement =>
  screen.getByTestId('tool-shape') as HTMLButtonElement;
const connectorToolButton = (): HTMLButtonElement =>
  screen.getByTestId('tool-connector') as HTMLButtonElement;
const penToolButton = (): HTMLButtonElement =>
  screen.getByTestId('tool-pen') as HTMLButtonElement;

function clickButton(testId: string): void {
  act(() => {
    screen.getByTestId(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  flush();
}

/**
 * A keystroke inside the open note editor. True when nothing prevented it, which is how a
 * test tells a letter that was typed from a letter that was stolen by a shortcut.
 */
function typeInNote(key: string): boolean {
  const editor = screen.getByTestId('sticky-note-text') as HTMLTextAreaElement;
  return fireEvent.keyDown(editor, { key });
}

/** A drag on whichever drawing tool's sheet is up, left part way: no release. */
function dragPartway(): void {
  const sheet =
    screen.queryByTestId('shape-tool') ??
    screen.queryByTestId('connector-tool') ??
    screen.queryByTestId('pen-tool');
  if (!sheet) throw new Error('no drawing tool is up to drag with');
  const start = screenOfPoint({ x: -300, y: -200 });
  const end = screenOfPoint({ x: -100, y: -60 });
  act(() => {
    sheet.dispatchEvent(pointerOf('pointerdown', start));
    sheet.dispatchEvent(pointerOf('pointermove', end));
  });
  flush();
}

function pointerOf(type: 'pointerdown' | 'pointermove', at: { x: number; y: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  return Object.assign(event, {
    clientX: at.x,
    clientY: at.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.5,
  });
}

/** The room closed the connection because it could not read the board. */
function boardCannotBeRead(): void {
  act(() => {
    FakeWebsocketProvider.last().markRoomClosed(CLOSE_BOARD_LOAD_FAILED);
  });
  flush();
}
