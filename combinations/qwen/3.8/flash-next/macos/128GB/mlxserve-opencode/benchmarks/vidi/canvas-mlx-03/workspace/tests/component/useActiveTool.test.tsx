// Story 10, tasks.md task 14 — one active tool, and every tool returns the board to
// Select (TC-22), component.
//
// The tool is mounted the only way it is ever mounted: inside `BoardApp`, next to the
// toolbar that shows which tool is armed and the keyboard that arms it. `aria-pressed` is
// the board's own statement of the active tool, so that is what these tests read — plus
// the number of objects, because "returns to Select" means the next click is a click.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { initDoc, objectSnapshots } from '../../src/shared/board-model.ts';
import { createShape } from '../../src/shared/objects/shape.ts';
import { connectorsOf } from '../../src/shared/objects/connector.ts';

let doc: Y.Doc;
let undo: UndoController;
let A: string;
let B: string;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new Y.Doc();
  initDoc(doc);
  // Two shapes, so the Connector tool has something to drag between.
  A = mkShape(0, 0);
  B = mkShape(300, 0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mkShape = (x: number, y: number) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: 200, height: 200 }, at: { x, y } }, 'me')!;

function mount() {
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
}

const viewport = () => screen.getByTestId('viewport') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const pressed = (name: string) => toolButton(name).getAttribute('aria-pressed');
const shapes = () => objectSnapshots(doc).filter((o) => o.type === 'shape').length;
const arrows = () => connectorsOf(objectSnapshots(doc)).length;
const kindMenu = () => screen.queryByRole('menu');
const kindOfLastShape = () =>
  (objectSnapshots(doc).filter((o) => o.type === 'shape').slice(-1)[0] as { kind?: string }).kind;

function firePointer(target: EventTarget, type: string, x = 20, y = 20) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
const hover = (x: number, y: number) => firePointer(window, 'pointermove', x, y);
const press = (name: string) => fireEvent.click(toolButton(name));

/** One whole Shape gesture: press the board, drag, release. */
function drawShape(x1 = 400, y1 = 400, x2 = 560, y2 = 520) {
  firePointer(viewport(), 'pointerdown', x1, y1);
  firePointer(window, 'pointermove', x2, y2);
  firePointer(window, 'pointerup', x2, y2);
}
/** One whole Connector gesture between two objects. */
function drawArrow() {
  firePointer(viewport(), 'pointerdown', 100, 100);
  firePointer(window, 'pointermove', 400, 100);
  firePointer(window, 'pointerup', 400, 100);
}

describe('story 10 active tool (TC-22)', () => {
  it('the board rests on Select, and only Select', () => {
    mount();
    expect(pressed('Select')).toBe('true');
    expect(pressed('Text')).toBe('false');
    expect(pressed('Shape')).toBe('false');
    expect(pressed('Connector')).toBe('false');
    // With nothing armed, no tool is mounted.
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
    expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();
  });

  it('S arms the Shape tool, and creating a shape hands the board back to Select', () => {
    mount();
    fireKey('s');
    expect(pressed('Shape')).toBe('true');
    // Armed, but nothing is being drawn yet: the tool shows no preview of its own.
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
    drawShape();
    expect(shapes()).toBe(3);
    expect(pressed('Select')).toBe('true');
    expect(pressed('Shape')).toBe('false');
    // The next gesture is a normal click: nothing is drawn by it.
    firePointer(viewport(), 'pointerdown', 50, 50);
    firePointer(window, 'pointerup', 50, 50);
    expect(shapes()).toBe(3);
  });

  it('L arms the Connector tool, and creating an arrow hands the board back to Select', () => {
    mount();
    fireKey('l');
    expect(pressed('Connector')).toBe('true');
    drawArrow();
    expect(arrows()).toBe(1);
    expect(pressed('Select')).toBe('true');
    expect(pressed('Connector')).toBe('false');
    expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();
  });

  it('Escape drops an armed tool to Select and creates nothing', () => {
    mount();
    fireKey('s');
    hover(300, 300);
    fireKey('Escape');
    expect(pressed('Select')).toBe('true');
    expect(shapes()).toBe(2);
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
    // The same for the arrow tool, mid-drag: Escape ends the gesture, draws nothing.
    fireKey('l');
    firePointer(viewport(), 'pointerdown', 100, 100);
    firePointer(window, 'pointermove', 400, 100);
    fireKey('Escape');
    expect(pressed('Select')).toBe('true');
    expect(arrows()).toBe(0);
    // The pointer is released, and the board is still a Select board.
    firePointer(window, 'pointerup', 400, 100);
    expect(pressed('Select')).toBe('true');
  });

  it('V arms Select and nothing else does: unknown letters are ignored', () => {
    mount();
    fireKey('s');
    fireKey('v');
    expect(pressed('Select')).toBe('true');
    // Letters belonging to tools this build has no UI for arm nothing at all.
    // ('p' was in this list until story 11 gave it to the Pen; the Pen arming is
    // asserted in tests/component/PenTool.test.tsx, and that the pen draws nothing is
    // asserted here.)
    for (const key of ['k', 'j', 'i', 'c', 'x', '1']) {
      fireKey(key);
      expect(pressed('Select')).toBe('true');
      expect(pressed('Shape')).toBe('false');
      expect(pressed('Connector')).toBe('false');
      expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
      expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();
      expect(screen.queryByTestId('pen-overlay')).toBeNull();
    }
    expect(shapes()).toBe(2);
    expect(arrows()).toBe(0);
  });

  it('the toolbar arms a tool, and one tool is armed at a time', () => {
    mount();
    press('Shape');
    expect(pressed('Shape')).toBe('true');
    expect(pressed('Text')).toBe('false');
    expect(pressed('Connector')).toBe('false');
    // The kind menu belongs to the armed tool, so it appears with it.
    expect(kindMenu()).toBeTruthy();
    // Another tool's button takes the arm away from Shape and takes its menu too.
    press('Connector');
    expect(pressed('Connector')).toBe('true');
    expect(pressed('Shape')).toBe('false');
    expect(kindMenu()).toBeNull();
    // Re-pressing the armed tool's button disarms it: Select is the resting state.
    press('Connector');
    expect(pressed('Connector')).toBe('false');
    expect(pressed('Select')).toBe('true');
  });

  it('the kind menu picks the shape the next gesture draws, and the choice sticks', () => {
    mount();
    fireKey('s');
    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    // Picking a kind keeps the tool armed: it chooses the *next* shape's kind.
    expect(pressed('Shape')).toBe('true');
    drawShape();
    expect(kindOfLastShape()).toBe('diamond');
    // The choice is the tool's setting, so the next shape is a diamond as well.
    fireKey('s');
    drawShape(700, 700, 860, 820);
    expect(kindOfLastShape()).toBe('diamond');
    // Until it is changed again.
    fireKey('s');
    fireEvent.click(screen.getByTestId('shape-kind-ellipse'));
    drawShape(1000, 1000, 1160, 1120);
    expect(kindOfLastShape()).toBe('ellipse');
    expect(shapes()).toBe(5);
  });

  it('a board that cannot be edited offers no creating tool and draws nothing', () => {
    const locked = new Y.Doc();
    initDoc(locked);
    render(<BoardApp doc={locked} connection="load_failed" />);
    // A board that could not be loaded has no tools to arm, so nothing can be created
    // by clicking on it.
    expect(screen.queryByTestId('select-tool')).toBeNull();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    // Their letters reach the board and arm nothing.
    fireKey('s');
    expect(screen.queryByTestId('shape-tool-overlay')).toBeNull();
    firePointer(viewport(), 'pointerdown', 100, 100);
    firePointer(window, 'pointerup', 300, 300);
    expect(objectSnapshots(locked).length).toBe(0);
    expect(A).toBeTruthy();
    expect(B).toBeTruthy();
  });
});
