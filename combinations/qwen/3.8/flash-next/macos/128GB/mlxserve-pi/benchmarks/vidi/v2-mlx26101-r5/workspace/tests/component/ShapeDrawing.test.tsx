/**
 * TC-15, TC-16, TC-17, TC-28 — drawing a shape, labelling it, and colouring it.
 *
 * A shape is the first object on this board that is made rather than placed: the Shape tool takes the
 * pointer away from the board, drags a box out of empty space, and writes whatever that box turned out to
 * be. Everything these tests are about follows from that one difference:
 *
 * — the object underneath a shape being drawn does not move (TC-28), because the press that begins the
 *   shape was not a press on that object;
 * — the box on the screen while the pointer is down is the box that will be written (TC-15), including the
 *   two cases where it is not the box that was dragged — a drag too small to be a shape becomes the
 *   standard size, and Shift makes the drag square;
 * — the shape comes to the person who drew it already selected (TC-15), because the next thing they want
 *   is to move it or label it, and both of those are things the *selecting* pointer does;
 * — its label is a text body (TC-16), so it opens on a double-click, it wraps, and it stops at the same
 *   number of characters every other piece of writing on this board stops at;
 * — and its colour is two colours (TC-17), an inside and an edge, each changed by one click and nothing
 *   else: a fill that also moved the label, or dropped the selection, would be a swatch that did four
 *   things when it was asked to do one.
 *
 * jsdom has no layout and no painting, so nothing here asserts where a pixel landed. The geometry is
 * asserted on the numbers in the document and on the numbers in the element's data attributes, which are
 * what the drawing is built from.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import { screenToWorld } from '../../src/client/canvas/camera';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../src/shared/config';
import {
  getShapeLabel,
  isShapeSnapshot,
  type ShapeSnapshot,
} from '../../src/shared/objects/shape';
import {
  act as actOn,
  board,
  nextFrame,
  pointer,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';

/** Presses a key where the board listens, and says whether the board swallowed it. */
async function key(k: string, target: Window | Element = window): Promise<boolean> {
  let swallowed = true;
  await actOn(async () => {
    // False means somebody called preventDefault, which is the difference between a key the board
    // answered and a key it left for the browser.
    swallowed = !fireEvent.keyDown(target, { key: k });
    await nextFrame();
  });
  return swallowed;
}

/** `aria-pressed` of one of the toolbar's tool buttons: what the screen says the pointer is. */
function pressed(which: 'select' | 'text' | 'shape' | 'connector'): string | null {
  return screen.getByTestId(`tool-${which}`).getAttribute('aria-pressed');
}

/** The tool the board says the pointer is in, read off the board itself. */
const toolOnScreen = (): string | undefined => board().dataset['tool'];

/** The world point a point on the screen is, as the board's own camera says. */
const worldAt = (point: { x: number; y: number }) => screenToWorld(renderedCamera(), point);

/** Presses, releases and clicks, which is what a browser makes of a click. */
async function tap(target: HTMLElement, point: { x: number; y: number }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await actOn(async () => {
    fireEvent.click(target, { clientX: point.x, clientY: point.y });
    await nextFrame();
  });
}

/** Types into an open editor the way a keyboard does: one change event at a time. */
async function type(text: string, testId = 'shape-editor'): Promise<void> {
  const el = screen.getByTestId(testId) as HTMLTextAreaElement;
  await actOn(async () => {
    fireEvent.change(el, { target: { value: `${el.value}${text}` } });
    await nextFrame();
  });
}

/** Replaces what is in the open editor, which is what a paste does. */
async function replace(value: string, testId = 'shape-editor'): Promise<void> {
  await actOn(async () => {
    fireEvent.change(screen.getByTestId(testId) as HTMLTextAreaElement, { target: { value } });
    await nextFrame();
  });
}

/** Stops typing: the editor commits what is in it and closes. */
async function stopTyping(testId = 'shape-editor'): Promise<void> {
  await actOn(async () => {
    fireEvent.keyDown(screen.getByTestId(testId) as HTMLTextAreaElement, { key: 'Escape' });
    await nextFrame();
  });
}

/** Opens a shape's label for typing, the way a person does: a double-click on the shape. */
async function openLabel(fixture: BoardFixture, id: string): Promise<HTMLElement> {
  const el = fixture.objectEl(id) as HTMLElement;
  fireEvent.doubleClick(el, { clientX: 0, clientY: 0 });
  await actOn(nextFrame);
  return el;
}

/** The one shape on the board, of which there must be exactly one. */
function onlyShape(fixture: BoardFixture): ShapeSnapshot {
  const shapes = fixture.objects().filter(isShapeSnapshot);
  if (shapes.length !== 1) throw new Error(`expected one shape, found ${shapes.length}`);
  return shapes[0] as ShapeSnapshot;
}

/** What the shape's element says it is: the numbers the drawing is made from. */
function shapeShown(fixture: BoardFixture, id: string): Record<string, string | undefined> {
  const el = fixture.objectEl(id);
  if (el === null) throw new Error('the shape is not rendered');
  return { ...el.dataset };
}

/** Drags a shape on the board, in screen coordinates, and lets go. */
async function drawShape(
  from: { x: number; y: number },
  to: { x: number; y: number },
  square = false,
): Promise<void> {
  pointer('pointerDown', board(), from);
  await actOn(nextFrame);
  pointer('pointerMove', board(), { ...to, shiftKey: square });
  await actOn(nextFrame);
  pointer('pointerUp', board(), { ...to, shiftKey: square });
  await actOn(nextFrame);
}

describe('the Shape tool', () => {
  it('TC-15 drags a box, shows that box on the way, and writes the shape it dragged', async () => {
    const fixture = renderBoard();
    expect(await key('s')).toBe(true);
    expect(pressed('shape')).toBe('true');
    expect(toolOnScreen()).toBe('shape');

    const start = { x: 300, y: 200 };
    const end = { x: 500, y: 320 };
    pointer('pointerDown', board(), start);
    await actOn(nextFrame);
    pointer('pointerMove', board(), end);
    await actOn(nextFrame);

    // The preview is the box the model is about to write, at the size the camera draws it at — which is
    // the whole point of showing it: a person who drags a narrow strip and is about to get a square
    // should see the square coming.
    const preview = screen.getByTestId('shape-preview');
    expect(Number(preview.dataset['width'])).toBeCloseTo(end.x - start.x, 6);
    expect(Number(preview.dataset['height'])).toBeCloseTo(end.y - start.y, 6);

    pointer('pointerUp', board(), end);
    await actOn(nextFrame);

    const shape = onlyShape(fixture);
    const origin = worldAt(start);
    expect(shape.width).toBeCloseTo(end.x - start.x, 6);
    expect(shape.height).toBeCloseTo(end.y - start.y, 6);
    expect(shape.x).toBeCloseTo(origin.x, 6);
    expect(shape.y).toBeCloseTo(origin.y, 6);
    expect(shape.kind).toBe('rect');
    expect(shape.fill).toBe('white');
    expect(shape.stroke).toBe('dark');

    // The preview was a preview: the shape is on the board and the dashed box is not.
    expect(screen.queryByTestId('shape-preview')).toBeNull();

    // …and the shape came out of the tool already selected, with the pointer back to Select: the next
    // thing a person does with a shape they have just drawn is a thing the selecting pointer does.
    expect(fixture.selection().selectedId).toBe(shape.id);
    expect(pressed('shape')).toBe('false');
    expect(pressed('select')).toBe('true');
    expect(toolOnScreen()).toBe('select');
  });

  it('TC-15 writes the standard shape, centred on the point, for a click and for a drag too small to be a shape', async () => {
    const fixture = renderBoard();
    await key('s');

    // A click: nobody draws a rectangle by moving three pixels, and the shape that means is the standard
    // one, where the pointer went down.
    const click = { x: 400, y: 300 };
    await drawShape(click, { x: click.x + 3, y: click.y + 3 });

    const shape = onlyShape(fixture);
    const at = worldAt(click);
    expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 6);
    expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 6);
    expect(shape.x).toBeCloseTo(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(shape.y).toBeCloseTo(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
  });

  it('TC-15 squares the box with Shift, from the corner the pointer went down at', async () => {
    const fixture = renderBoard();
    await key('s');

    const start = { x: 200, y: 500 };
    // Dragged wide and short; the square is the longer side of the two, anchored where the drag began —
    // the corner a person put their pointer down at stays where they put it.
    await drawShape(start, { x: start.x + 240, y: start.y - 80 }, true);

    const shape = onlyShape(fixture);
    expect(shape.width).toBeCloseTo(240, 6);
    expect(shape.height).toBeCloseTo(240, 6);
    expect(shape.x).toBeCloseTo(worldAt(start).x, 6);
    // Dragged upwards, the corner the pointer went down at is the bottom-left of the box, and that is the
    // corner the square keeps: the square is grown out of the drag that was made, not re-centred on it.
    expect((shape.y as number) + (shape.height as number)).toBeCloseTo(worldAt(start).y, 6);
  });

  it('TC-15 draws nothing for a pointer the system took back', async () => {
    const fixture = renderBoard();
    await key('s');

    pointer('pointerDown', board(), { x: 300, y: 200 });
    await actOn(nextFrame);
    pointer('pointerMove', board(), { x: 500, y: 320 });
    await actOn(nextFrame);
    pointer('pointerCancel', board(), { x: 500, y: 320 });
    await actOn(nextFrame);

    expect(fixture.objects()).toHaveLength(0);
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    // The tool is still standing: a pointer the system took back is not a person changing their mind
    // about which tool they want.
    expect(pressed('shape')).toBe('true');
  });

  it('TC-28 leaves the sticky note under the drag exactly where it was', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(600, 400);
    const before = fixture.boundsOf(note);

    await key('s');
    // A drag that starts on the note and ends in the air beside it. The note is not the thing being
    // dragged: the shape is, and the press that began it was not a press on the note.
    const onNote = fixture.screenOf(note);
    await drawShape(onNote, { x: onNote.x + 260, y: onNote.y + 160 });

    const after = fixture.boundsOf(note);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(fixture.objects().filter(isShapeSnapshot)).toHaveLength(1);
  });

  it('TC-28 leaves a selected note selected and unmoved when a shape is drawn over it', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(600, 400);
    await tap(fixture.objectEl(note) as HTMLElement, fixture.screenOf(note));
    expect(fixture.selection().selectedId).toBe(note);

    await key('s');
    const onNote = fixture.screenOf(note);
    const before = fixture.boundsOf(note);
    await drawShape(onNote, { x: onNote.x + 200, y: onNote.y + 200 });

    expect(fixture.boundsOf(note)).toEqual(before);
    // The shape the drag made is the selection now, which is the tool's one say about the selection —
    // and it is said by selecting the new object, not by dragging the old one.
    expect(fixture.selection().selectedId).toBe(onlyShape(fixture).id);
  });

  it('TC-15 is entered by S and left by Escape without writing anything', async () => {
    const fixture = renderBoard();
    expect(await key('s')).toBe(true);
    expect(toolOnScreen()).toBe('shape');
    await key('Escape');
    expect(toolOnScreen()).toBe('select');
    expect(fixture.objects()).toHaveLength(0);
  });

  it('TC-15 leaves the reserved letters of stories nobody has written to the browser', async () => {
    renderBoard();
    // P was the pen's letter with no pen behind it, and this story's test used to assert that pressing it
    // did nothing. Story 11 wrote the pen, so the letter is earned now: it lights the pen, which is what
    // the design's naming scheme always said it would.
    expect(await key('p')).toBe(true);
    expect(toolOnScreen()).toBe('pen');
    await key('Escape');
    // N is the sticky note's, and it was the sticky note's before this story: pressing it makes a note,
    // it does not enter a tool.
    expect(await key('n')).toBe(true);
    expect(toolOnScreen()).toBe('select');
  });
});

describe('a shape’s label', () => {
  it('TC-16 opens on a double-click, wraps what was typed, and stops at the limit', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);

    await openLabel(fixture, shape.id);
    expect(fixture.selection().editingId).toBe(shape.id);
    expect(screen.getByTestId('shape-editor')).toBeTruthy();

    // One character more than the limit, put in in one go as a paste would. The editor is the first
    // place the limit is enforced, and the document is the second: what lands in the `Y.Text` is what a
    // person was allowed to type, so there is nothing for anybody else on the board to refuse.
    await replace('x'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    expect(getShapeLabel(fixture.doc(), shape.id)?.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(onlyShape(fixture).text).toHaveLength(SHAPE_LABEL_MAX_CHARS);

    // The label the shape shows is the label in the document: what a person reads on the screen and what
    // everybody else on the board receives are the same string.
    const shown = shapeShown(fixture, shape.id);
    expect(shown['text']).toHaveLength(SHAPE_LABEL_MAX_CHARS);

    await stopTyping();
    expect(fixture.selection().editingId).toBeNull();
    expect(onlyShape(fixture).text).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // …and once the typing is over, the shape itself is showing all of it, in a box the shape's own width,
    // which is what wraps it.
    const label = fixture.objectEl(shape.id)?.querySelector('[data-testid="shape-object-label"]');
    expect(label?.textContent).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-16 keeps a shape that was emptied of its label, unlike a piece of text', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);

    await openLabel(fixture, shape.id);
    await type('hello');
    await replace('');
    await stopTyping();

    // A piece of text with nothing in it goes away; a shape with nothing in it is a shape. The label is
    // empty, and the shape is still on the board.
    expect(fixture.objects().filter(isShapeSnapshot)).toHaveLength(1);
    expect(onlyShape(fixture).text).toBe('');
  });

  it('TC-16 holds a label another person wrote past the limit, and cuts it', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);

    // Written into the document behind this person's back, by a client with a bigger limit in it.
    await actOn(async () => {
      const label = getShapeLabel(fixture.doc(), shape.id);
      label?.insert(0, 'y'.repeat(SHAPE_LABEL_MAX_CHARS + 50));
      await nextFrame();
    });

    // The editor is the place a person is told; the document is the place the rule is kept. A label that
    // arrives too long is cut to the limit by the object's own observer, in a transaction of its own —
    // and the shape goes on being drawn, because a shape whose label turned out to be too long is a
    // shape, and refusing to draw it would be the board losing a thing somebody drew.
    expect(onlyShape(fixture).text).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(shapeShown(fixture, shape.id)['text']).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(fixture.objects().filter(isShapeSnapshot)).toHaveLength(1);
  });

  it('TC-16 says what it is, out loud', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);
    const el = fixture.objectEl(shape.id) as HTMLElement;

    await openLabel(fixture, shape.id);
    await type('Start here');
    await stopTyping();

    // The words a stranger hears about a shape are the shape and its label, in that order.
    expect(el.getAttribute('aria-label')).toBe('Rectangle: Start here');
  });
});

describe('a shape’s colours', () => {
  it('TC-17 fills it and outlines it, one click each, and changes nothing else', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);

    // The shape came out of the tool selected, and a selected shape's palette is on the shape: fills on
    // one row, outlines on the next.
    const palette = screen.getByTestId('shape-toolbar');
    expect(palette.getAttribute('aria-label')).toBe('Shape toolbar');

    // A label first, so that this test can say what a colour does not change.
    await openLabel(fixture, shape.id);
    await type('unchanged');
    await stopTyping();

    fireEvent.click(screen.getByTestId('fill-blue'));
    await actOn(nextFrame);
    fireEvent.click(screen.getByTestId('stroke-red'));
    await actOn(nextFrame);

    const after = onlyShape(fixture);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // A fill writes the fill. Place, size, kind, label and selection are the shape's own business and
    // were none of this click's.
    expect(after.x).toBe(shape.x);
    expect(after.y).toBe(shape.y);
    expect(after.width).toBe(shape.width);
    expect(after.height).toBe(shape.height);
    expect(after.kind).toBe(shape.kind);
    expect(after.text).toBe('unchanged');
    expect(fixture.selection().selectedId).toBe(shape.id);

    const shown = shapeShown(fixture, shape.id);
    expect(shown['fill']).toBe('blue');
    expect(shown['stroke']).toBe('red');
    // The drawing is built from the palette, so the element carries the colour it will be painted in.
    expect(shown['fillColor']).toBe('#BBDEFB');
    expect(shown['strokeColor']).toBe('#E53935');
  });

  it('TC-17 lights the swatch the shape already is, and undoes a colour as one step', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);

    // The shape was born white on dark, and that is what the two rows light.
    expect(screen.getByTestId('fill-white').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('stroke-dark').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('fill-green'));
    await actOn(nextFrame);
    expect(screen.getByTestId('fill-green').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('fill-white').getAttribute('aria-pressed')).toBe('false');

    // One colour click is one step of the history: the shape goes back to the colour it was, and the
    // shape itself is still on the board, which it would not be if the colour and the shape had been
    // written into the same step as each other.
    await actOn(async () => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
      await nextFrame();
    });
    expect(onlyShape(fixture).fill).toBe('white');
    expect(fixture.objects().filter(isShapeSnapshot)).toHaveLength(1);
    // The same shape, not a new one: undo put the colour back on the thing that was drawn, which is why a
    // person can undo a colour and keep the arrow that was drawn to it.
    expect(onlyShape(fixture).id).toBe(shape.id);
  });

  it('TC-17 offers no fill as a colour that is not a colour', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });

    fireEvent.click(screen.getByTestId('fill-none'));
    await actOn(nextFrame);

    const shape = onlyShape(fixture);
    expect(shape.fill).toBe('none');
    // Drawn as nothing at all: the board shows through the shape.
    expect(shapeShown(fixture, shape.id)['fillColor']).toBe('transparent');
  });

  it('TC-17 offers seven fills and six outlines, in the order the settings list them', async () => {
    renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });

    // The two rows are a rendering of the two palettes, so a colour added to one appears in the other and
    // there is never a swatch that writes a colour nobody has, or a colour with no swatch to pick it.
    const fills = screen.getByTestId('shape-fill-row');
    const outlines = screen.getByTestId('shape-stroke-row');
    expect(within(fills).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      // `none` is first, because it is the answer to "what is it filled with" that comes before any
      // colour: the palette is asked in the order the settings list it, and that list starts at nothing.
      'No fill',
      'White fill',
      'Blue fill',
      'Green fill',
      'Yellow fill',
      'Pink fill',
      'Grey fill',
    ]);
    expect(within(outlines).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Dark outline',
      'Blue outline',
      'Green outline',
      'Orange outline',
      'Red outline',
      'Grey outline',
    ]);
  });

  it('TC-17 is the palette of one shape, and of that shape alone', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const first = onlyShape(fixture);
    await key('s');
    await drawShape({ x: 700, y: 200 }, { x: 900, y: 320 });
    const second = fixture.objects().filter(isShapeSnapshot)[1] as ShapeSnapshot;

    // Two shapes in the selection: a selection of two does not have one colour to light, so the palette
    // stays out of the way and the selection bar says what is in the selection.
    await fixture.selectAll();
    expect(fixture.selection().size).toBe(2);
    expect(screen.queryByTestId('shape-toolbar')).toBeNull();

    // Pressing a shape that is already in a group selection keeps the group — that is how a person drags
    // two shapes at once — so the palette is still not there. One clear, one press, and the selection is
    // back to one shape: its own palette comes back, on that shape and on no other.
    await tap(fixture.objectEl(second.id) as HTMLElement, { x: 800, y: 260 });
    expect(fixture.selection().size).toBe(2);
    expect(screen.queryByTestId('shape-toolbar')).toBeNull();

    pointer('pointerDown', board(), { x: 40, y: 700 });
    pointer('pointerUp', board(), { x: 40, y: 700 });
    await actOn(nextFrame);
    expect(fixture.selection().size).toBe(0);

    await tap(fixture.objectEl(second.id) as HTMLElement, { x: 800, y: 260 });
    expect(fixture.selection().selectedId).toBe(second.id);
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();
    expect(fixture.objectEl(first.id)?.querySelector('[data-testid="shape-toolbar"]')).toBeNull();
  });

  it('TC-17 draws the shape in the stroke width the settings give it', async () => {
    const fixture = renderBoard();
    await key('s');
    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);
    const svg = fixture.objectEl(shape.id)?.querySelector('svg');
    const geometry = svg?.firstElementChild;
    expect(geometry).toBeTruthy();
    expect(Number(geometry?.getAttribute('stroke-width'))).toBe(SHAPE_STROKE_WIDTH_WORLD);
  });
});

describe('the three shapes', () => {
  it('TC-15 draws the kind the toolbar was set to, and remembers it', async () => {
    const fixture = renderBoard();
    await key('s');

    fireEvent.click(screen.getByTestId('shape-kind-ellipse'));
    await actOn(nextFrame);
    expect(screen.getByTestId('shape-kind-ellipse').getAttribute('aria-pressed')).toBe('true');

    await drawShape({ x: 300, y: 200 }, { x: 500, y: 320 });
    const shape = onlyShape(fixture);
    expect(shape.kind).toBe('ellipse');
    expect(fixture.objectEl(shape.id)?.dataset['kind']).toBe('ellipse');
    // An ellipse is drawn as an ellipse inside the box the document holds.
    const svg = fixture.objectEl(shape.id)?.querySelector('svg');
    expect(svg?.firstElementChild?.tagName).toBe('ellipse');
  });

  it('TC-15 keeps the kind between shapes', async () => {
    const fixture = renderBoard();
    await key('s');
    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    await actOn(nextFrame);

    await drawShape({ x: 100, y: 100 }, { x: 260, y: 260 });
    await key('s');
    await drawShape({ x: 400, y: 100 }, { x: 560, y: 260 });

    const shapes = fixture.objects().filter(isShapeSnapshot);
    expect(shapes).toHaveLength(2);
    // The tool was left and re-entered, and the kind it was set to was kept: which shape a person wants
    // is a thing they said once, not a thing they have to say again for every box.
    expect(shapes.map((shape) => shape.kind)).toEqual(['diamond', 'diamond']);
    expect(
      fixture.objectEl((shapes[1] as ShapeSnapshot).id)?.querySelector('svg')?.firstElementChild?.tagName,
    ).toBe('polygon');
  });

  it('TC-15 hides the kind buttons until a shape is being drawn', () => {
    renderBoard();
    expect(screen.queryByTestId('toolbar-shape-kinds')).toBeNull();
    fireEvent.click(screen.getByTestId('tool-shape'));
    expect(screen.queryByTestId('toolbar-shape-kinds')).not.toBeNull();
  });
});
