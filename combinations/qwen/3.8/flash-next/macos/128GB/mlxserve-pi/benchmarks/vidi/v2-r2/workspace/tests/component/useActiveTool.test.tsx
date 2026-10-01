// Story 10, the tool the pointer holds (TC-22).
//
// A tool is a state of this person's screen and nothing else: it is not in the
// document, another person never sees it, and there is exactly one of it. Story 10
// adds two tools to a board that had two, so "exactly one" is no longer something a
// boolean gives for free - it is the rule these tests hold the code to, together with
// the two habits the PRD asks for: a tool that has just drawn something hands the
// pointer back to Select so the thing can be adjusted straight away, and a tool let go
// of with Escape draws nothing at all.
//
// Every tool is asked through its key and through its button, because the PRD's rule
// is that the two are the same state rather than two ways of doing something similar.

import { describe, expect, it } from 'vitest';
import { centre } from '../../src/shared/objects/connector';
import {
  connectorCount,
  connectorToolButton,
  connectorToolLayer,
  drawOnPen,
  forceConnectionState,
  flushFrames,
  holdConnectorTool,
  holdPenTool,
  holdShapeTool,
  newShape,
  penToolButton,
  penToolLayer,
  pointerOnLayer,
  pressKey,
  renderBoard,
  screenOf,
  selectedConnectors,
  selectedShapes,
  selectedStrokes,
  shapeAt,
  shapeBox,
  shapeCount,
  shapeToolButton,
  shapeToolLayer,
  strokeCount,
  textToolSelectButton,
  textToolTextButton,
  useBoardTestLifecycle,
  viewportEl,
} from './helpers';
import { clickOn, dragOn } from './helpers';

/** Whether a tool button says it is the tool being held. */
function held(el: HTMLElement | null): string | null {
  return el?.getAttribute('aria-pressed') ?? null;
}

const SELECT = (): HTMLElement | null => textToolSelectButton();

describe('the tool the pointer holds (TC-22)', () => {
  useBoardTestLifecycle();

  it('TC-22 S holds the Shape tool, L the Connector tool, and only one tool is held', () => {
    renderBoard();

    holdShapeTool();
    flushFrames();
    expect(held(shapeToolButton())).toBe('true');
    expect(held(SELECT())).toBe('false');
    expect(held(connectorToolButton())).toBe('false');
    expect(shapeToolLayer()).not.toBeNull();
    expect(connectorToolLayer()).toBeNull();

    // the next letter does not add a tool: it changes which one is held
    holdConnectorTool();
    flushFrames();
    expect(held(connectorToolButton())).toBe('true');
    expect(held(shapeToolButton())).toBe('false');
    expect(connectorToolLayer()).not.toBeNull();
    expect(shapeToolLayer()).toBeNull();

    // and V is a tool like any other, so it lets go of the arrow as well
    pressKey('v');
    flushFrames();
    expect(held(SELECT())).toBe('true');
    expect(held(connectorToolButton())).toBe('false');
    expect(connectorToolLayer()).toBeNull();
  });

  it('TC-22 the button holds the same tool the letter does', () => {
    const { doc } = renderBoard();

    // the button, then the key: the same two states, in the other order
    const button = shapeToolButton();
    if (button === null) throw new Error('the toolbar offers no Shape button');
    clickOn(button);
    flushFrames();
    expect(held(shapeToolButton())).toBe('true');
    expect(shapeToolLayer()).not.toBeNull();

    pressKey('v');
    flushFrames();
    expect(held(shapeToolButton())).toBe('false');
    expect(shapeToolLayer()).toBeNull();

    // and a tool held by its key makes the thing its button would make: the state is
    // one thing, so what it makes cannot depend on how it came to be held
    holdShapeTool();
    dragOn(shapeToolLayer(), screenOf({ x: -200, y: -100 }), screenOf({ x: 0, y: 20 }));
    expect(shapeCount()).toBe(1);
    void doc;
  });

  it('TC-22 a drawn shape hands the pointer back to Select, with the shape selected', () => {
    renderBoard();

    holdShapeTool();
    dragOn(shapeToolLayer(), screenOf({ x: -260, y: -120 }), screenOf({ x: -60, y: 20 }));

    expect(shapeCount()).toBe(1);
    expect(selectedShapes()).toHaveLength(1);
    // the tool is done with: the thing it made is what the pointer is now holding
    expect(shapeToolLayer()).toBeNull();
    expect(held(shapeToolButton())).toBe('false');
    expect(held(SELECT())).toBe('true');

    // and the next drag is the board's, not another shape: dragging the board after
    // a shape is drawn selects nothing new and draws nothing new
    dragOn(shapeToolLayer() ?? viewportEl(), screenOf({ x: 100, y: 100 }), screenOf({ x: 200, y: 200 }));
    expect(shapeCount()).toBe(1);
  });

  it('TC-22 a drawn arrow hands the pointer back to Select too', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -300, y: -60 });
    newShape(doc, { x: 60, y: -60 });
    flushFrames();

    holdConnectorTool();
    dragOn(connectorToolLayer(), screenOf(centre(shapeBox(0))), screenOf(centre(shapeBox(1))));

    expect(connectorCount()).toBe(1);
    expect(selectedConnectors()).toHaveLength(1);
    expect(connectorToolLayer()).toBeNull();
    expect(held(connectorToolButton())).toBe('false');
    expect(held(SELECT())).toBe('true');
    // the shapes are where they were: drawing an arrow moved nothing
    expect(shapeBox(0).x).toBeCloseTo(-300, 3);
  });

  it('TC-22 Escape gives the tool up, and nothing is drawn by a tool that was let go', () => {
    const { doc } = renderBoard();

    holdShapeTool();
    expect(shapeToolLayer()).not.toBeNull();
    pressKey('Escape');
    flushFrames();
    expect(shapeToolLayer()).toBeNull();
    expect(shapeCount()).toBe(0);
    expect(held(SELECT())).toBe('true');
    expect(held(shapeToolButton())).toBe('false');

    // a drag in mid-flight is not a promise: the press and its moves belong to a
    // layer that Escape takes away, so a release that still arrives makes nothing
    holdShapeTool();
    const layer = shapeToolLayer();
    const from = screenOf({ x: -220, y: -120 });
    const to = screenOf({ x: -40, y: 20 });
    pointerOnLayer(layer, 'pointerdown', from);
    pointerOnLayer(layer, 'pointermove', to);
    flushFrames();
    pressKey('Escape');
    flushFrames();
    expect(shapeToolLayer()).toBeNull();
    pointerOnLayer(layer, 'pointerup', to); // the release arrives after the tool is gone
    flushFrames();
    expect(shapeCount()).toBe(0);

    // the same for an arrow: Escape lets the tool go, and a tool that is gone draws
    // nothing when the pointer comes up
    holdConnectorTool();
    expect(connectorToolLayer()).not.toBeNull();
    pressKey('Escape');
    flushFrames();
    expect(connectorToolLayer()).toBeNull();
    expect(connectorCount()).toBe(0);
    expect(held(SELECT())).toBe('true');
    expect(held(connectorToolButton())).toBe('false');

    // nothing was written down about any of it: no shape, no arrow, no selection
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-22 Escape after a shape is drawn backs out of the selection, not the tool', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -200, y: -80 });
    flushFrames();

    // the tool is already Select, so the first Escape is the selection's
    clickOn(shapeAt(0), screenOf(centre(shapeBox(0))).x, screenOf(centre(shapeBox(0))).y);
    expect(selectedShapes()).toHaveLength(1);
    pressKey('Escape');
    flushFrames();
    expect(selectedShapes()).toHaveLength(0);
    expect(held(SELECT())).toBe('true');
    // and the shape is still on the board: backing out of a selection deletes nothing
    expect(shapeCount()).toBe(1);
  });

  it('TC-22 P holds the Pen, and the Pen is the tool that keeps the pointer it drew with', () => {
    renderBoard();

    holdPenTool();
    flushFrames();
    expect(held(penToolButton())).toBe('true');
    expect(held(SELECT())).toBe('false');
    expect(penToolLayer()).not.toBeNull();
    expect(shapeToolLayer()).toBeNull();

    // A shape and an arrow hand the pointer back to Select, because what they make is
    // about to be typed into or dragged. A line does not: the next thing a person
    // holding a pen does is draw another line, so the Pen keeps the floor and only the
    // selection moves to what was drawn.
    drawOnPen(screenOf({ x: -240, y: -100 }), screenOf({ x: -40, y: 60 }));
    expect(strokeCount()).toBe(1);
    expect(selectedStrokes()).toHaveLength(1);
    expect(penToolLayer()).not.toBeNull();
    expect(held(penToolButton())).toBe('true');
    expect(held(SELECT())).toBe('false');

    // and the second line is drawn as easily as the first, which is the whole point
    drawOnPen(screenOf({ x: 40, y: -60 }), screenOf({ x: 220, y: 80 }));
    expect(strokeCount()).toBe(2);

    // V is the way back, like every other tool
    pressKey('v');
    flushFrames();
    expect(held(SELECT())).toBe('true');
    expect(held(penToolButton())).toBe('false');
    expect(penToolLayer()).toBeNull();
    // nothing was deleted on the way out of the tool
    expect(strokeCount()).toBe(2);
  });

  it('a letter that names a tool this build does not ship holds nothing', () => {
    renderBoard();

    // I and C are reserved for the image and the comment tools: a board left holding a
    // tool with nothing to render it would eat the next click, so these letters stay
    // the browser's. P is not one of them any more - story 11 ships the Pen, and a
    // pressing P holds it - which is what `the Pen tool` tests draw out.
    for (const key of ['i', 'c']) {
      pressKey(key);
      flushFrames();
      expect(held(SELECT())).toBe('true');
      expect(shapeToolLayer()).toBeNull();
      expect(connectorToolLayer()).toBeNull();
    }

    // N is not a tool either: it makes a note where the view is (story 9)
    expect(held(SELECT())).toBe('true');
  });

  it('a board that stops being editable cannot be left holding a tool', () => {
    renderBoard();

    holdConnectorTool();
    expect(connectorToolLayer()).not.toBeNull();

    // the room went, or the link turned out to be a read-only one: a tool held now
    // would eat the next click and make nothing, so the board takes Select back
    forceConnectionState('load_failed');
    flushFrames();
    expect(connectorToolLayer()).toBeNull();
    expect(held(SELECT())).toBe('true');
    expect(held(connectorToolButton())).toBe('false');

    // and the keys that name tools are refused from here on
    holdShapeTool();
    expect(shapeToolLayer()).toBeNull();
    expect(held(shapeToolButton())).toBe('false');
    // the Pen is a tool too, and a Pen that cannot draw is worse than none: it would
    // swallow every press meant for the board
    holdPenTool();
    expect(penToolLayer()).toBeNull();
    expect(held(penToolButton())).toBe('false');
    // the board's own keys still answer, and no tool is held on a board that is not
    // the reader's to change
    expect(held(SELECT())).toBe('true');
    expect(held(textToolTextButton())).toBe('false');
  });
});
