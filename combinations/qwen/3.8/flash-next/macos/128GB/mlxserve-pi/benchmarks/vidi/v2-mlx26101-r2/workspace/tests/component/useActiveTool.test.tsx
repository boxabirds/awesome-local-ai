/**
 * Which tool the pointer is set to (`tests/component/useActiveTool.test.tsx`).
 *
 * Story 9 made a letter of the alphabet decide what a click means; story 10 adds two
 * more letters and the rule that goes with them: a tool that has just made something
 * is finished, and the board is back in Select with the new thing in the selection.
 * That is the difference between drawing four shapes and pressing a letter eight
 * times.
 *
 * Everything here is interface state - which button is pressed, which layer the
 * pointer is talking to, what is selected - because a tool is per-tab state and is
 * deliberately not in the document. The one document-level claim is the negative one:
 * leaving a tool by Escape creates nothing at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  canEdit,
  clickBoard,
  clickTool,
  connectorSurface,
  connectorToolButton,
  connectionLink,
  docNotes,
  dragOnTool,
  keydown,
  pointerDown,
  pointerMove,
  pressKey,
  pressedShapeKind,
  pressedTool,
  renderBoard,
  selectedObjectIds,
  shapeSurface,
  shapeToolButton,
  shapes,
  toolSurfaceExists,
  connectors,
} from './helpers.js';
import { failToLoad } from './fake-link.js';

beforeEach(() => {
  renderBoard();
});

/** A shape drawn by dragging the tool layer, however the tool was entered. */
function drawShape(): void {
  dragOnTool('shape', { x: 440, y: 340 }, { x: 640, y: 460 });
}

/** An arrow drawn between two points of bare board. */
function drawArrow(): void {
  dragOnTool('connector', { x: 300, y: 300 }, { x: 700, y: 540 });
}

describe('tools.active_tool: a tool that made something is finished', () => {
  it('TC-22 puts the board back to Select after a shape and after an arrow', () => {
    keydown('s');
    expect(pressedTool()).toBe('shape');
    drawShape();
    expect(pressedTool()).toBe('select');
    expect(selectedObjectIds()).toEqual([shapes()[0]!.id]);

    keydown('l');
    expect(pressedTool()).toBe('connector');
    drawArrow();
    expect(pressedTool()).toBe('select');
    expect(selectedObjectIds()).toEqual([connectors()[0]!.id]);
  });

  it('TC-22b leaves nothing behind when the tool is left before it drew', () => {
    keydown('s');
    pressKey('Escape', shapeSurface());
    expect(pressedTool()).toBe('select');

    keydown('l');
    // A drag that never finished: the pointer came down, travelled, and the person
    // pressed Escape before letting go.
    const surface = connectorSurface();
    pointerDown({ x: 300, y: 300 }, surface);
    pointerMove({ x: 500, y: 420 }, surface);
    keydown('Escape');
    expect(pressedTool()).toBe('select');

    // Neither of the two attempts wrote a thing to the board.
    expect(docNotes()).toEqual([]);
  });

  it('TC-22c abandons a drag in flight and creates nothing', () => {
    keydown('s');
    const surface = shapeSurface();
    pointerDown({ x: 440, y: 340 }, surface);
    pointerMove({ x: 520, y: 400 }, surface);

    // Escape while the drag is in the air: the tool is put away, and the drag with it,
    // so the release that never comes can never write a shape.
    keydown('Escape');
    expect(pressedTool()).toBe('select');
    expect(surface.isConnected).toBe(false);
    expect(shapes()).toHaveLength(0);
  });

  it('TC-22d goes to the tool a letter names, and Select is where V and a click land', () => {
    keydown('t');
    expect(pressedTool()).toBe('text');
    keydown('v');
    expect(pressedTool()).toBe('select');
    keydown('s');
    expect(pressedTool()).toBe('shape');
    clickTool('select');
    expect(pressedTool()).toBe('select');
    // Escape always comes home, even from the tool that writes nothing.
    keydown('l');
    keydown('Escape');
    expect(pressedTool()).toBe('select');
  });

  it('TC-22e keeps the shape kind between two drags, and between two tools', () => {
    keydown('s');
    clickTool('select');
    keydown('s');
    expect(pressedShapeKind()).toBe('rect');

    dragOnTool('shape', { x: 100, y: 600 }, { x: 220, y: 700 });
    // The kind is the Shape tool's setting rather than one shape's property, so the
    // next shape is drawn the same way until it is changed.
    keydown('s');
    expect(pressedShapeKind()).toBe('rect');
    expect(shapes()[0]!.kind).toBe('rect');
  });

  it('TC-22f has no letters for tools this build has not got, and spends them on nothing', () => {
    // The pen, image and comment tools are story 11, 12 and 16. Their letters are
    // reserved and must not put the board in a mode whose tool does not exist.
    for (const key of ['p', 'i', 'c']) {
      keydown(key);
      expect(pressedTool()).toBe('select');
    }
    // `n` is a note, which is a creation and not a mode.
    keydown('n');
    expect(pressedTool()).toBe('select');
    expect(docNotes().filter((object) => object.type === 'sticky')).toHaveLength(1);
  });

  it('TC-22g is not entered on a board that will not take edits', () => {
    failToLoad(connectionLink());
    expect(canEdit()).toBe(false);

    for (const key of ['s', 'l', 't']) {
      keydown(key);
      expect(pressedTool()).toBe('select');
    }
    expect(toolSurfaceExists('shape')).toBe(false);
    expect(toolSurfaceExists('connector')).toBe(false);
    // The buttons are there and greyed out rather than hidden: the tools exist, what
    // is missing is the board's ability to take what they make.
    expect(shapeToolButton()).toBeDisabled();
    expect(connectorToolButton()).toBeDisabled();

    // Select is always available: it writes nothing.
    clickTool('select');
    expect(pressedTool()).toBe('select');
    // And a click on such a board writes nothing at all.
    clickBoard();
    expect(docNotes()).toEqual([]);
  });

  it('TC-22h leaves a writing tool the moment the board stops taking edits', () => {
    keydown('s');
    expect(pressedTool()).toBe('shape');

    // The room answers "I could not open this board" while the person is standing in
    // a mode whose every drag would now do nothing.
    failToLoad(connectionLink());

    expect(pressedTool()).toBe('select');
    expect(toolSurfaceExists('shape')).toBe(false);
    expect(shapeToolButton()).toBeDisabled();
  });
});
