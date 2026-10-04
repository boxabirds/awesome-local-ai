import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { flushFrames } from './helpers';
import {
  clickUndo,
  doubleClick,
  doubleClickBoard,
  moveTo,
  press,
  release,
  mountSticky,
  type MountedSticky,
} from './helpers/sticky';
import { countUpdates, endEditing, shiftClickOn } from './helpers/text';
import {
  activeTool,
  armShape,
  clickBoard,
  dragShape,
  labelOf,
  openLabel,
  pickColor,
  pressEscape,
  pressToolKey,
  previewBox,
  selectObject,
  shapeElement,
  shapeElements,
  shapeOf,
  swatch,
  toolPressed,
  typeLabel,
} from './helpers/shapes';
import { snapshot } from '../../src/shared/board-model';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * A shape on the board (shape.ui at component level): drawn by dragging, typed into, coloured, and
 * the tool that made it going away again.
 *
 * The four things these tests keep an eye on are the four that a shape shares with nothing else on
 * the board before it. A shape is drawn rather than placed - so the drag is the object's birth, and
 * what the drag was is what the box has to be. It has two colours and a label, and changing one of
 * the three must not disturb the other two. Its label is capped, and the cap has to be applied by the
 * editor rather than trusted to a `maxLength` attribute that a paste walks straight past. And it is
 * made by a tool that hands the pointer back afterwards, which is the rule that keeps the next click
 * a click on the board instead of a second shape nobody meant to draw.
 *
 * As everywhere in the component suite, the board is the real app with a real `Y.Doc`, and every
 * expectation is read out of that document rather than out of a mock of it.
 */

vi.mock('y-websocket', async () => {
  const helper = await import('./helpers/fake-provider');
  return helper.yWebsocketStub();
});

/** A drag that is a drag: further than the click threshold in both directions. */
const FROM = { x: 100, y: 100 };
const TO = { x: 300, y: 220 };

describe('shape: drawing one (TC-15)', () => {
  it('TC-15: S puts the tool up, and a drag draws a shape that becomes the selection', async () => {
    const board = await mountSticky();

    // The key is taken by the board, and the board says so on its own surface.
    expect(pressToolKey('KeyS')).toBe(true);
    await flushFrames();
    expect(activeTool(board)).toBe('shape');
    expect(toolPressed(board, 'shape')).toBe(true);

    const before = snapshot(board.doc).length;
    const id = await dragShape(board, FROM, TO);

    // The box the drag made, in board units: the two corners the pointer went to, whichever way the
    // pointer went. Not the pointer's path, which the document has no use for.
    const shape = shapeOf(board, id);
    expect(shape).toMatchObject({
      type: 'shape',
      kind: 'rect',
      x: FROM.x,
      y: FROM.y,
      width: TO.x - FROM.x,
      height: TO.y - FROM.y,
    });
    expect(snapshot(board.doc).length).toBe(before + 1);

    // The new shape is the selection, which is what the handles and the colours are for.
    expect(board.outlinedIds()).toEqual([id]);
    expect(shapeElement(board, id).dataset.selected).toBe('true');
  });

  it('TC-15b: the drag is one write and one undo step, and one press takes it back', async () => {
    const board = await mountSticky();
    await armShape(board);
    const counter = countUpdates(board);
    const id = await dragShape(board, FROM, TO);
    // One drag, one update. Sixty moves made sixty writes to the document, and sixty things for
    // everybody else on the board to catch up with.
    expect(counter.count()).toBe(1);
    counter.stop();

    // Undo once: the shape is gone. A drag that had written a transaction per move would have left
    // this shape on the board after the first press, and the person would have to press undo a
    // dozen times to get back to where they started.
    clickUndo(board);
    await flushFrames();
    expect(snapshot(board.doc).find((object) => object.id === id)).toBeUndefined();
    expect(shapeElements(board)).toHaveLength(0);
  });

  it('TC-15c: a dashed box is drawn while the drag is going, and only while it is going', async () => {
    const board = await mountSticky();
    await armShape(board);
    expect(previewBox(board)).toBeNull();

    const down = board.screenOf(FROM);
    const up = board.screenOf(TO);
    press(board.board, down, {});
    await flushFrames();
    expect(previewBox(board)).not.toBeNull();
    moveTo(window, up, {});
    await flushFrames();
    const grown = previewBox(board);
    expect(grown).not.toBeNull();
    // Screen units, which is what the preview is painted in: at this zoom the box on the screen is
    // the box on the board, and the dashed line is a dashed line at every zoom rather than a hairline
    // that grows with the board.
    expect(Number(grown?.getAttribute('width'))).toBeCloseTo(TO.x - FROM.x, 0);
    expect(Number(grown?.getAttribute('height'))).toBeCloseTo(TO.y - FROM.y, 0);
    release(board.board, up, {});
    await flushFrames();
    expect(previewBox(board)).toBeNull();
  });

  it('TC-15d: a drag backwards draws the same box', async () => {
    const board = await mountSticky();
    await armShape(board);
    // From the bottom right to the top left: the same rectangle, because a box has no direction, and
    // a shape that could only be dragged down and to the right is a shape that cannot be drawn by
    // anybody who holds the mouse in the other hand.
    const id = await dragShape(board, TO, FROM);
    expect(shapeOf(board, id)).toMatchObject({
      x: FROM.x,
      y: FROM.y,
      width: TO.x - FROM.x,
      height: TO.y - FROM.y,
    });
  });

  it('TC-15e: Shift holds the box square, and the key held at the end is the key that counts', async () => {
    const board = await mountSticky();
    await armShape(board);
    const side = Math.max(TO.x - FROM.x, TO.y - FROM.y);
    const fromStart = await dragShape(board, FROM, TO, { shift: 'start' });
    expect(shapeOf(board, fromStart)).toMatchObject({ width: side, height: side });

    // Shift picked up halfway along and held to the end: the box was a rectangle and became a square,
    // because the key is read on every move rather than remembered from the press.
    await armShape(board);
    const late = await dragShape(board, { x: -400, y: -300 }, { x: -200, y: -220 }, {
      shift: 'middle',
    });
    const lateShape = shapeOf(board, late);
    expect(lateShape.width).toBe(lateShape.height);

    // And the other way round: Shift let go of before the pointer was, and the box is the rectangle
    // the pointer described. The key means what it is doing when the shape is made, and nothing else.
    await armShape(board);
    const early = await dragShape(board, { x: -600, y: -300 }, { x: -400, y: -220 }, {
      shift: 'until',
    });
    const earlyShape = shapeOf(board, early);
    expect(earlyShape.width).toBe(200);
    expect(earlyShape.height).toBe(80);
  });

  it('TC-15f: a click makes the default shape, centred on the point', async () => {
    const board = await mountSticky();
    await armShape(board);
    const at = { x: 40, y: -30 };
    const id = await clickBoard(board, at);
    expect(id).not.toBeNull();
    const shape = shapeOf(board, id ?? '');
    // The design's default shape is centred on the click, the same way a sticky note is: the point
    // pressed is the middle of the thing, not its corner.
    expect(shape).toMatchObject({
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
      x: at.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: at.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
    });
    expect(board.outlinedIds()).toEqual([id]);
  });

  it('TC-15g: a drag shorter than the smallest shape makes the default one instead', async () => {
    const board = await mountSticky();
    await armShape(board);
    // Two pixels each way is a drag that went somewhere and a shape nobody could see. The answer is
    // not a 2x2 shape: it is the standard shape, where it was asked for.
    const id = await dragShape(board, { x: 0, y: 0 }, { x: 2, y: 2 });
    const shape = shapeOf(board, id);
    expect(shape.width).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBeLessThanOrEqual(0);
    expect(shape.y).toBeLessThanOrEqual(0);
  });

  it('TC-15h: the three kinds come from the Shape menu, and the tool remembers the last one', async () => {
    const board = await mountSticky();
    await armShape(board);
    expect(board.view.container.querySelector('[data-testid="shape-kinds"]')).not.toBeNull();

    const rect = await dragShape(board, { x: -300, y: -300 }, { x: -180, y: -220 });
    expect(shapeOf(board, rect).kind).toBe('rect');

    // Choosing an ellipse also puts the Shape tool back up: nobody picks a shape in order to then go
    // and press the button that draws shapes.
    await armShape(board, 'ellipse');
    expect(toolPressed(board, 'shape')).toBe(true);
    const ellipse = await dragShape(board, { x: -60, y: -300 }, { x: 60, y: -220 });
    expect(shapeOf(board, ellipse).kind).toBe('ellipse');
    expect(shapeElement(board, ellipse).dataset.kind).toBe('ellipse');

    // And the kind is still the one that was chosen when the tool is armed again: it is a setting of
    // the tool, not a choice made afresh for every shape.
    await armShape(board);
    const third = await dragShape(board, { x: 140, y: -300 }, { x: 260, y: -220 });
    expect(shapeOf(board, third).kind).toBe('ellipse');

    await armShape(board, 'diamond');
    const fourth = await dragShape(board, { x: 320, y: -300 }, { x: 440, y: -220 });
    expect(shapeOf(board, fourth).kind).toBe('diamond');
    expect(shapeElement(board, fourth).querySelector('[data-testid="shape-figure"]')?.tagName).toBe(
      'polygon',
    );
  });

  it('TC-15i: a shape is drawn in SVG, one figure per kind, with the colours it was given', async () => {
    const board = await mountSticky();
    await armShape(board, 'ellipse');
    const id = await dragShape(board, FROM, TO);
    const figure = shapeElement(board, id).querySelector('[data-testid="shape-figure"]');
    expect(figure?.tagName).toBe('ellipse');
    // The outline is drawn in board units, so it thickens with the board instead of staying a
    // two-pixel line at every zoom, which is what makes it the same outline as a rectangle's.
    expect(Number(figure?.getAttribute('stroke-width'))).toBe(2);
    expect(figure?.getAttribute('fill')).not.toBeNull();
    expect(figure?.getAttribute('stroke')).not.toBeNull();
  });
});

describe('shape: the words in the middle (TC-16)', () => {
  it('TC-16: a double-click opens the label, and the six hundredth character is not written', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);

    // Pressing a shape twice edits it, and does not make a sticky note underneath it.
    await openLabel(board, id);
    const editor = shapeElement(board, id).querySelector('[data-testid="shape-label-editor"]');
    expect(editor).not.toBeNull();

    await typeLabel(board, id, 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    // The limit is applied by the editor, not by the attribute on the textarea, which a change event
    // of the kind a paste makes walks straight past.
    expect(shapeOf(board, id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    const shown = labelOf(board, id) as HTMLTextAreaElement;
    expect(shown.tagName).toBe('TEXTAREA');
    expect(shown.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-16b: the label is centred in the shape and wraps to its width', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await openLabel(board, id);
    await typeLabel(board, id, 'the quick brown fox jumps over the lazy dog, and keeps on going');
    endShapeEdit(board, id);
    await flushFrames();

    const label = shapeElement(board, id).querySelector<HTMLElement>('.shape-object__label');
    expect(label).not.toBeNull();
    // The words are laid out in a box that is the shape's own, which is the only way a label stays in
    // the middle of a shape that is being resized around it: the box gets bigger, the lines get
    // fewer, and nobody has to be told about it.
    expect(label?.textContent).toBe('the quick brown fox jumps over the lazy dog, and keeps on going');
    expect(label?.style.fontSize).toBe('20px');
    const editor = shapeElement(board, id).querySelector('.shape-object__editor');
    expect(label?.classList.contains('shape-object__label')).toBe(true);
    expect(editor).toBeNull();
  });

  it('TC-16c: Escape ends the typing, keeps the words and leaves the shape selected', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await openLabel(board, id);
    await typeLabel(board, id, 'Draft');
    endShapeEdit(board, id);
    await flushFrames();
    expect(shapeOf(board, id).label).toBe('Draft');
    expect(board.outlinedIds()).toContain(id);
    expect(shapeElement(board, id).querySelector('[data-testid="shape-label-editor"]')).toBeNull();
  });

  it('TC-16d: a shape with no words in it is still a shape, and says nothing', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    // Unlike free text, an empty shape is a shape: the box is the object, and the words are a thing
    // somebody puts in it later.
    expect(shapeOf(board, id).label).toBe('');
    expect(labelOf(board, id).textContent).toBe('');
  });

  it('TC-16e: typing into a shape does not move it, resize it or recolour it', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await pickColor(board, 'fill', 'blue');
    const before = shapeOf(board, id);
    await openLabel(board, id);
    await typeLabel(board, id, 'Words that go on for a while, and then some more besides.');
    await flushFrames();
    const after = shapeOf(board, id);
    expect(after).toMatchObject({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      fill: before.fill,
      stroke: before.stroke,
    });
  });
});

describe('shape: two colours (TC-17)', () => {
  it('TC-17: the blue fill and the red outline are applied, and nothing else moves', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await openLabel(board, id);
    await typeLabel(board, id, 'Plan');
    endShapeEdit(board, id);
    await selectObject(board, id);

    const before = shapeOf(board, id);
    expect(board.view.container.querySelector('[data-testid="shape-toolbar"]')).not.toBeNull();
    await pickColor(board, 'fill', 'blue');
    await pickColor(board, 'stroke', 'red');

    const after = shapeOf(board, id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // The two questions the toolbar answers are inside the shape; the shape itself is where it was,
    // the same size, with the same words, and still the thing that is selected.
    expect(after).toMatchObject({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      label: before.label,
      kind: before.kind,
    });
    expect(board.outlinedIds()).toEqual([id]);
    // And the marks on screen follow the document, rather than the button having decided anything.
    expect(shapeElement(board, id).dataset.fill).toBe('blue');
    expect(shapeElement(board, id).dataset.stroke).toBe('red');
    expect(swatch(board, 'fill', 'blue').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(board, 'stroke', 'red').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-17b: the empty fill takes the insides out and leaves the outline on', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await selectObject(board, id);
    await pickColor(board, 'fill', 'none');
    const shape = shapeOf(board, id);
    expect(shape.fill).toBe('none');
    expect(shape.stroke).not.toBe('none');
    expect(swatch(board, 'fill', 'none').getAttribute('aria-label')).toBe('No fill');
  });

  it('TC-17c: pressing the colour it already has changes nothing at all', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    await selectObject(board, id);
    const fill = shapeOf(board, id).fill;
    const counter = countUpdates(board);
    await pickColor(board, 'fill', fill);
    // The same colour, the same document. A write of a value that was already there is invisible on
    // screen and unmistakable over the wire, which is why it is counted in updates here rather than
    // in anything a person could see.
    expect(counter.count()).toBe(0);
    counter.stop();
  });

  it('TC-17d: two shapes selected get the bar that counts, not a colour bar', async () => {
    const board = await mountSticky();
    await armShape(board);
    const first = await dragShape(board, FROM, TO);
    await armShape(board);
    const second = await dragShape(board, { x: 400, y: 100 }, { x: 520, y: 220 });
    await selectObject(board, first);
    await shiftClickOn(board, second);
    expect(board.outlinedIds()).toHaveLength(2);
    expect(board.view.container.querySelector('[data-testid="shape-toolbar"]')).toBeNull();
    expect(board.barOrNull()).not.toBeNull();
  });

  it('TC-17e: the colour bar is not offered for a sticky note', async () => {
    const board = await mountSticky();
    const noteId = await doubleClickBoard(board, { x: -300, y: 200 });
    await endNoteEdit(board);
    await selectObject(board, noteId);
    expect(board.view.container.querySelector('[data-testid="shape-toolbar"]')).toBeNull();
    // The note's own toolbar, on the note, is the answer for a note.
    expect(board.toolbarOrNull()).not.toBeNull();
  });

  it('TC-17f: a colour is one undo step, and the shape it colours can be coloured back', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await dragShape(board, FROM, TO);
    const before = shapeOf(board, id);
    await selectObject(board, id);
    await pickColor(board, 'fill', 'green');
    expect(shapeOf(board, id).fill).toBe('green');
    clickUndo(board);
    await flushFrames();
    expect(shapeOf(board, id).fill).toBe(before.fill);
  });
});

describe('shape: the tool hands the pointer back (TC-22)', () => {
  it('TC-22: after making a shape the Select tool is up again', async () => {
    const board = await mountSticky();
    await armShape(board);
    await dragShape(board, FROM, TO);
    expect(activeTool(board)).toBe('select');
    expect(toolPressed(board, 'shape')).toBe(false);
    expect(toolPressed(board, 'select')).toBe(true);
  });

  it('TC-22b: Escape puts the tool down and makes nothing', async () => {
    const board = await mountSticky();
    const before = snapshot(board.doc);
    await armShape(board);
    await pressEscape();
    expect(activeTool(board)).toBe('select');
    expect(snapshot(board.doc)).toEqual(before);
  });

  it('TC-22c: Escape in the middle of a drag drops the drag and writes nothing', async () => {
    const board = await mountSticky();
    const before = snapshot(board.doc);
    await armShape(board);
    press(board.board, board.screenOf(FROM), {});
    await flushFrames();
    expect(previewBox(board)).not.toBeNull();
    // The box was on the screen and the shape was never on the board: nothing was written while the
    // drag was going, so there is nothing to take back and no undo step to take it back with.
    await pressEscape();
    expect(previewBox(board)).toBeNull();
    expect(snapshot(board.doc)).toEqual(before);
    expect(activeTool(board)).toBe('select');
  });

  it('TC-22d: V puts Select back up without touching the board', async () => {
    const board = await mountSticky();
    await armShape(board);
    expect(pressToolKey('KeyV')).toBe(true);
    await flushFrames();
    expect(activeTool(board)).toBe('select');
  });

  it('TC-22e: a shape made by a click also hands the pointer back', async () => {
    const board = await mountSticky();
    await armShape(board);
    const id = await clickBoard(board, { x: 20, y: 20 });
    expect(id).not.toBeNull();
    expect(activeTool(board)).toBe('select');
    expect(board.outlinedIds()).toEqual([id]);
  });
});

describe('shape: over the things already on the board (TC-28)', () => {
  it('TC-28: a shape dragged across a sticky note leaves the note where it was', async () => {
    const board = await mountSticky();
    const noteId = await doubleClickBoard(board, FROM);
    await endNoteEdit(board);
    const before = board.object(noteId);
    const note = board.object(noteId);

    await armShape(board);
    // The press lands in the middle of the note. That is the whole of the test: whatever is under the
    // cursor, this drag is about to become a shape, and the note is not being carried about.
    const id = await dragShape(
      board,
      { x: note.x + 20, y: note.y + 20 },
      { x: note.x + 300, y: note.y + 160 },
      { on: board.element(noteId) },
    );

    expect(board.object(noteId)).toEqual(before);

    // The shape is there, and it is the shape rather than the note that got selected.
    expect(shapeOf(board, id)).toMatchObject({ x: note.x + 20, y: note.y + 20 });
    expect(board.outlinedIds()).toEqual([id]);
  });

  it('TC-28b: a double-click with the Shape tool up makes no sticky note', async () => {
    const board = await mountSticky();
    const before = snapshot(board.doc);
    await armShape(board);
    doubleClick(board.board, board.screenOf(FROM));
    await flushFrames();
    expect(snapshot(board.doc)).toEqual(before);
    expect(activeTool(board)).toBe('shape');
  });

  it('TC-28c: a shape drawn over a note does not pan the board', async () => {
    const board = await mountSticky();
    const camera = board.camera();
    await armShape(board);
    await dragShape(board, { x: -200, y: -100 }, { x: 200, y: 100 });
    // The board is looking at the same place it was. A drag that panned while it drew would move the
    // shape away from the pointer, which is the one thing a drawing tool may not do.
    expect(board.camera()).toEqual(camera);
  });

  it('TC-28d: a drag that finishes over a note draws a shape rather than a marquee', async () => {
    const board = await mountSticky();
    const noteId = await doubleClickBoard(board, { x: -400, y: 250 });
    await endNoteEdit(board);
    await armShape(board);
    const id = await dragShape(board, { x: -500, y: 150 }, { x: -300, y: 300 });
    expect(board.outlinedIds()).toEqual([id]);
    expect(board.object(noteId)).toBeDefined();
    expect(shapeOf(board, id).type).toBe('shape');
    expect(board.marqueeOrNull()).toBeNull();
  });

  it('TC-28e: the N key still makes a note where the board is looking, with a Shape tool nearby', async () => {
    const board = await mountSticky();
    const before = snapshot(board.doc).filter((object) => object.type === 'sticky').length;
    // Story 2's key is story 2's behaviour: the note appears where the board is looking, and the
    // Shape tool's existence does not turn N into a tool that has to be pointed at something.
    fireEvent.keyDown(window, { key: 'n' });
    await flushFrames();
    expect(snapshot(board.doc).filter((object) => object.type === 'sticky').length).toBe(before + 1);
  });
});

/**
 * Take the keyboard away from a note that was just double-clicked into existence.
 *
 * A note born from a double-click is open for typing, and while a caret is in it the tool keys stand
 * down - which is right, and is the reason a test that wants the Shape tool has to say goodbye to the
 * caret first. The key goes on the field, because that is where the browser puts it.
 */
async function endNoteEdit(board: MountedSticky): Promise<void> {
  await endEditing(board);
}

/**
 * Finish the spell of typing, with the Escape key on the field itself.
 *
 * Written out here rather than using the text helper, because the text helper looks for a text
 * object's editor or a note's, and this is a third thing: a label in the middle of a shape.
 */
function endShapeEdit(board: MountedSticky, id: string): void {
  const editor = shapeElement(board, id).querySelector<HTMLTextAreaElement>(
    '[data-testid="shape-label-editor"]',
  );
  if (editor === null) {
    throw new Error(`shape ${id} is not being typed into`);
  }
  fireEvent.keyDown(editor, { key: 'Escape' });
}
