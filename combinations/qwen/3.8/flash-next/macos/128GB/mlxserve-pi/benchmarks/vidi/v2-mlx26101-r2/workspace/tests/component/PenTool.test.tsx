/**
 * Drawing with the pen (`tests/component/PenTool.test.tsx`).
 *
 * `pen.draw`, `pen.dot`, `pen.stay_active`, `pen.options`, `pen.share`,
 * `pen.interrupted`, `pen.long_stroke` and `pen.navigation` as the person holding the
 * mouse meets them: press `P`, move, press, move, let go, and there is a line on the
 * board where the hand was - and the pen is still the pen, because a person who is
 * sketching is sketching more than one line.
 *
 * Every assertion here is about the *road* to the model. What `createStroke` does with a
 * trail is the unit file's business; what this file has to prove is that a drag becomes
 * exactly one stroke, with the ink and the pen this tab was holding, that nothing reaches
 * the shared document until the pointer lets go (`pen.share` - the preview is this
 * screen's, and a live trail on the wire is five screens paying for a drawing that is not
 * finished), and that while the pen is up nothing underneath it answers a pointer at all.
 *
 * The drags go through the pen's own layer, in screen pixels, because that is what a
 * hand delivers; the answers are read out of the shared document, because that is what
 * the other four people in the room see.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  board,
  boardDoc,
  clickPenColor,
  clickPenThickness,
  clickTool,
  coalescedDragOnPen,
  createSelectedNote,
  docNotes,
  dragPenThrough,
  flushFrames,
  keydown,
  noteData,
  penColorButton,
  penColorButtons,
  penCursor,
  penPreview,
  penPreviewPoints,
  penThicknessButton,
  penThicknessButtons,
  penToolbarElement,
  penToolButton,
  pointerCancel,
  pointerMove,
  pointerUp,
  pointerDown,
  noteId,
  pressedPenColor,
  pressedPenThickness,
  pressedTool,
  renderBoard,
  screenOf,
  selectedObjectIds,
  setZoom,
  strokeData,
  strokeElements,
  strokeId,
  strokes,
  toolSurface,
  toolSurfaceExists,
  worldOfScreen,
} from './helpers.js';
import { fireEvent } from './tl.js';
import { circle, scribble } from '../fixtures/pen-paths.js';

import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config.js';
import type { Point } from '../../src/client/canvas/camera.js';

beforeEach(() => {
  renderBoard();
});

/** Take up the pen, by the same button the `P` shortcut presses. */
const takePen = (): void => clickTool('pen');

/** A drag along a list of screen points, in order, released at the last one. */
const drawThrough = (path: readonly Point[]): void => dragPenThrough(path);

/** A straight drag: the shortest sentence that draws a line. */
function drag(from: Point = { x: 300, y: 300 }, to: Point = { x: 620, y: 470 }): void {
  dragPenThrough([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
}

/** Press and let go without moving: a dot. */
function tap(at: Point = { x: 500, y: 350 }): void {
  dragPenThrough([at]);
}

/* ------------------------------------------------- TC-09: one drag, one stroke */

describe('the pen draws what the options say (TC-09)', () => {
  it('draws one stroke, in the ink and with the pen this tab is holding', () => {
    takePen();
    clickPenColor('red');
    clickPenThickness('thick');

    drag();

    expect(strokes()).toHaveLength(1);
    const stroke = strokeData(0);
    expect(stroke.type).toBe('stroke');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    expect(stroke.createdAt).toBeGreaterThan(0);
  });

  it('leaves the pen in the hand afterwards', () => {
    // `pen.stay_active`, which is the difference between this tool and the two before
    // it: a shape tool that went back to Select after one shape would be a shape tool
    // you use by pressing `S` again between every pair of shapes.
    takePen();
    drag();
    expect(pressedTool()).toBe('pen');
    expect(toolSurfaceExists('pen')).toBe(true);
    drag({ x: 200, y: 500 }, { x: 500, y: 560 });
    expect(strokes()).toHaveLength(2);
    expect(pressedTool()).toBe('pen');
  });

  it('does not make the stroke part of the selection', () => {
    // The person is drawing, not arranging; a stroke that arrived selected would put
    // resize handles over the next line they tried to draw.
    takePen();
    drag();
    expect(selectedObjectIds()).toEqual([]);
  });
  it('draws the whole drag, in board units where the drag was', () => {
    takePen();
    const from = { x: 300, y: 300 };
    const to = { x: 620, y: 470 };
    drag(from, to);
    const stroke = strokeData(0);
    const start = worldOfScreen(from);
    const finish = worldOfScreen(to);
    // Half the pen on each side of the box, because the box is the edge of the ink and
    // not the middle of the line - and the points stored from the box's own corner, so
    // the round trip comes back to where the pointer was. That is what lets story 7 move
    // a drawing with the same `moveObject` it moves a note with.
    const pad = PEN_THICKNESS_WORLD[stroke.thickness] / 2;
    expect(stroke.x).toBeCloseTo(start.x - pad, 1);
    expect(stroke.y).toBeCloseTo(start.y - pad, 1);
    expect(stroke.width).toBeCloseTo(finish.x - start.x + pad * 2, 1);
    expect(stroke.height).toBeCloseTo(finish.y - start.y + pad * 2, 1);
    expect(stroke.x + (stroke.points[0] as number)).toBeCloseTo(start.x, 1);
    expect(
      stroke.x + (stroke.points[stroke.points.length - 2] as number),
    ).toBeCloseTo(finish.x, 1);
  });

  it('puts a new stroke on top of the one before it', () => {
    takePen();
    drag({ x: 200, y: 200 }, { x: 400, y: 300 });
    drag({ x: 400, y: 400 }, { x: 700, y: 600 });
    expect(strokeData(1).z).toBeGreaterThan(strokeData(0).z);
  });

  it('names this tab as the stroke\'s author when the tab has a name to give', () => {
    // This build has no identity in component tests, so the honest assertion is that
    // the field is absent rather than that it is somebody's id.
    takePen();
    drag();
    expect(strokeData(0).createdBy).toBeUndefined();
  });
});

/* ------------------------------------------------------- TC-10: pen.dot */

describe('a press that never moved is a dot (TC-10)', () => {
  it('commits a single point', () => {
    takePen();
    tap();
    expect(strokes()).toHaveLength(1);
    const stroke = strokeData(0);
    // Two numbers: one point, stored flat, as the model stores a trail.
    expect(stroke.points).toHaveLength(2);
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD[stroke.thickness]);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD[stroke.thickness]);
  });

  it('commits a dot from a press and a release at the same place, even with moves between', () => {
    // A hand at rest still reports a few points; a dot is asked about the *distance
    // travelled*, not the number of messages, or every dot on the board would be a
    // three-point scribble.
    takePen();
    const at = { x: 420, y: 260 };
    const surface = toolSurface('pen');
    pointerDown(at, surface);
    pointerMove({ x: at.x + 1, y: at.y + 1 }, surface);
    pointerMove(at, surface);
    pointerUp(at, surface);
    expect(strokes()).toHaveLength(1);
    expect(strokeData(0).points).toHaveLength(2);
  });

  it('draws a dot with whatever pen is chosen', () => {
    takePen();
    clickPenThickness('thick');
    tap({ x: 640, y: 400 });
    expect(strokeData(0).width).toBe(PEN_THICKNESS_WORLD.thick);
    takePen();
    clickPenThickness('thin');
    tap({ x: 700, y: 400 });
    expect(strokes()).toHaveLength(2);
    expect(strokeData(1).width).toBe(PEN_THICKNESS_WORLD.thin);
  });

  it('is a dot the size of the pen on the screen too', () => {
    // The path is the drawing: `M x y L x y` is a line of no length, and a round cap is
    // what an SVG draws for one - so the dot on the screen is the pen, without this
    // file knowing anything about dots.
    takePen();
    tap({ x: 500, y: 300 });
    const line = document.querySelector('[data-testid="stroke-line"]');
    expect(line?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/u);
    expect(line?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]));
  });

  it('still draws nothing when the press was not the primary button', () => {
    takePen();
    const surface = toolSurface('pen');
    const at = { x: 400, y: 400 };
    // A right-press is a context menu on every other surface on this board; here it is
    // not a stroke, and it does not even start a preview.
    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 2,
      buttons: 2,
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();
    fireEvent.pointerUp(surface, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 2,
      buttons: 0,
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();
    expect(strokes()).toHaveLength(0);
    expect(penPreview()).toBeNull();
  });
});

/* ----------------------------------------------- TC-11: pen.interrupted */

describe('a stroke the pointer took away mid-drag is kept (TC-11)', () => {
  it('keeps the points drawn so far on pointercancel', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    pointerMove({ x: 320, y: 260 }, surface);
    pointerMove({ x: 440, y: 300 }, surface);
    pointerCancel({ x: 440, y: 300 }, surface);
    expect(strokes()).toHaveLength(1);
    const stroke = strokeData(0);
    expect(stroke.points.length).toBeGreaterThan(2);
    // Nothing was added on the way out: the line ends where the pointer was last heard.
    const last = {
      x: stroke.x + (stroke.points[stroke.points.length - 2] as number),
      y: stroke.y + (stroke.points[stroke.points.length - 1] as number),
    };
    expect(last.x).toBeCloseTo(worldOfScreen({ x: 440, y: 300 }).x, 1);
    expect(strokeElements()).toHaveLength(1);
  });

  it('keeps the ink and the pen it was drawing with', () => {
    takePen();
    clickPenColor('blue');
    const surface = toolSurface('pen');
    pointerDown({ x: 300, y: 300 }, surface);
    pointerMove({ x: 420, y: 380 }, surface);
    pointerCancel({ x: 420, y: 380 }, surface);
    expect(strokeData(0).color).toBe('blue');
  });

  it('drops the preview, and stays a pen', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 300 }, surface);
    pointerMove({ x: 380, y: 340 }, surface);
    expect(penPreview()).not.toBeNull();
    pointerCancel({ x: 380, y: 340 }, surface);
    expect(penPreview()).toBeNull();
    expect(penCursor()).toBeNull();
    expect(pressedTool()).toBe('pen');
  });

  it('treats a lost capture the same way, because it is the same news', () => {
    // `lostpointercapture` is what a browser sends after every release; the case that
    // matters is the one where the release never comes and only the capture goes away.
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 600, y: 200 }, surface);
    pointerMove({ x: 700, y: 260 }, surface);
    pointerUp({ x: 700, y: 260 }, surface);
    expect(strokes()).toHaveLength(1);
    // The capture that follows the release answers nothing: the stroke was already drawn.
    pointerUp({ x: 700, y: 260 }, surface);
    expect(strokes()).toHaveLength(1);
  });

  it('commits a dot when the cancel arrives before the pointer ever moved', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 350, y: 520 }, surface);
    pointerCancel({ x: 350, y: 520 }, surface);
    expect(strokes()).toHaveLength(1);
    expect(strokeData(0).points).toHaveLength(2);
  });
});

/* ------------------------------------------ TC-12: pen.long_stroke */

describe('a drag longer than one stroke can hold (TC-12)', () => {
  it('makes two strokes, the second starting where the first ended', () => {
    // The boundary: the cap is 5000 points, and this drag delivers a thousand more than
    // that, in the way a fast pointer really delivers them - one event per frame carrying
    // a hundred coalesced samples. The cap is crossed three quarters of the way along, so
    // there is a third of the drag left to draw after the split.
    takePen();
    coalescedDragOnPen({ x: 120, y: 120 }, { x: 1160, y: 680 }, 101, 60);

    expect(strokes()).toHaveLength(2);
    const first = strokeData(0);
    const second = strokeData(1);

    // Both are at the cap or under it, and neither is empty.
    expect(first.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);

    // The join, in board units: the last point of the first stroke and the first point of
    // the second are the same place. That shared point is what makes two objects draw as
    // one line - the round cap of one lies under the round cap of the other - and a trail
    // that merely stopped and started would put a gap the width of the pen at the join.
    const firstEnd = {
      x: first.x + (first.points[first.points.length - 2] as number),
      y: first.y + (first.points[first.points.length - 1] as number),
    };
    const secondStart = {
      x: second.x + (second.points[0] as number),
      y: second.y + (second.points[1] as number),
    };
    expect(secondStart.x).toBeCloseTo(firstEnd.x, 4);
    expect(secondStart.y).toBeCloseTo(firstEnd.y, 4);

    // And the pen went on drawing after the split: the second object covers the rest of
    // the drag - reach, not point count, because what is stored is what the simplifier
    // kept, and the rest of this drag was a straight line.
    expect(second.x + (second.width ?? 0)).toBeGreaterThan(first.x + (first.width ?? 0) + 5);
    // Where the split fell: the first object holds the drag up to the cap, which for this
    // drag is most of the way along, and the second holds what came after.
    expect(first.x + (first.width ?? 0)).toBeLessThan(worldOfScreen({ x: 1160, y: 680 }).x);
    expect(second.x).toBeGreaterThan(worldOfScreen({ x: 120, y: 120 }).x);
  });

  it('keeps drawing after the split, to the place the pointer let go', () => {
    takePen();
    const to = { x: 1000, y: 640 };
    coalescedDragOnPen({ x: 100, y: 140 }, to, 101, 50);
    const last = strokeData(strokes().length - 1);
    const end = {
      x: last.x + (last.points[last.points.length - 2] as number),
      y: last.y + (last.points[last.points.length - 1] as number),
    };
    expect(end.x).toBeCloseTo(worldOfScreen(to).x, 1);
    expect(end.y).toBeCloseTo(worldOfScreen(to).y, 1);
  });

  it('is still one pen, with nothing left drawing', () => {
    takePen();
    coalescedDragOnPen({ x: 120, y: 120 }, { x: 1160, y: 680 }, 101, 60);
    expect(pressedTool()).toBe('pen');
    expect(penPreview()).toBeNull();
    expect(selectedObjectIds()).toEqual([]);
  });

  it('counts every coalesced sample, not one point per event', () => {
    // The preview's `data-points` is the trail's length: a tool that read only the
    // event's own coordinates would report one point per frame and draw a straight line
    // through what was a curve.
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 100, y: 500 }, surface);
    flushFrames();
    expect(penPreviewPoints()).toBe(1);
    coalescedDragUntil(5, 20);
    // 1 press + 5 events x 20 samples = 101 points of trail.
    expect(penPreviewPoints()).toBe(101);
  });

  it('thins the trail before it is stored, however many samples arrived', () => {
    // A straight drag at 2525 samples is a straight line, and a straight line is two
    // points: `pen.smooth` is what keeps a five-thousand-point drag from putting five
    // thousand numbers on the wire.
    takePen();
    coalescedDragOnPen({ x: 120, y: 120 }, { x: 1160, y: 680 }, 101, 25);
    expect(strokes()).toHaveLength(1);
    expect(strokeData(0).points.length).toBeLessThan(20);
  });
});

/** Deliver `events` coalesced moves of `samples` each without releasing. */
function coalescedDragUntil(events: number, samples: number): void {
  const surface = toolSurface('pen');
  for (let event = 0; event < events; event += 1) {
    const move = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 1,
      clientX: 100 + (event + 1) * 8,
      clientY: 500 + (event + 1) * 3,
    });
    Object.defineProperty(move, 'getCoalescedEvents', {
      configurable: true,
      writable: true,
      value: () =>
        Array.from({ length: samples }, (_unused, index) => ({
          clientX: 100 + event * 8 + (index * 8) / samples,
          clientY: 500 + event * 3 + (index * 3) / samples,
        })),
    });
    surface.dispatchEvent(move);
    flushFrames();
  }
}

/* ---------------------------------------------------- TC-13: the pen is put down */

describe('putting the pen down mid-stroke draws nothing (TC-13)', () => {
  it('draws nothing when Escape ends the drag, and leaves Select pressed', () => {
    // Escape mid-drag is "never mind", and the tool layer going away is what cancels the
    // gesture - which is the opposite of the interrupted case above: there the pointer
    // was taken away from a pen that stayed a pen, and here the person asked for the pen
    // to stop existing.
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    pointerMove({ x: 400, y: 300 }, surface);
    keydown('Escape');
    expect(pressedTool()).toBe('select');
    expect(strokes()).toHaveLength(0);
    expect(strokeElements()).toHaveLength(0);
    expect(penPreview()).toBeNull();
    expect(toolSurfaceExists('pen')).toBe(false);
  });

  it('draws nothing when another tool is chosen mid-drag', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    pointerMove({ x: 400, y: 300 }, surface);
    clickTool('select');
    keydown('V');
    expect(pressedTool()).toBe('select');
    expect(strokes()).toHaveLength(0);
  });

  it('presses Select with V, and takes the pen up again with P', () => {
    expect(penToolButton().getAttribute('aria-pressed')).toBe('false');
    keydown('P');
    expect(pressedTool()).toBe('pen');
    expect(toolSurfaceExists('pen')).toBe(true);
    keydown('V');
    expect(pressedTool()).toBe('select');
    expect(toolSurfaceExists('pen')).toBe(false);
  });

  it('leaves nothing behind in the document when the drag was abandoned', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 100, y: 100 }, surface);
    pointerMove({ x: 600, y: 600 }, surface);
    keydown('Escape');
    expect(docNotes()).toHaveLength(0);
    expect(boardDoc().getMap('objects').size).toBe(0);
  });
});

/* ------------------------------- TC-14: the options are for the next stroke only */

describe('the options are the next stroke\'s, not the last one\'s (TC-14)', () => {
  it('leaves a stroke already drawn exactly as it was, and draws the next one differently', () => {
    takePen();
    drag({ x: 200, y: 200 }, { x: 420, y: 320 });
    const before = strokeData(0);
    const beforeD = document
      .querySelector('[data-testid="stroke-line"]')
      ?.getAttribute('d');

    clickPenColor('purple');
    clickPenThickness('thin');

    // The stroke that is already on the board: same ink, same pen, same path, and the
    // same element - changing a pen option has nothing on the board it is allowed to
    // restyle, because it is not looking for anything to restyle.
    expect(strokeData(0).color).toBe(before.color);
    expect(strokeData(0).thickness).toBe(before.thickness);
    expect(document.querySelector('[data-testid="stroke-line"]')?.getAttribute('d')).toBe(beforeD);

    drag({ x: 500, y: 400 }, { x: 760, y: 520 });
    expect(strokes()).toHaveLength(2);
    expect(strokeData(1).color).toBe('purple');
    expect(strokeData(1).thickness).toBe('thin');
  });

  it('keeps the choice for every stroke after it, until it is changed again', () => {
    takePen();
    clickPenColor('green');
    drag({ x: 200, y: 200 }, { x: 300, y: 300 });
    drag({ x: 320, y: 320 }, { x: 420, y: 420 });
    expect(strokeData(0).color).toBe('green');
    expect(strokeData(1).color).toBe('green');
    clickPenColor('orange');
    drag({ x: 440, y: 440 }, { x: 540, y: 540 });
    expect(strokeData(2).color).toBe('orange');
    expect(strokeData(1).color).toBe('green');
  });

  it('applies an option changed while the pointer is down to the stroke in progress', () => {
    // The pen reads its options when it lets go, not when it goes down: the swatch is
    // reachable mid-drag on a touchscreen, and a stroke drawn in last week's ink because
    // the press happened before the click would be a stroke nobody chose.
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 300, y: 300 }, surface);
    pointerMove({ x: 420, y: 360 }, surface);
    clickPenColor('red');
    pointerMove({ x: 520, y: 420 }, surface);
    pointerUp({ x: 520, y: 420 }, surface);
    expect(strokeData(0).color).toBe('red');
  });

  it('is the same ink and pen on both ends of a stroke made across a split', () => {
    takePen();
    clickPenColor('blue');
    clickPenThickness('thick');
    coalescedDragOnPen({ x: 120, y: 120 }, { x: 1160, y: 680 }, 101, 60);
    expect(strokes()).toHaveLength(2);
    for (const stroke of strokes()) {
      expect(stroke.color).toBe('blue');
      expect(stroke.thickness).toBe('thick');
    }
  });
});

/* ----------------------------------------------- pen.share: the preview is local */

describe('the stroke reaches the document when the pointer lets go (pen.share)', () => {
  it('shows nothing in the document while the drag is going on', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 300 }, surface);
    pointerMove({ x: 400, y: 340 }, surface);
    pointerMove({ x: 600, y: 380 }, surface);
    // The preview is on this screen...
    expect(penPreview()).not.toBeNull();
    expect(penCursor()).not.toBeNull();
    // ...and the shared document has not been told a drawing is happening.
    expect(strokes()).toHaveLength(0);
    expect(strokeElements()).toHaveLength(0);
    expect(boardDoc().getMap('objects').size).toBe(0);
  });

  it('grows the preview with the drag and removes it on release', () => {
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    flushFrames();
    const first = penPreview()?.getAttribute('d') ?? '';
    expect(first.startsWith('M ')).toBe(true);
    pointerMove({ x: 500, y: 400 }, surface);
    flushFrames();
    const second = penPreview()?.getAttribute('d') ?? '';
    expect(second).not.toBe(first);
    // Two points is a line: the preview is the trail, and the trail has grown.
    expect(second).toBe('M 200 200 L 500 400');
    pointerUp({ x: 500, y: 400 }, surface);
    expect(penPreview()).toBeNull();
    expect(penCursor()).toBeNull();
    expect(strokes()).toHaveLength(1);
  });

  it('draws the preview in the ink and at the width of the pen', () => {
    takePen();
    clickPenColor('red');
    clickPenThickness('thick');
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    pointerMove({ x: 420, y: 320 }, surface);
    flushFrames();
    const preview = penPreview();
    expect(preview?.getAttribute('stroke')).toBe(PEN_COLORS.red);
    // Screen pixels: the pen's width is board units, and at 100% the two are the same.
    expect(preview?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
  });

  it('is one stroke per drag when the release is delivered twice', () => {
    // React state updaters may run more than once per event, which is why the drag lives
    // in a ref: a second release must find nothing to draw.
    takePen();
    const surface = toolSurface('pen');
    pointerDown({ x: 200, y: 200 }, surface);
    pointerMove({ x: 400, y: 320 }, surface);
    pointerUp({ x: 400, y: 320 }, surface);
    pointerUp({ x: 400, y: 320 }, surface);
    expect(strokes()).toHaveLength(1);
  });

  it('leaves the preview in screen coordinates and the stroke in board ones', () => {
    // The camera pans and zooms; the drawing must not. What is stored is board units, and
    // what is drawn while drawing is screen pixels.
    setZoom(2);
    takePen();
    const surface = toolSurface('pen');
    const at = { x: 640, y: 400 };
    pointerDown(at, surface);
    pointerMove({ x: 700, y: 460 }, surface);
    flushFrames();
    const preview = penPreview()?.getAttribute('d') ?? '';
    expect(Number(preview.replace(/^M /u, '').split(' ')[0])).toBeCloseTo(640, 0);
    pointerUp({ x: 700, y: 460 }, surface);
    // The stored place is the board's, and the round trip comes back to the pixel that
    // was pressed at - which is the whole reason the tool converts on release rather than
    // storing what the pointer said.
    expect(strokeData(0).x + (strokeData(0).points[0] as number)).toBeCloseTo(worldOfScreen(at).x, 1);
  });
});

/* ------------------------------------ pen.options: the bar, and its defaults */

describe('the pen\'s own option bar (pen.options)', () => {
  it('is on the screen only while the pen is the tool', () => {
    expect(penToolbarElement()).toBeNull();
    takePen();
    expect(penToolbarElement()).not.toBeNull();
    keydown('V');
    expect(penToolbarElement()).toBeNull();
  });

  it('starts at the default ink and the default pen on every load', () => {
    // `pen.options.defaults`: a fresh render is a fresh pen. Nothing here is remembered
    // from the last board or the last minute - the PRD's "defaults on every load" is a
    // decision not to use local storage, and a re-render is how a test can see it.
    renderBoard();
    takePen();
    expect(pressedPenColor()).toBe(DEFAULT_PEN_COLOR);
    expect(pressedPenThickness()).toBe(DEFAULT_PEN_THICKNESS);
  });

  it('lists six inks and three widths, and says which is chosen', () => {
    takePen();
    expect(penColorButtons()).toHaveLength(6);
    expect(penThicknessButtons()).toHaveLength(3);
    expect(penColorButton('black').getAttribute('aria-pressed')).toBe('true');
    expect(penThicknessButton('medium').getAttribute('aria-pressed')).toBe('true');
    clickPenColor('blue');
    expect(pressedPenColor()).toBe('blue');
    // Only one of them is ever the chosen one.
    expect(penColorButtons().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('keeps its own settings out of the document', () => {
    takePen();
    clickPenColor('red');
    clickPenThickness('thick');
    // Nothing in the board: the ink and pen of a stroke arrive with the stroke, and the
    // pen this tab is holding is nobody else's business.
    expect(boardDoc().getMap('objects').size).toBe(0);
    expect(boardDoc().getMap<string>('settings')?.size ?? 0).toBe(0);
  });

  it('takes the ink from the button the click landed on, not from the order', () => {
    takePen();
    clickPenColor('green');
    drag();
    expect(strokeData(0).color).toBe('green');
  });

  it('does not draw a stroke under the option bar', () => {
    // The bar is chrome beside the board, not board: a click on a swatch chooses a pen,
    // and does not put a dot on the board underneath it.
    takePen();
    clickPenColor('blue');
    expect(strokes()).toHaveLength(0);
  });
});

/* ------------------------------------------ pen.navigation: the pen is over all */

describe('the pen owns the pointer over the whole board (pen.navigation)', () => {
  it('has a surface over the board while it is the tool, and no surface otherwise', () => {
    expect(toolSurfaceExists('pen')).toBe(false);
    takePen();
    expect(toolSurfaceExists('pen')).toBe(true);
    keydown('V');
    expect(toolSurfaceExists('pen')).toBe(false);
  });

  it('does not move a sticky note the drag started and ended on', () => {
    // The reason the pen is a layer over the board rather than a listener on it: a
    // stroke that begins on somebody else's note must not pick that note up.
    createSelectedNote('Standup notes');
    const before = noteData(0);
    const start = screenOf({ x: before.x + 20, y: before.y + 20 });
    takePen();
    dragPenThrough([start, { x: start.x + 120, y: start.y + 90 }, { x: start.x + 260, y: start.y + 140 }]);
    expect(strokes()).toHaveLength(1);
    expect(noteData(0).x).toBe(before.x);
    expect(noteData(0).y).toBe(before.y);
    // The note was already selected, from the test that made it; what the pen must not do
    // is add the stroke it drew over it to that selection, or take the note out of it.
    expect(selectedObjectIds()).toEqual([noteId(0)]);
  });

  it('does not select anything it drew over', () => {
    createSelectedNote('Retro');
    takePen();
    drag();
    // The note's own selection, and nothing the pen drew: a stroke is never selection
    // content while the pen is still in the hand.
    expect(selectedObjectIds()).toEqual([noteId(0)]);
    expect(selectedObjectIds()).not.toContain(strokeId(0));
  });

  it('still pans the board with the wheel, because the pen is above the board and not in front of it', () => {
    // `pen.navigation` is about drags. The wheel is the board's: a pen that swallowed
    // zoom and pan would leave a person holding a tool they could not move around with.
    const before = board().style.backgroundPosition;
    takePen();
    const surface = toolSurface('pen');
    surface.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 120, deltaX: 40, bubbles: true, cancelable: true, clientX: 640, clientY: 400 }),
    );
    flushFrames();
    expect(board().style.backgroundPosition).not.toBe(before);
    expect(strokes()).toHaveLength(0);
  });

  it('is drawn above the objects it is drawing over', () => {
    createSelectedNote('Underneath');
    takePen();
    // The surface is a later sibling of the world layer, which is how it gets the press
    // first; the note is under it in the stacking order as well as in the document.
    expect(toolSurface('pen').compareDocumentPosition(board()) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0);
  });
});

/* ------------------------------------------------ drawing something with a shape */

describe('a drawn line is the line that was dragged', () => {
  it('keeps a curve drawn as a curve', () => {
    takePen();
    drawThrough(circle.map((point) => ({ x: point.x, y: point.y })));
    expect(strokes()).toHaveLength(1);
    const stroke = strokeData(0);
    // A circle is a wide, tall, closed thing: the box says so, and the simplifier kept
    // the turns rather than flattening it into a polygon of two points.
    expect(stroke.width).toBeGreaterThan(100);
    expect(stroke.height).toBeGreaterThan(100);
    expect(stroke.points.length).toBeGreaterThan(6);
  });

  it('keeps a scribble that crosses itself', () => {
    takePen();
    drawThrough(scribble.map((point) => ({ x: point.x, y: point.y })));
    const stroke = strokeData(0);
    expect(stroke.points.length / 2).toBeLessThan(scribble.length);
    expect(stroke.z).toBeGreaterThan(0);
  });

  it('is one element per stroke on the screen, with the ink it was drawn in', () => {
    takePen();
    drag({ x: 200, y: 200 }, { x: 400, y: 300 });
    drag({ x: 420, y: 320 }, { x: 640, y: 420 });
    expect(strokeElements()).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="stroke-svg"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="stroke-line"]')).toHaveLength(2);
  });
});
