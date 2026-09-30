// What a shape looks like, and what typing into one does (`shape.ui`, `shape.label`).
//
// Everything here runs against the real `<Board>` with the fake provider, because a shape
// is a thing on a screen: whether the label sits in the middle of the shape, whether the
// shape tool's sheet got in the way of the shape underneath it, whether 600 characters
// typed came out as 500 stored. None of that is answerable by calling a function.
//
// One thing the driver does that is worth naming out loud: a drag with a drawing tool up
// is dispatched on the *tool's sheet*, which is the element a browser hands the pointer
// to while that tool is up. The sheet is the tool.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import type * as Y from 'yjs';
import { SHAPE_LABEL_FONT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import {
  FakeWebsocketProvider,
  clickShapeSwatch,
  doc,
  drawShape,
  dragShapeSheet,
  dragShapeSheetPartway,
  dropShape,
  flush,
  makeShape,
  open,
  openShapeLabel,
  pressEscape,
  pressSelectTool,
  pressShapeLabelKey,
  pressShapeTool,
  releaseShapeSheet,
  selectToolActive,
  selectedShapeIds,
  shapeBox,
  shapeColors,
  shapeElement,
  shapeIds,
  shapeLabel,
  shapeLabelEditor,
  shapeLabelText,
  shapeObject,
  shapePreview,
  shapeToolActive,
  typeShapeLabel,
} from './helpers/shape-ui';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'shape-ui-under-test';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('shape.ui', () => {
  // TC-15
  it('TC-15 draws a rectangle, an ellipse and a diamond, and the shape says which it is', () => {
    const rect = dropShape({ x: -420, y: -320 });
    const ellipse = dropShape({ x: -140, y: -320 }, 'ellipse');
    const diamond = dropShape({ x: 140, y: -320 }, 'diamond');

    // The three kinds are three different drawings, not one drawing with a label on it.
    expect(shapeObject(rect).kind).toBe('rect');
    expect(shapeObject(ellipse).kind).toBe('ellipse');
    expect(shapeObject(diamond).kind).toBe('diamond');

    expect(drawnInside(rect).tagName).toBe('rect');
    expect(drawnInside(ellipse).tagName).toBe('ellipse');
    expect(drawnInside(diamond).tagName).toBe('polygon');

    // And the element on the screen carries the kind, so which is which does not depend
    // on measuring a diagonal.
    expect(shapeElement(rect).dataset.kind).toBe('rect');
    expect(shapeElement(ellipse).dataset.kind).toBe('ellipse');
    expect(shapeElement(diamond).dataset.kind).toBe('diamond');

    // A new shape is not left out of the selection: it *is* the selection, which is how
    // its toolbar appears without another click.
    expect(selectedShapeIds()).toEqual([diamond]);
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();
  });

  // The kind being remembered: five ellipses should not need the menu five times.
  it('remembers which kind was asked for after the tool has made one', () => {
    dropShape({ x: -420, y: -320 }, 'ellipse');
    // Back to select after drawing, and the kind is still the one that was picked.
    expect(shapeToolActive()).toBe(false);
    pressShapeTool();
    expect(kindButton('ellipse').getAttribute('aria-pressed')).toBe('true');
    expect(kindButton('rect').getAttribute('aria-pressed')).toBe('false');
  });

  // TC-28
  it('TC-28 takes the gesture for itself instead of moving the shape underneath it', () => {
    const scenery = makeShape({ x: -300, y: -200 });
    const before = shapeBox(scenery);

    pressShapeTool();
    // A drag that starts on top of an existing shape: with the select tool up this would
    // be a move. With the Shape tool up it is a new shape, and the old one does not budge.
    dragShapeSheet({ x: -200, y: -100 }, { x: 200, y: 60 });

    expect(shapeIds()).toHaveLength(2);
    expect(shapeBox(scenery)).toEqual(before);
    // The new shape is the selection, the old one is where it always was, and the tool is
    // done - which is the shape of a drawing tool, not of a move.
    expect(selectedShapeIds()).toEqual(shapeIds().filter((id: string) => id !== scenery));
  });

  it('gives the pointer back to the board as soon as it has drawn', () => {
    const id = dropShape({ x: -300, y: -200 });
    expect(shapeToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    // The sheet is gone, so a press on the board is the board's again - and the shape that
    // was just drawn is a thing that can be selected, which is the next thing a person does.
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(selectedShapeIds()).toEqual([id]);
  });

  it('shows what it is going to draw while it is being drawn', () => {
    pressShapeTool();
    expect(shapePreview()).toBeNull();

    dragShapeSheetPartway({ x: -400, y: -300 }, { x: -200, y: -160 });

    expect(shapePreview()).not.toBeNull();
    // Nothing has been written to the document yet: the preview is this screen's drawing
    // of what the drag will make, not a draft object other people have to be told about.
    expect(shapeIds()).toHaveLength(0);

    releaseShapeSheet({ x: -200, y: -160 });
    expect(shapeIds()).toHaveLength(1);
    expect(shapePreview()).toBeNull();
  });

  it('paints a shape with the colours its toolbar offers', () => {
    const id = dropShape({ x: -300, y: -200 });
    openShapeLabel(id);
    typeShapeLabel('quarterly plan');
    expect(shapeColors(id)).toEqual({ fill: 'white', stroke: 'dark' });

    clickShapeSwatch('Blue fill');
    clickShapeSwatch('Red outline');

    expect(shapeColors(id)).toEqual({ fill: 'blue', stroke: 'red' });
    // The element says what it is painted with, so what the document holds is what is drawn.
    expect(shapeElement(id).dataset.fill).toBe('blue');
    expect(shapeElement(id).dataset.stroke).toBe('red');

    clickShapeSwatch('No fill');
    expect(shapeColors(id).fill).toBe('none');

    // Painting is not renaming and it is not deselecting: the bar belongs to the same
    // shape all the way through, and what it says on it stays.
    expect(selectedShapeIds()).toEqual([id]);
    expect(shapeLabelText(id)).toBe('quarterly plan');
  });

  // TC-28: the Shape tool owns the gesture, so an object under it is scenery.
  it('TC-28 leaves the shape underneath alone when the drag starts on top of it', () => {
    const id = makeShape({ x: -300, y: -200 });
    const before = shapeBox(id);

    const drawn = drawShape({ x: -300, y: -200 }, { x: -120, y: -60 });

    expect(shapeBox(id)).toEqual(before);
    expect(shapeIds()).toEqual([id, drawn]);
    expect(selectedShapeIds()).toEqual([drawn]);
  });

  it('leaves the shape behind when the tool is put down with Escape', () => {
    pressShapeTool();
    dragShapeSheetPartway({ x: -400, y: -300 }, { x: -200, y: -160 });
    pressEscape();
    expect(shapeToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(shapeIds()).toHaveLength(0);
    // Escape with no drag on ends the tool itself, which is what `shape.tool` asks for.
    pressEscape();
    expect(shapeToolActive()).toBe(false);
  });
});

describe('shape.label', () => {
  // TC-16
  it('TC-16 keeps a label to the length the design allows', () => {
    const id = dropShape({ x: -300, y: -200 });
    openShapeLabel(id);

    const tooLong = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    typeShapeLabel(tooLong);

    // 600 characters typed, 500 stored. The limit belongs to the editor, which is the one
    // place a person can find out about it - and it is the editor sticky notes use.
    expect(shapeLabel(id)).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapeLabel(id)).toBe(tooLong.slice(0, SHAPE_LABEL_MAX_CHARS));
  });

  // TC-16, the other half: the words are laid out inside the shape, not beside it.
  it('TC-16 lays the label out in the shape itself, centred and wrapped to it', () => {
    const id = dropShape({ x: -300, y: -200 });
    openShapeLabel(id);
    const words = 'a word long enough that it cannot possibly fit on a line of its own';
    typeShapeLabel(words);
    expect(shapeLabel(id)).toBe(words);

    const box = shapeElement(id).style;
    const label = within(shapeElement(id)).getByTestId('shape-object-label').style;

    // The label's box *is* the shape's box: it is laid out in the shape itself, from edge
    // to edge of it, rather than in a box of its own that somebody has to keep in step.
    // That is what makes resizing a shape re-wrap its text and keep it centred with no
    // second measurement - and there is no second number here to disagree about.
    expect(label.position).toBe('absolute');
    expect(label.inset).toMatch(/^0(px)?$/);
    expect(box.width).toBe('160px');
    expect(box.height).toBe('160px');
    expect(label.display).toBe('flex');
    expect(label.alignItems).toBe('center');
    expect(label.justifyContent).toBe('center');
    expect(label.overflow).toBe('hidden');

    // Long words break where the line ends rather than running out of the shape.
    const span = textOf(id);
    expect(span.style.whiteSpace).toBe('pre-wrap');
    expect(span.style.overflowWrap).toBe('break-word');
    // Board units, so the text keeps its size against the shape at every zoom.
    expect(span.style.fontSize).toBe(`${SHAPE_LABEL_FONT_SIZE_WORLD}px`);
    expect(span.textContent).toBe(words);
  });

  // TC-17
  it('TC-17 opens the label on a double-click, and closes it without losing a word', () => {
    const id = dropShape({ x: -300, y: -200 });

    // Before the double-click there is nothing to type into, and the shape is a shape.
    expect(screen.queryByTestId('shape-object-editor')).toBeNull();
    openShapeLabel(id);

    const editor = shapeLabelEditor();
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.getAttribute('aria-label')).toBe('Shape label');
    expect(shapeElement(id).dataset.editing).toBe('true');

    // What an empty shape says while you are deciding what it should say.
    expect(placeholderText()).toBe('Label');

    typeShapeLabel('start here');
    expect(shapeLabel(id)).toBe('start here');
    expect(shapeLabelText(id)).toBe('start here');
    // With a word in it the shape stops hinting.
    expect(within(shapeElement(id)).queryByTestId('shape-object-placeholder')).toBeNull();

    // Escape: the words stay, the shape keeps the selection, the board gets the keys back.
    pressShapeLabelKey('Escape');
    expect(shapeLabel(id)).toBe('start here');
    expect(screen.queryByTestId('shape-object-editor')).toBeNull();
    expect(selectedShapeIds()).toEqual([id]);
    expect(shapeElement(id).dataset.editing).toBe('false');

    // Somebody else looking at this board is shown the same words.
    expect(shapeLabelText(id)).toBe('start here');
  });

  // A double-click on a shape must not also be a double-click on the board behind it,
  // which would draw a second shape underneath the one being labelled.
  it('TC-17 does not draw a shape underneath the one it just opened', () => {
    const id = dropShape({ x: -300, y: -200 });
    expect(shapeIds()).toHaveLength(1);
    openShapeLabel(id);
    expect(shapeIds()).toHaveLength(1);
    expect(shapeLabelEditor()).toBeTruthy();
  });

  it('TC-17 gives the keyboard back to the board when the label is closed', () => {
    const id = dropShape({ x: -300, y: -200 });
    openShapeLabel(id);
    // With the caret in the label the tool must not move under the person typing: the
    // editor swallows the keystroke, and the board's handler ignores keystrokes in text.
    expect(shapeToolActive()).toBe(false);
    pressShapeLabelKey('Escape');

    // Out of the editor, and the board's keys are live again.
    pressShapeTool();
    expect(shapeToolActive()).toBe(true);
    pressSelectTool();
    expect(shapeToolActive()).toBe(false);
  });

  it('keeps a label inside the shape when the shape is made smaller', () => {
    const id = dropShape({ x: -300, y: -200 });
    openShapeLabel(id);
    typeShapeLabel('narrow');
    pressShapeLabelKey('Escape');

    // A resize: the box changes, and the label's box changes with it because it *is* it.
    const before = shapeBox(id);
    resizeByHand(id, { width: 60, height: 40 });
    expect(shapeBox(id)).toEqual({ x: before.x, y: before.y, width: 60, height: 40 });
    // The shape's own box on the screen is 60 x 40, and the label is laid out inside that
    // same box, so the words are wrapped to the new width without being moved.
    expect(shapeElement(id).style.width).toBe('60px');
    expect(shapeElement(id).style.height).toBe('40px');
    expect(within(shapeElement(id)).getByTestId('shape-object-label').style.inset).toMatch(/^0(px)?$/);
    expect(textOf(id).textContent).toBe('narrow');
  });
});

// --- reading the screen ------------------------------------------------------

/** The element the shape is actually drawn with, inside the shape's own svg. */
function drawnInside(id: string): Element {
  const svg = within(shapeElement(id)).getByTestId('shape-object-svg');
  const drawn = svg.firstElementChild;
  if (!drawn) throw new Error(`shape "${id}" draws nothing`);
  return drawn;
}

const kindButton = (kind: string): HTMLButtonElement =>
  screen.getByTestId(`shape-kind-${kind}`) as HTMLButtonElement;

const textOf = (id: string): HTMLElement =>
  within(shapeElement(id)).getByTestId('shape-object-label').querySelector('span') as HTMLElement;

const placeholderText = (): string =>
  (screen.getByTestId('shape-object-placeholder') as HTMLElement).textContent ?? '';

/**
 * Resize a shape the way the selection's handle does it - by writing the box, which is
 * the only thing a shape owns. The handle itself is story 4's and is tested there; what
 * is being checked here is what a shape's label does when its box changes underneath it.
 */
function resizeByHand(id: string, size: { width: number; height: number }): void {
  const map = doc().getMap<Y.Map<unknown>>('objects').get(id);
  if (!map) throw new Error(`"${id}" is not in the document`);
  act(() => {
    map.set('width', size.width);
    map.set('height', size.height);
  });
  flush();
}
