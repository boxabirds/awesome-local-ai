// Drawing with the pen (`pen.draw`, `pen.dot`, `pen.interrupted`, `pen.long_stroke`,
// `pen.stay_active`, `pen.options`, `pen.navigation`).
//
// Everything here runs against the real `<Board>` with the fake provider, because a pen is
// a thing a hand does to a screen: whether the samples a fast stroke swallowed are still in
// the drawing, whether a stroke that was interrupted came back, whether the tool was put
// away after the first line, whether the wheel still moved the board with the pen up. None
// of that is answerable by calling a function — the functions have all been called in
// `tests/unit/stroke.test.ts`; what is under test here is the tool that calls them.
//
// The one thing the driver does that is worth naming: a gesture with the pen up is
// dispatched on the pen's **sheet**, the element a browser hands the pointer to while that
// tool is up. The sheet is the tool. A test that dispatched its drag on the viewport instead
// would be asserting that a tool's sheet does not catch the pointer, which is not what one
// does.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { penTest } from './helpers/stroke-assertions';
import {
  camera,
  clickPenColor,
  clickPenThickness,
  dispatchCoalescedMove,
  dotWithPen,
  drawStroke,
  FakeWebsocketProvider,
  flush,
  interruptPen,
  noSheetIsUp,
  open,
  penColorButtons,
  penColorPressed,
  penCursor,
  penPreview,
  penPreviewD,
  penSheet,
  penThicknessButtons,
  penThicknessPressed,
  penToolbar,
  penToolActive,
  pressEscape,
  pressPen,
  pressPenTool,
  pressRedo,
  pressSelectTool,
  pressTextTool,
  pressUndo,
  releasePen,
  screenOfPoint,
  screenOfPoints,
  selectToolActive,
  settleBeyondCaptureWindow,
  strokeBox,
  strokeDrawnPoints,
  strokeIds,
  strokeObject,
  textToolActive,
} from './helpers/pen-ui';
import { dispatchGesture, dispatchPointer, dispatchWheel } from './helpers/events';import { handwrittenLoop, spiral, underline } from '../fixtures/pen-paths';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'pen-tool-under-test';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A short line, straight through the middle of what is on screen. */
const shortLine = underline({ x: -120, y: 40 }, 240, 12);

describe('pen.draw', () => {
  // TC-09, at the level a component test reaches: the tool, not the algorithm.
  it('TC-09 records the path the pointer traced and writes one stroke when it lifts', () => {
    const path = handwrittenLoop({ x: 0, y: -40 }, 150, 60);
    const created = drawStroke(path);

    expect(created).toHaveLength(1);
    const id = created[0] as string;
    const stroke = strokeObject(id);
    const ink = strokeDrawnPoints(id);
    expect(stroke.type).toBe('stroke');

    // What is stored is the drawing: the pen went down at the first point and came up at
    // the last, and smoothing only ever takes points away.
    expect(ink.length).toBeGreaterThan(1);
    expect(ink.length).toBeLessThanOrEqual(path.length);
    penTest.samePoint(penTest.firstPoint(ink), penTest.firstPoint(path));
    penTest.samePoint(penTest.lastPoint(ink), penTest.lastPoint(path));

    // It is on the screen as one drawing, and the preview that followed the pointer is
    // gone: the finished stroke belongs to the document now, and the object draws it.
    expect(screen.getAllByTestId('stroke-object')).toHaveLength(1);
    expect(penPreview()).toBeNull();

    // One stroke, one action: what the undo shortcut takes away is the whole line.
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(0);
    pressRedo();
    flush();
    expect(strokeIds()).toHaveLength(1);
  });

  // TC-09 again from the side the browser is in: a fast stroke arrives as a handful of
  // events with dozens of samples hidden inside each, and the drawing is supposed to have
  // all of them (`pen.draw`: "the samples the browser coalesced into one event").
  it('TC-09 keeps the samples a browser coalesced into one move', () => {
    pressPenTool();
    const sheet = penSheet();
    const down = screenOfPoint({ x: -100, y: 120 });
    dispatchPointer(sheet, 'pointerdown', down.x, down.y);
    flush();

    // One event, five samples, and a corner in the middle: the only place a straight line
    // between the two ends cannot account for. Throw the samples away and the drawing is
    // a straight line and this corner does not exist.
    const samples = screenOfPoints([
      { x: -80, y: 118 },
      { x: -60, y: 100 },
      { x: -40, y: 140 },
      { x: -20, y: 116 },
      { x: 0, y: 120 },
    ]);
    dispatchCoalescedMove(sheet, samples);
    flush();

    // The round cursor is where the pen is, and is round: the thickness you chose, as you
    // draw with it.
    const cursor = penCursor();
    expect(cursor).not.toBeNull();
    expect(cursor?.style.borderRadius).toBe('50%');

    const last = samples[samples.length - 1];
    if (last === undefined) throw new Error('the test lost its own samples');
    dispatchPointer(sheet, 'pointerup', last.x, last.y);
    flush();

    const created = strokeIds();
    expect(created).toHaveLength(1);
    const ink = strokeDrawnPoints(created[0] as string);
    expect(ink.length).toBeGreaterThan(2);
    const corner = ink.find((point) => Math.abs(point.y - 100) < 1);
    expect(corner ?? null).not.toBeNull();
  });

  // The pen is asked for by key and by rail, and both put the same sheet up.
  it('asks for the pen with P and puts it away with V', () => {
    expect(noSheetIsUp()).toBe(true);
    pressPenTool();
    expect(penToolActive()).toBe(true);
    expect(penSheet()).toBeTruthy();
    expect(penToolbar()).toBeTruthy();

    pressSelectTool();
    expect(penToolActive()).toBe(false);
    expect(noSheetIsUp()).toBe(true);
  });

  it('asks for the pen from the rail, the way someone not typing p does', () => {
    fireEvent.click(screen.getByTestId('tool-pen') as HTMLButtonElement);
    flush();
    expect(penToolActive()).toBe(true);
    expect(penSheet()).toBeTruthy();
  });

  // A stroke's preview is drawn from the board's own coordinates, which is what makes the
  // wheel able to move the board under a pen that is still down.
  it('TC-09 keeps a stroke in progress anchored to the board when the board is scrolled', () => {
    const path = underline({ x: -160, y: -200 }, 200, 6);
    pressPen(path);
    const before = penPreview()?.querySelector('[data-testid="pen-tool-preview-path"]');
    const d = before?.getAttribute('d') ?? '';
    expect(d).not.toBe('');
    expect(penPreviewD()).toBe(d);

    // Scroll the board along, with the pen still down, the way the wheel does.
    dispatchWheel(penSheet(), { deltaX: -100, deltaY: -100, clientX: 640, clientY: 400 });
    flush();

    const after = penPreview()?.querySelector('[data-testid="pen-tool-preview-path"]');
    const moved = after?.getAttribute('d') ?? '';
    // The drawing did not lose its shape and did not stay glued to the screen: it went
    // where the board went.
    expect(moved).not.toBe(d);
    expect(strokeIds()).toHaveLength(0);
    releasePen(path[5] as { x: number; y: number });
    expect(strokeIds()).toHaveLength(1);
  });
});

describe('pen.dot', () => {
  // TC-10
  it('TC-10 makes a dot from a press and a release that never travelled', () => {
    const created = dotWithPen({ x: 60, y: -100 });

    expect(created).toHaveLength(1);
    const id = created[0] as string;
    // One point and nothing else: no zero-length segment, no duplicate of it. (What the
    // document keeps is a flat list of numbers, two per point; what is drawn is points.)
    expect(strokeDrawnPoints(id)).toHaveLength(1);
    penTest.samePoint(penTest.firstPoint(strokeDrawnPoints(id)), { x: 60, y: -100 });

    // The box is the size of the mark, so the dot can be selected, and it obeys the floor.
    const box = strokeBox(id);
    expect(box.width).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);
    expect(box.height).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);
    expect(box.width).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);

    // And it is painted with round ends, which is what makes one point read as a dot.
    const path = within(screen.getByTestId('stroke-object')).getByTestId('stroke-path');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
  });

  // A press that wobbled is still a press and not a line: `DRAG_THRESHOLD_PX` is the rule.
  it('TC-10 counts a press that wobbled inside the drag threshold as one point', () => {
    pressPenTool();
    const sheet = penSheet();
    const start = screenOfPoint({ x: 200, y: 60 });
    dispatchPointer(sheet, 'pointerdown', start.x, start.y);
    flush();
    dispatchPointer(sheet, 'pointermove', start.x + 1, start.y + 1);
    flush();
    dispatchPointer(sheet, 'pointermove', start.x - 2, start.y + 2);
    flush();
    dispatchPointer(sheet, 'pointerup', start.x + 2, start.y - 1);
    flush();

    const created = strokeIds();
    expect(created).toHaveLength(1);
    expect(strokeDrawnPoints(created[0] as string)).toHaveLength(1);
  });

  // TC-10
  it('TC-10 takes a dot away in one undo step', () => {
    dotWithPen({ x: -220, y: 140 });
    expect(strokeIds()).toHaveLength(1);
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(0);
  });

  // The thickest pen makes the biggest dot, and the box grows to fit it.
  it('TC-10 makes a dot the thickness that was chosen', () => {
    pressPenTool();
    clickPenThickness('thick');
    const created = dotWithPen({ x: 0, y: 180 }, { pressTool: false });
    expect(strokeBox(created[0] as string).width).toBeCloseTo(PEN_THICKNESS_WORLD.thick, 6);
  });
});

describe('pen.interrupted', () => {
  // TC-11
  it('TC-11 commits what was drawn when the pointer is taken away mid-drag', () => {
    const path = handwrittenLoop({ x: 0, y: 0 }, 120, 40).slice(0, 18);
    pressPen(path);
    expect(penPreview()).not.toBeNull();

    interruptPen(path[17] as { x: number; y: number });

    const created = strokeIds();
    expect(created).toHaveLength(1);
    const ink = strokeDrawnPoints(created[0] as string);
    expect(ink.length).toBeGreaterThan(1);
    // The drawing stopped where the pointer was taken from it, not where the path was
    // going to go.
    penTest.samePoint(penTest.lastPoint(ink), path[17] as { x: number; y: number });
    expect(penPreview()).toBeNull();

    // One object, so undo takes the interrupted stroke away once and no more.
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(0);
  });

  // Most browsers follow a cancel with the release as well; committing on both is how one
  // drag becomes two strokes.
  it('TC-11 commits once when a cancel is followed by a release and a lost capture', () => {
    const path = underline({ x: -150, y: -160 }, 300, 10);
    pressPen(path);
    const sheet = penSheet();
    const last = screenOfPoint(path[9] as { x: number; y: number });
    dispatchPointer(sheet, 'pointercancel', last.x, last.y);
    dispatchPointer(sheet, 'pointerup', last.x, last.y);
    dispatchPointer(sheet, 'lostpointercapture', last.x, last.y);
    flush();

    expect(strokeIds()).toHaveLength(1);
  });

  // A stroke that vanishes because the browser ate the pointer is a lost drawing, so the
  // pen stays up after an interruption exactly as it does after a finished line.
  it('TC-11 leaves the pen up after an interrupted stroke', () => {
    pressPen(underline({ x: -100, y: 200 }, 200, 8));
    interruptPen({ x: 100, y: 200 });
    expect(penToolActive()).toBe(true);
    expect(noSheetIsUp()).toBe(false);
  });
});

describe('pen.long_stroke', () => {
  // TC-12
  it('TC-12 commits a part at the limit and carries on drawing from its last point', () => {
    const created = drawStroke(spiral({ x: 0, y: 0 }, STROKE_MAX_POINTS + 10), { stride: 0 });

    // One drawing, two objects — and no more objects than the drawing has parts in it.
    expect(created).toHaveLength(2);
    const first = strokeObject(created[0] as string);
    const second = strokeObject(created[1] as string);
    const firstInk = strokeDrawnPoints(first.id);
    const secondInk = strokeDrawnPoints(second.id);
    expect(firstInk.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(secondInk.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(firstInk.length).toBeGreaterThan(1);
    expect(secondInk.length).toBeGreaterThan(1);

    // The join: the second part starts where the first ended, so the line is not broken
    // and there is no gap, and no double back-track at the seam either.
    penTest.samePoint(penTest.lastPoint(firstInk), penTest.firstPoint(secondInk));

    // Both are on the screen, and one undo step takes one part and nothing else.
    expect(screen.getAllByTestId('stroke-object')).toHaveLength(2);
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(1);
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(0);
  });

  // The limit is about what a frame can afford, so a drawing that is merely long in the
  // ordinary way must not be cut up at all.
  it('TC-12 leaves an ordinary drawing alone', () => {
    const created = drawStroke(handwrittenLoop({ x: 0, y: 0 }, 200, 400));
    expect(created).toHaveLength(1);
    const ink = strokeDrawnPoints(created[0] as string);
    expect(ink.length).toBeGreaterThan(1);
    expect(ink.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
  });
});

describe('pen.stay_active', () => {
  // TC-13
  it('TC-13 keeps the pen up after a stroke and draws the next one without being asked', () => {
    const first = drawStroke(shortLine);
    expect(strokeIds()).toHaveLength(1);

    // The tool that is up is still the pen: drawing one line is not the end of drawing.
    expect(penToolActive()).toBe(true);
    expect(selectToolActive()).toBe(false);
    expect(textToolActive()).toBe(false);
    expect(noSheetIsUp()).toBe(false);

    // The next line needs no keystroke.
    const second = drawStroke(underline({ x: -120, y: 90 }, 240, 10), { pressTool: false });
    expect(strokeIds()).toHaveLength(2);
    expect(first[0]).not.toBe(second[0]);
    expect(penToolActive()).toBe(true);

    // And nothing is left hanging as a preview: each stroke went into the document when
    // its own pointer came up.
    expect(penPreview()).toBeNull();
  });

  // TC-13
  it('TC-13 leaves the tool on Escape and puts away the stroke half drawn', () => {
    const path = handwrittenLoop({ x: 0, y: 0 }, 100, 30).slice(0, 12);
    pressPen(path);
    expect(penPreview()).not.toBeNull();

    pressEscape();

    // The pen is gone and Select is what is left; nothing was written on the way out.
    expect(penToolActive()).toBe(false);
    expect(selectToolActive()).toBe(true);
    expect(noSheetIsUp()).toBe(true);
    expect(penPreview()).toBeNull();
    expect(strokeIds()).toHaveLength(0);

    // And the pointer coming up afterwards — which is what a real browser does next — has
    // no tool to say it to, so the discarded drawing cannot come back.
    expect(screen.queryByTestId('pen-tool')).toBeNull();
  });

  // The other way out of the tool, mid-drag: another tool asked for.
  it('TC-13 puts the pen away for another tool without committing the line in progress', () => {
    pressPen(underline({ x: -60, y: -60 }, 160, 10));
    pressTextTool();
    expect(textToolActive()).toBe(true);
    expect(penToolActive()).toBe(false);
    expect(strokeIds()).toHaveLength(0);
  });

  // Two strokes drawn one after the other are two steps, which is what makes a mistake
  // take one undo instead of the whole sketch.
  it('TC-13 undoes two strokes drawn one after the other as two steps', () => {
    drawStroke(shortLine);
    settleBeyondCaptureWindow();
    drawStroke(underline({ x: -120, y: 120 }, 240, 10), { pressTool: false });
    expect(strokeIds()).toHaveLength(2);
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(1);
    pressUndo();
    flush();
    expect(strokeIds()).toHaveLength(0);
  });

  // A stroke is not selected by being drawn, because the pen is still the tool in hand:
  // the next line goes where the pointer is, not next to the last one.
  it('TC-13 leaves nothing selected after a stroke', () => {
    drawStroke(shortLine);
    expect(screen.queryAllByTestId('resize-handle')).toHaveLength(0);
    expect(strokeIds()).toHaveLength(1);
  });
});

describe('pen.options', () => {
  // TC-14
  it('TC-14 offers six colours and three thicknesses, black and medium to begin with', () => {
    pressPenTool();
    expect(penToolbar()).toBeTruthy();
    expect(penColorButtons()).toHaveLength(6);
    expect(penThicknessButtons()).toHaveLength(3);
    expect(penColorPressed('black')).toBe(true);
    expect(penColorPressed('red')).toBe(false);
    expect(penThicknessPressed('medium')).toBe(true);
    expect(penThicknessPressed('thin')).toBe(false);

    // The names the screen reader reads out, and the tests click by.
    for (const name of ['Black', 'Blue', 'Red', 'Green', 'Orange', 'Purple']) {
      expect(screen.getByLabelText(`${name} pen`)).toBeTruthy();
    }
    for (const name of ['Thin', 'Medium', 'Thick']) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  // TC-14
  it('TC-14 draws the next stroke with what is chosen and leaves the strokes that exist alone', () => {
    const before = drawStroke(shortLine);
    expect(strokeObject(before[0] as string).color).toBe('black');
    expect(strokeObject(before[0] as string).thickness).toBe('medium');

    clickPenColor('red');
    clickPenThickness('thick');
    expect(penColorPressed('red')).toBe(true);
    expect(penColorPressed('black')).toBe(false);
    expect(penThicknessPressed('thick')).toBe(true);

    const after = drawStroke(underline({ x: -120, y: 90 }, 240, 10), { pressTool: false });
    expect(strokeObject(after[0] as string).color).toBe('red');
    expect(strokeObject(after[0] as string).thickness).toBe('thick');

    // Nothing that already exists was restyled: a stroke keeps the colour and thickness it
    // was drawn with, whatever the toolbar says now.
    expect(strokeObject(before[0] as string).color).toBe('black');
    expect(strokeObject(before[0] as string).thickness).toBe('medium');
    expect(strokeIds()).toHaveLength(2);
  });

  // TC-14
  it('TC-14 holds the choice for the rest of the session, and no longer', () => {
    drawStroke(shortLine);
    clickPenColor('green');
    clickPenThickness('thin');

    // The pen is still up and still green and thin, two lines and a lot of frames later.
    drawStroke(underline({ x: -120, y: 20 }, 200, 8), { pressTool: false });
    drawStroke(underline({ x: -120, y: 60 }, 200, 8), { pressTool: false });
    flush();
    expect(strokeIds()).toHaveLength(3);
    expect(penColorPressed('green')).toBe(true);
    expect(penThicknessPressed('thin')).toBe(true);
    for (const id of strokeIds().slice(1)) {
      expect(strokeObject(id).color).toBe('green');
      expect(strokeObject(id).thickness).toBe('thin');
    }

    // A session is a mounted board. A new one starts the way the pen always starts: these
    // values were never written down anywhere, which is all "not remembered between
    // sessions" can mean in an implementation you can check.
    cleanup();
    open(BOARD_ID);
    pressPenTool();
    expect(penColorPressed('black')).toBe(true);
    expect(penThicknessPressed('medium')).toBe(true);
    expect(strokeIds()).toHaveLength(0);
  });

  // The options belong to the pen and to nothing else.
  it('TC-14 shows the pen options only while the pen is up', () => {
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    pressPenTool();
    expect(screen.getByTestId('pen-toolbar')).toBeTruthy();
    pressSelectTool();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
  });

  // Choosing is not drawing: the panel takes the pointer, so a click on a swatch is not
  // also a press on the board behind it.
  it('TC-14 draws nothing when a colour is chosen', () => {
    pressPenTool();
    clickPenColor('purple');
    clickPenThickness('thin');
    expect(strokeIds()).toHaveLength(0);
    expect(penColorPressed('purple')).toBe(true);
    expect(penThicknessPressed('thin')).toBe(true);
  });

  // The palette and the sizes are the ones the PRD names, in the constants the toolbar,
  // the tool and the model all read from.
  it('TC-14 starts at black and medium, and thick is the thickest', () => {
    // The names the PRD gives, in the one table the toolbar, the tool and the model read.
    expect(Object.keys(PEN_COLORS)).toHaveLength(6);
    expect(Object.keys(PEN_THICKNESS_WORLD)).toHaveLength(3);
    expect(PEN_COLORS.black).toMatch(/^#[0-9a-f]{6}$/);
    expect(PEN_THICKNESS_WORLD.medium).toBeGreaterThan(PEN_THICKNESS_WORLD.thin);
    expect(PEN_THICKNESS_WORLD.thick).toBeGreaterThan(PEN_THICKNESS_WORLD.medium);
    expect(DEFAULT_PEN_COLOR).toBe('black');
    expect(DEFAULT_PEN_THICKNESS).toBe('medium');
  });
});

describe('pen.navigation', () => {
  // The board's own navigation, which the pen is not allowed to swallow: `pen.navigation`
  // in the PRD, and story 2's wheel and pinch handlers, which stay installed whatever tool
  // is up.
  it('pen.navigation scrolls and pinches the board with the pen up, and draws nothing on the way', () => {
    const drawn = drawStroke(shortLine);
    expect(penToolActive()).toBe(true);
    const still = camera();

    // Plain scroll: the board moves in the direction it was scrolled, with the pen up.
    dispatchWheel(penSheet(), { deltaY: -240, clientX: 640, clientY: 400 });
    flush();
    expect(camera().y).not.toBe(still.y);
    expect(camera().zoom).toBe(still.zoom);

    // Sideways scroll moves it the other way, and nothing else happens.
    const afterScroll = camera();
    dispatchWheel(penSheet(), { deltaX: -180, clientX: 640, clientY: 400 });
    flush();
    expect(camera().x).not.toBe(afterScroll.x);

    // Nothing was drawn by any of it.
    expect(strokeIds()).toEqual(drawn);
    expect(screen.queryAllByTestId('stroke-object')).toHaveLength(1);
  });

  it('pen.navigation pinches the board with the pen up and keeps the drawing and the selection', () => {
    const drawn = drawStroke(shortLine);
    const still = camera();

    // Safari's pinch: three events, non-standard, and the pen's sheet is in the way of
    // none of them.
    const sheet = penSheet();
    dispatchGesture(sheet, 'gesturestart', 1, 640, 400);
    dispatchGesture(sheet, 'gesturechange', 1.4, 640, 400);
    dispatchGesture(sheet, 'gestureend', 1.4, 640, 400);
    flush();

    expect(camera().zoom).not.toBe(still.zoom);
    expect(strokeIds()).toEqual(drawn);
    expect(strokeDrawnPoints(drawn[0] as string).length).toBeGreaterThan(1);
  });

  // Trackpad pinch arrives as a wheel with ctrlKey held, which is the other half of the
  // same sentence.
  it('pen.navigation zooms with a ctrl-key wheel with the pen up', () => {
    const drawn = drawStroke(shortLine);
    const still = camera();
    dispatchWheel(penSheet(), { deltaY: -120, ctrlKey: true, clientX: 640, clientY: 400 });
    flush();
    expect(camera().zoom).not.toBe(still.zoom);
    expect(strokeIds()).toEqual(drawn);
  });

  // The board under the pen does not pan and does not marquee: a drag with the pen up is a
  // line and nothing else.
  it('pen.navigation keeps the board still under the pen while it draws', () => {
    const still = camera();
    drawStroke(shortLine);
    expect(camera().x).toBe(still.x);
    expect(camera().y).toBe(still.y);
    expect(camera().zoom).toBe(still.zoom);
    expect(strokeIds()).toHaveLength(1);
  });
});
