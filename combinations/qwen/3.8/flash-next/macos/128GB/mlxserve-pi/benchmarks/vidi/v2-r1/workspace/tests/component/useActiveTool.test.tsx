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
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
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

  // TC-22: Escape leaves the tool and creates nothing, including halfway through a drag.
  it('TC-22 leaves the tool on Escape and creates nothing', () => {
    pressShapeTool();
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
  // now holding for five keys instead of three).
  it('TC-22 types letters instead of switching tools while a note is open', () => {
    const note = makeNote(300, 300);
    openNoteEditor(note);

    // Each keystroke is left alone (not swallowed on its way to the board), and no tool
    // moves under the person who is typing.
    for (const key of ['s', 'l', 't', 'v']) expect(typeInNote(key)).toBe(true);
    expect(selectToolActive()).toBe(true);
    expect(shapeToolActive()).toBe(false);
    expect(connectorToolActive()).toBe(false);
    expect(textToolActive()).toBe(false);
    expect(screen.queryByTestId('shape-tool')).toBeNull();
  });

  // A tool this build has no drawing code for is not a mode you can be stuck in.
  it('TC-22 leaves the tools that are not built as Select', () => {
    for (const key of ['p', 'i', 'c']) {
      pressKey({ key });
      expect(selectToolActive()).toBe(true);
      expect(shapeToolActive()).toBe(false);
      expect(connectorToolActive()).toBe(false);
    }
  });

  // A board that cannot be written holds no tool that writes (TC-30's rule, for all of them).
  it('TC-22 holds no drawing tool on a board that could not be read', () => {
    boardCannotBeRead();

    expect(shapeToolButton().disabled).toBe(true);
    expect(connectorToolButton().disabled).toBe(true);

    pressShapeTool();
    expect(shapeToolActive()).toBe(false);
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    pressConnectorTool();
    expect(connectorToolActive()).toBe(false);
    expect(screen.queryByTestId('connector-tool')).toBeNull();

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
  const sheet = screen.queryByTestId('shape-tool') ?? screen.queryByTestId('connector-tool');
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
