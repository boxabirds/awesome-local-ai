// shape.tool / shape.object / shape.toolbar (ui-component): holding the Shape tool,
// the shape it draws, the name typed into it and the colours put on it.
//
// A shape is a box with a word in it, so it borrows almost everything from the two
// kinds of object already on the board: it is dragged, selected, resized and typed
// into the way a sticky note is, and it is a box whose size is its own the way a
// text object's height is not. What is new is that a *tool* draws it: the drag that
// makes a shape is a drag over the board rather than a drag of an object, and the
// line between the two is exactly what these tests are about - a press that begins
// on an object and is held by the Shape tool must move the object not at all.

import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  DEFAULT_SHAPE_FILL,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { getShapeLabel, shapeSnapshot } from '../../src/shared/objects/shape';
import { snapshot } from '../../src/shared/board-model';
import {
  clickOn,
  doubleClickOn,
  dragOn,
  flushFrames,
  holdShapeTool,
  newNote,
  notePosition,
  pointerOnLayer,
  pressKey,
  renderBoard,
  forceConnectionState,
  shapeAt,
  shapeBox,
  shapeCount,
  shapeFillSwatch,
  shapeInput,
  shapeInputValue,
  shapeKindButton,
  shapeKindMenu,
  shapeKindOf,
  shapeLabelOf,
  shapePreviewEl,
  shapeStrokeSwatch,
  shapeToolbarDelete,
  shapeToolbarElement,
  shapeToolButton,
  shapeToolLayer,
  screenOf,
  selectedNotes,
  selectedShapes,
  textToolSelectButton,
  useBoardTestLifecycle,
  worldOfScreen,
  newShape,
} from './helpers';

const px = (value: string): number => Number.parseFloat(value);

/** The tool button as a button, so its `disabled` state is readable. */
function button(testId: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`no button ${testId}`);
  return el;
}

const shapeButton = button;

/** The centre of the box a shape is drawn in, in screen pixels. */
function centreOfShape(index: number): { x: number; y: number } {
  const box = shapeBox(index);
  return screenOf({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

describe('the Shape tool', () => {
  useBoardTestLifecycle();

  it('TC-15 S holds the tool, a drag shows the box and draws exactly that box, selected', () => {
    const { doc } = renderBoard();
    expect(shapeToolLayer()).toBeNull();

    holdShapeTool();
    expect(shapeToolButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('false');
    const layer = shapeToolLayer();
    expect(layer).not.toBeNull();

    const from = { x: 200, y: 150 };
    const to = { x: 300, y: 210 };
    const start = worldOfScreen(from);
    const stop = worldOfScreen(to);

    pointerOnLayer(layer, 'pointerdown', from);
    pointerOnLayer(layer, 'pointermove', to);

    // The preview is the box the model will store, drawn where the camera puts it -
    // so what a test sees being dragged is what gets written. The layer is screen
    // sized, so the box it shows is in screen pixels: the same box, one scale away.
    const preview = shapePreviewEl();
    expect(preview).not.toBeNull();
    const shownFrom = screenOf(start);
    const shownTo = screenOf(stop);
    expect(px(preview!.style.left)).toBeCloseTo(Math.min(shownFrom.x, shownTo.x), 3);
    expect(px(preview!.style.top)).toBeCloseTo(Math.min(shownFrom.y, shownTo.y), 3);
    expect(px(preview!.style.width)).toBeCloseTo(Math.abs(shownTo.x - shownFrom.x), 3);
    expect(px(preview!.style.height)).toBeCloseTo(Math.abs(shownTo.y - shownFrom.y), 3);

    pointerOnLayer(layer, 'pointerup', to);
    flushFrames();

    // one shape, the box the drag described, and nothing else on the board
    expect(shapeCount()).toBe(1);
    expect(shapeBox(0)).toEqual({
      x: Math.min(start.x, stop.x),
      y: Math.min(start.y, stop.y),
      width: Math.abs(stop.x - start.x),
      height: Math.abs(stop.y - start.y),
    });
    expect(shapeKindOf(0)).toBe('rect');
    expect(shapeSnapshot(doc, shapeAt(0).dataset.shapeId ?? '')?.fill).toBe(DEFAULT_SHAPE_FILL);
    // the preview was a preview: it goes away with the drag
    expect(shapePreviewEl()).toBeNull();
    // the shape just drawn is the one being worked on, and the tool let go of itself
    expect(selectedShapes()).toHaveLength(1);
    expect(shapeToolLayer()).toBeNull();
  });

  it('TC-15 a click makes a shape of the standard size where it landed', () => {
    renderBoard();
    holdShapeTool();
    const at = { x: 400, y: 300 };
    dragOn(shapeToolLayer(), at, at);

    const here = worldOfScreen(at);
    expect(shapeCount()).toBe(1);
    expect(shapeBox(0)).toEqual({
      x: here.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: here.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('TC-28 a Shape tool drag that begins on a sticky note moves that note not at all', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: -100, y: -60 });
    flushFrames();
    const before = notePosition(0);
    const over = screenOf({
      x: before.x + STICKY_SIZE_WORLD / 2,
      y: before.y + STICKY_SIZE_WORLD / 2,
    });

    // the press lands on the note, which is the only way this could go wrong: the
    // note's own grab would start a move, and the tool would be drawing through it
    holdShapeTool();
    dragOn(shapeToolLayer(), over, { x: over.x + 160, y: over.y + 120 });
    flushFrames();

    expect(notePosition(0)).toEqual(before);
    expect(shapeCount()).toBe(1);
    // the shape is drawn over the note rather than instead of it
    expect(shapeBox(0).width).toBeGreaterThan(0);
    expect(selectedNotes()).toHaveLength(0);
  });

  it('TC-15 ⇧ while dragging makes a square out of the drag, anchored where it began', () => {
    renderBoard();
    holdShapeTool();
    const from = { x: 150, y: 150 };
    const to = { x: 350, y: 250 };
    const start = worldOfScreen(from);
    const stop = worldOfScreen(to);
    const layer = shapeToolLayer();
    pointerOnLayer(layer, 'pointerdown', from);
    pointerOnLayer(layer, 'pointermove', { x: 250, y: 200 }, { shiftKey: true });
    pointerOnLayer(layer, 'pointermove', to, { shiftKey: true });
    pointerOnLayer(layer, 'pointerup', to, { shiftKey: true });
    flushFrames();

    expect(shapeCount()).toBe(1);
    const box = shapeBox(0);
    expect(box.width).toBeCloseTo(Math.abs(stop.x - start.x), 3);
    expect(box.width).toBeCloseTo(box.height, 3);
    expect(box.x).toBeCloseTo(Math.min(start.x, stop.x), 3);
    expect(box.y).toBeCloseTo(Math.min(start.y, stop.y), 3);
  });

  it('the kind menu is held beside the Shape tool and decides the next shape', () => {
    renderBoard();
    expect(shapeKindMenu()).toBeNull();

    holdShapeTool();
    expect(shapeKindMenu()).not.toBeNull();
    expect(shapeKindButton('rect')?.getAttribute('aria-checked')).toBe('true');
    expect(shapeKindButton('diamond')?.getAttribute('aria-checked')).toBe('false');

    clickOn(shapeKindButton('diamond'));
    expect(shapeKindButton('diamond')?.getAttribute('aria-checked')).toBe('true');
    // choosing a kind is not drawing one: the tool is still held
    expect(shapeToolLayer()).not.toBeNull();

    dragOn(shapeToolLayer(), { x: 200, y: 150 }, { x: 360, y: 290 });
    expect(shapeCount()).toBe(1);
    expect(shapeKindOf(0)).toBe('diamond');
  });

  it('TC-16 double-clicking a shape opens an editor and the label stops at the limit', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -80, y: -60 });
    flushFrames();
    const id = shapeAt(0).dataset.shapeId ?? '';

    const at = centreOfShape(0);
    doubleClickOn(shapeAt(0), at.x, at.y);
    flushFrames();

    const editor = shapeInput();
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);

    const typed = 'x'.repeat(600);
    fireEvent.input(editor!, { target: { value: typed } });
    expect(shapeInputValue().length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(getShapeLabel(doc, id)?.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);

    // Escape leaves editing; what was typed stays, and is read as a label again
    pressKey('Escape');
    flushFrames();
    expect(shapeInput()).toBeNull();
    expect(shapeLabelOf(0).length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17 the fill and outline swatches recolour the shape and touch nothing else', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -80, y: -60 }, { label: 'Faster onboarding' });
    flushFrames();
    const id = shapeAt(0).dataset.shapeId ?? '';

    const at = centreOfShape(0);
    clickOn(shapeAt(0), at.x, at.y);
    flushFrames();

    // the shape's own bar, in the place the selection bar would have stood
    expect(shapeToolbarElement()).not.toBeNull();
    expect(shapeFillSwatch('blue')?.getAttribute('aria-pressed')).toBe('false');

    clickOn(shapeFillSwatch('blue'));
    flushFrames();
    clickOn(shapeStrokeSwatch('red'));
    flushFrames();

    const after = shapeSnapshot(doc, id);
    expect(after?.fill).toBe('blue');
    expect(after?.stroke).toBe('red');
    // recolouring is recolouring: the name and the box and the selection are untouched
    expect(after?.label).toBe('Faster onboarding');
    expect(shapeBox(0).width).toBe(200);
    expect(selectedShapes()).toHaveLength(1);
    expect(shapeFillSwatch('blue')?.getAttribute('aria-pressed')).toBe('true');
    expect(shapeStrokeSwatch('red')?.getAttribute('aria-pressed')).toBe('true');
    expect(shapeFillSwatch('none')?.getAttribute('aria-label')).toBe('No fill');
    expect(shapeStrokeSwatch('dark')?.getAttribute('aria-label')).toBe('Dark outline');
  });

  it('TC-17 the delete button on the shape bar takes the shape and its label with it', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -80, y: -60 }, { label: 'Flow' });
    flushFrames();
    const before = snapshot(doc).length;

    const at = centreOfShape(0);
    clickOn(shapeAt(0), at.x, at.y);
    flushFrames();
    clickOn(shapeToolbarDelete());
    flushFrames();

    expect(shapeCount()).toBe(0);
    expect(snapshot(doc).length).toBe(before);
    expect(shapeToolbarElement()).toBeNull();
  });

  it('a shape is dragged, and a drag that never travels is a click that selects', () => {
    const { doc } = renderBoard();
    newShape(doc, { x: -80, y: -60 });
    flushFrames();
    const before = shapeBox(0);

    const at = centreOfShape(0);
    dragOn(shapeAt(0), at, { x: at.x + 90, y: at.y + 40 });
    flushFrames();

    const after = shapeBox(0);
    expect(after.x).toBeCloseTo(before.x + 90, 3);
    expect(after.y).toBeCloseTo(before.y + 40, 3);
    expect(selectedShapes()).toHaveLength(1);

    // and the same press somewhere else does not move it again
    clickOn(shapeAt(0), at.x + 90, at.y + 40);
    expect(shapeBox(0).x).toBeCloseTo(after.x, 3);
  });

  it('a board the room could not read takes no shape tool: S is ignored, the button is off', () => {
    renderBoard();
    forceConnectionState('load_failed');

    holdShapeTool();
    expect(shapeToolLayer()).toBeNull();
    expect(shapeToolButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(shapeButton('tool-shape').disabled).toBe(true);
    // and the board still answers its own keys: the tool is not holding anything
    pressKey('v');
    expect(textToolSelectButton()?.getAttribute('aria-pressed')).toBe('true');
  });
});
