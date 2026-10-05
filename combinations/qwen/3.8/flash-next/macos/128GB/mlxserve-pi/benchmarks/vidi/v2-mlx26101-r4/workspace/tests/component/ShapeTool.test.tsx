/**
 * Drawing shapes with the Shape tool, and writing in them afterwards (story 10, TC-15 to TC-17, TC-28).
 *
 * These are the four ways a drawing tool goes wrong, and one test apiece:
 *
 *   - TC-15 — a tool that writes on every pointermove puts forty shapes on five people's boards while the
 *     pointer travels from one corner to the other. So: a preview while travelling, one shape afterwards,
 *     and the new shape selected, because the person who drew it wants to do something to it next.
 *   - TC-16 — a label with no limit is a shape that can be grown past the size of the screen by pasting a
 *     novel into it. The limit is 500 characters, and it holds against typing *and* pasting.
 *   - TC-17 — a colour control that also moves, resizes, deselects or rewrites the words is not a colour
 *     control. Clicking two swatches changes exactly two fields.
 *   - TC-28 — the one thing a tool that lies over the board must never do: touch what it lies over. A drag
 *     that starts on a sticky note with the Shape tool armed draws a shape and leaves the note alone.
 *
 * TC-28 is the reason the tool is a sheet over the board rather than a flag on it: the press is taken at the
 * top, so there is no code in here that could forget to leave the note alone and get it wrong.
 *
 * Each test frames the camera on the world origin, which makes screen and board the same numbers and lets the
 * design's own figures — a drag from (100,100) to (300,220) — appear in the test exactly as it writes them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  activeTool,
  addNote,
  addShape,
  armShapeTool,
  centreOf,
  frameAtOrigin,
  labelText,
  moveWindow,
  pasteIntoShape,
  pressShape,
  renderBoard,
  shapeById,
  shapeElement,
  shapes,
  stickies,
  sweep,
  typeIntoShape,
  upWindow,
  WORLD_CENTRE,
} from './helpers/tools';
import { pointerDown, stickyById, surface } from './helpers/stickyBoard';
import { noteToolbarVisible, outlinedIds, pressEscape } from './helpers/selection';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';

describe('the Shape tool (TC-15, TC-28)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-15: shows a preview while the pointer travels and makes one shape when it lets go', async () => {
    const sheet = await armShapeTool();
    // The drag the design names: (100,100) to (300,220), which is a shape 200 by 120.
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };

    pointerDown(sheet, from.x, from.y);
    // The preview belongs to this render, not to the document: while the pointer is travelling the model has
    // no opinion about this shape yet, and a shape per pointermove is the bug this file exists to prevent.
    expect(screen.getByTestId('shape-preview')).toBeInTheDocument();
    expect(shapes()).toHaveLength(0);

    moveWindow({ x: 200, y: 160 });
    expect(shapes()).toHaveLength(0);
    const preview = screen.getByTestId('shape-preview');
    expect(preview.style.width).toBe('100px');
    expect(preview.style.height).toBe('60px');

    moveWindow(to);
    upWindow(to);

    await waitFor(() => expect(shapes()).toHaveLength(1));
    const shape = shapes()[0]!;
    expect(shape).toMatchObject({ type: 'shape', kind: 'rect', x: 100, y: 100, width: 200, height: 120 });

    // The preview was a promise and the document is the answer: the sheet, and the box on it, are gone.
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(screen.queryByTestId('shape-tool')).toBeNull();

    // The shape is the selection and the tool is back on Select, which is the story's "adjust it now".
    await waitFor(() => expect(outlinedIds()).toEqual([shape.id]));
    expect(activeTool()).toBe('select');
  });

  it('TC-15: while the Shape tool is armed the board double-click is borrowed, not withdrawn', async () => {
    const sheet = await armShapeTool();
    // A drag ends with a click, and a quick pair of drags ends with a double-click, delivered wherever the
    // pointer let go. In Select mode that gesture means "a note here" — story 2's, and worth keeping. While
    // a drawing tool is up it means nothing: the gesture belongs to the tool, and a board that made a note
    // out of it would be making an object out of the tail of a drag that was never about the board.
    expect(sheet).toBeInTheDocument();
    fireEvent.doubleClick(surface(), { clientX: 300, clientY: 220 });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(stickies()).toHaveLength(0);

    // Put the tool down and the same double-click is a note again.
    pressEscape();
    fireEvent.doubleClick(surface(), { clientX: 300, clientY: 220 });
    await waitFor(() => expect(stickies()).toHaveLength(1));
  });

  it('TC-28: a drag that starts on a sticky note draws a shape and leaves the note where it was', async () => {
    const note = addNote(WORLD_CENTRE);
    const before = stickyById(note);

    const sheet = await armShapeTool();
    // Straight across the middle of the note: the press that a tool with any doubt about who owns the
    // pointer would hand to the note.
    sweep(sheet, { x: -100, y: -100 }, { x: 100, y: 100 });

    await waitFor(() => expect(shapes()).toHaveLength(1));
    const after = stickyById(note);
    expect({ x: after.x, y: after.y, z: after.z }).toEqual({ x: before.x, y: before.y, z: before.z });
    // The note was not even selected. A press that was never aimed at it cannot be allowed to leave its mark
    // on the selection either.
    expect(outlinedIds()).toEqual([shapes()[0]!.id]);
    expect(noteToolbarVisible()).toBe(false);
  });

  it('TC-28: and a drag that starts on another shape moves that shape either', async () => {
    const shape = addShape({ x: -60, y: -60, width: 120, height: 120 });
    const before = shapeById(shape);

    const sheet = await armShapeTool();
    sweep(sheet, centreOf(before), { x: 200, y: 200 });

    await waitFor(() => expect(shapes()).toHaveLength(2));
    const after = shapeById(shape);
    expect(after).toMatchObject({ x: before.x, y: before.y, width: before.width, height: before.height });
  });

  it('a pointer taken away mid-drag makes nothing and leaves the tool armed', async () => {
    const sheet = await armShapeTool();
    pointerDown(sheet, 100, 100);
    moveWindow({ x: 250, y: 200 });
    fireEvent(window, new PointerEvent('pointercancel', { bubbles: true, clientX: 250, clientY: 200 }));

    await waitFor(() => expect(screen.queryByTestId('shape-preview')).toBeNull());
    expect(shapes()).toHaveLength(0);
    // The person is still holding the tool they chose: nothing went wrong that they were told about.
    expect(activeTool()).toBe('shape');
  });

  it('Escape puts the tool down mid-drag and makes nothing, and letting go afterwards makes nothing either', async () => {
    const sheet = await armShapeTool();
    pointerDown(sheet, 100, 100);
    moveWindow({ x: 300, y: 220 });

    pressEscape();

    await waitFor(() => expect(screen.queryByTestId('shape-tool')).toBeNull());
    expect(shapes()).toHaveLength(0);
    expect(activeTool()).toBe('select');
    // The gesture was cancelled along with the tool that owned it, so the release that comes after it — which
    // a browser still delivers — is not a shape.
    upWindow({ x: 300, y: 220 });
    expect(shapes()).toHaveLength(0);
  });

  it('a click makes a shape of the board’s standard size, centred where it was clicked', async () => {
    const sheet = await armShapeTool();
    // A press and a release in the same place says "a shape here" and nothing about how big.
    sweep(sheet, { x: 400, y: 300 }, { x: 400, y: 300 }, 1);

    await waitFor(() => expect(shapes()).toHaveLength(1));
    const shape = shapes()[0]!;
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(centreOf(shape)).toEqual({ x: 400, y: 300 });
  });

  it('the kind menu decides what the next shape is, and the choice is what gets stored', async () => {
    const sheet = await armShapeTool();
    expect(sheet.dataset.shapeKind).toBe('rect');

    fireEvent.change(screen.getByTestId('shape-kind'), { target: { value: 'diamond' } });
    await waitFor(() => expect(screen.getByTestId('shape-tool').dataset.shapeKind).toBe('diamond'));

    sweep(sheet, { x: 100, y: 100 }, { x: 260, y: 260 });
    await waitFor(() => expect(shapes()).toHaveLength(1));
    expect(shapes()[0]!.kind).toBe('diamond');
    // Drawn as the polygon through the four midpoints, which is also why an arrow joins a diamond at the same
    // four points it joins a rectangle.
    expect(screen.getByTestId('shape-svg').querySelector('polygon')).not.toBeNull();
  });
});

describe('a shape’s label and colours (TC-16, TC-17)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-16: double-clicking a shape opens its label and keeps 500 of the 600 characters pasted in', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });

    fireEvent.doubleClick(shapeElement(id));
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeInTheDocument());

    pasteIntoShape('x'.repeat(600));

    // The limit is applied on the way into the shared document, not on the way out to the screen: what the
    // other four people are sent is 500 characters, not 600 with five of them hidden.
    await waitFor(() =>
      expect(screen.getByTestId('shape-textarea')).toHaveProperty('value', 'x'.repeat(SHAPE_LABEL_MAX_CHARS)),
    );
    await waitFor(() => expect(labelText(id)).toHaveLength(SHAPE_LABEL_MAX_CHARS));
  });

  it('TC-16: typing past the limit stops at the limit as well', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    fireEvent.doubleClick(shapeElement(id));
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeInTheDocument());

    typeIntoShape('y'.repeat(600));
    await waitFor(() => expect(labelText(id)).toHaveLength(SHAPE_LABEL_MAX_CHARS));
  });

  it('TC-16: the label is the shape’s words, and they are still there when the editor closes', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    fireEvent.doubleClick(shapeElement(id));
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeInTheDocument());
    typeIntoShape('flow');
    await waitFor(() => expect(labelText(id)).toBe('flow'));

    pressEscape();
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeNull());
    expect(screen.getByTestId('shape-label').textContent).toBe('flow');
    // Still one shape, still in the same place: words that resized the box would be words that moved an
    // object its owner never touched.
    expect(shapes()).toHaveLength(1);
    expect(shapeById(id)).toMatchObject({ x: 100, y: 100, width: 200, height: 120 });
  });

  it('TC-16: a letter typed into a label is a letter, not a tool', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    fireEvent.doubleClick(shapeElement(id));
    await waitFor(() => expect(screen.queryByTestId('shape-textarea')).toBeInTheDocument());

    fireEvent.keyDown(screen.getByTestId('shape-textarea'), { key: 's' });
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(activeTool()).toBe('select');
  });

  it('TC-17: a fill swatch and an outline swatch change those two fields and nothing else', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    pressShape(id);
    await waitFor(() => expect(screen.queryByTestId('shape-toolbar')).toBeInTheDocument());

    const before = shapeById(id);
    expect(before.fill).toBe('white');
    expect(before.stroke).toBe('dark');

    fireEvent.click(screen.getByLabelText('Blue fill'));
    fireEvent.click(screen.getByLabelText('Red outline'));

    await waitFor(() => {
      const after = shapeById(id);
      expect(after.fill).toBe('blue');
      expect(after.stroke).toBe('red');
    });

    // A colour is a colour: the box, the kind, the words and the selection are all somebody else's business.
    const after = shapeById(id);
    expect(after).toMatchObject({ x: before.x, y: before.y, width: before.width, height: before.height, kind: before.kind });
    expect(outlinedIds()).toEqual([id]);
  });

  it('TC-17: the swatch of the colour the shape wears reads as pressed, and "no fill" is a colour', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    pressShape(id);
    await waitFor(() => expect(screen.queryByTestId('shape-toolbar')).toBeInTheDocument());

    expect(screen.getByLabelText('White fill')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByLabelText('None fill'));
    await waitFor(() => expect(shapeById(id).fill).toBe('none'));
    // Every swatch says which colour it is, because a square of colour is the one control that cannot show
    // its own name to a screen reader.
    expect(screen.getByLabelText('None fill')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Dark outline')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-17: repainting is one undo step, and undo brings the old colour back', async () => {
    const id = addShape({ x: 100, y: 100, width: 200, height: 120 });
    pressShape(id);
    await waitFor(() => expect(screen.queryByTestId('shape-toolbar')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Green fill'));
    await waitFor(() => expect(shapeById(id).fill).toBe('green'));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(shapeById(id).fill).toBe('white'));
  });

  it('TC-17: the toolbar belongs to one selected shape, so a group is not given one', async () => {
    const first = addShape({ x: 100, y: 100, width: 120, height: 120 });
    const second = addShape({ x: 400, y: 100, width: 120, height: 120 });
    pressShape(first);
    await waitFor(() => expect(screen.queryByTestId('shape-toolbar')).toBeInTheDocument());

    pressShape(second, { shiftKey: true });
    await waitFor(() => expect(outlinedIds().length).toBe(2));
    // Which of the two would change colour? The question has no answer, so the toolbar does not guess one.
    expect(screen.queryByTestId('shape-toolbar')).toBeNull();
    expect(shapeById(first).fill).toBe('white');
    expect(shapeById(second).fill).toBe('white');
  });
});
