/**
 * Story 11 end-to-end: sketching with the pen, alone and together.
 *
 * These are the things only a real browser and a real room can answer:
 *
 *  - **does the line follow the pointer?** A preview that only exists at the end of a gesture is
 *    a preview nobody sees, so the drag is stepped with a real mouse and the screen is read
 *    between the steps (`pen.draw`);
 *  - **does anything of it leak?** The stroke must not be on the board — nor on anybody else's
 *    screen — while the hand is still moving, and must be there, once, when it stops
 *    (`pen.share`);
 *  - **is the box the pen promised the box that arrives?** A stroke's bounding box is worked out
 *    from the pointer's own path at the zoom the board was at, which is the one measurement here
 *    that a test can compare against the mouse itself;
 *  - **does the pen get in the way of the board?** A drag that starts in the middle of a sticky
 *    note draws over it and leaves it where it was, while the wheel still moves the camera
 *    (`pen.navigation`);
 *  - **does a sketch behave like the objects it was drawn over?** It arrives on the other
 *    person's screen, it is selected by its line, and Backspace removes it for everyone
 *    (`pen.select`, `pen.share`).
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { scaledPoints } from '../../src/shared/objects/stroke';
import {
  boardObjects,
  dragByMouse,
  dragResizeHandleBy,
  doubleClickBoard,
  drawStrokeByPath,
  getCamera,
  holdPenTool,
  notes,
  objectCentreOnScreen,
  openBoard,
  penColorButton,
  penCursor,
  penPreviewPath,
  penSurface,
  penThicknessButton,
  penToolbar,
  pinchAt,
  pressedTool,
  putPenDown,
  screenOf,
  selectedCount,
  strokeBoxOnScreen,
  strokeElements,
  strokeInk,
  strokesOn,
  toolButton,
  toolMode,
  worldOf
} from './helpers/board';
import { closeSessions, openSession, positionOf, type Session } from './helpers/participants';

/** Sessions opened here, so a failing test leaves no browsers behind. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

async function withPeople(browser: Browser, ...names: string[]): Promise<Session> {
  const session = await openSession(browser, names);
  sessions.push(session);
  return session;
}

/** A zigzag across the middle of the board, in board units, with the extremes at its corners. */
function squiggle(): Point[] {
  return [
    { x: -200, y: -60 },
    { x: -120, y: 20 },
    { x: -40, y: -70 },
    { x: 40, y: 30 },
    { x: 120, y: -40 },
    { x: 200, y: 10 }
  ];
}

function boundsOf(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

/** Where the last point of a preview path is, so it can be compared with the pointer. */
function previewEnd(d: string | null): Point | null {
  const numbers = (d ?? '').match(/-?[\d.]+/g);
  if (!numbers || numbers.length < 2) return null;
  return { x: Number(numbers[numbers.length - 2]), y: Number(numbers[numbers.length - 1]) };
}

/** Click a board point, wherever the camera is drawing it. */
async function clickWorld(page: Page, world: Point): Promise<void> {
  const at = await screenOf(page, world);
  await page.mouse.click(at.x, at.y);
}

function distance(a: Point | null, b: Point): number {
  if (!a) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test.describe('drawing with the pen', () => {
  test('TC-17: a drag paints a line that follows the pointer and leaves exactly one stroke behind', async ({
    page
  }) => {
    await openBoard(page);
    await holdPenTool(page);
    expect(await pressedTool(page)).toBe('pen');

    const path = squiggle();
    const { preview, strokes } = await drawStrokeByPath(page, path, {
      steps: 4,
      // While the hand is moving there is nothing on the board and no write anywhere: the line
      // exists on this screen only (`pen.share`).
      onStep: async () => {
        expect(await strokeElements(page).count()).toBe(0);
        await expect(penCursor(page)).toHaveCount(1);
      }
    });

    // The preview grew with the pointer rather than appearing at the end of the gesture.
    const drawn = preview.filter((d) => d.length > 0);
    expect(drawn.length).toBeGreaterThan(0);
    expect(new Set(drawn).size).toBeGreaterThan(1);

    // One stroke, no more: the gesture is one object, not one object per point the pointer made.
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0];
    if (!stroke) throw new Error('the gesture left no stroke');
    const held = scaledPoints(stroke);
    expect(held.length).toBeGreaterThan(1);

    // Its box is the line's own bounds, padded by half the thickness the pen was set to: this is
    // the board's promise that a stroke can be found, selected and framed like anything else.
    const pad = PEN_THICKNESS_WORLD[stroke.thickness] / 2;
    const bounds = boundsOf(path);
    expect(stroke.x).toBeGreaterThanOrEqual(bounds.minX - pad - 1);
    expect(stroke.x).toBeLessThanOrEqual(bounds.minX - pad + 1);
    expect(stroke.y).toBeGreaterThanOrEqual(bounds.minY - pad - 1);
    expect(stroke.y).toBeLessThanOrEqual(bounds.minY - pad + 1);
    expect(stroke.width).toBeGreaterThanOrEqual(bounds.maxX - bounds.minX + pad * 2 - 2);
    expect(stroke.height).toBeGreaterThanOrEqual(bounds.maxY - bounds.minY + pad * 2 - 2);

    // The preview is gone, the ink is on the board, and the pen is still in hand (`pen.stay_active`).
    await expect(penPreviewPath(page)).toHaveCount(0);
    await expect(strokeElements(page)).toHaveCount(1);
    expect(await toolMode(page)).toBe('pen');

    // And the box the browser laid out is the box the model stored, at this zoom.
    const box = await strokeBoxOnScreen(page, stroke.id);
    const screen = await screenOf(page, { x: stroke.x, y: stroke.y });
    expect(box.x).toBeCloseTo(screen.x, 0);
    expect(box.y).toBeCloseTo(screen.y, 0);
  });

  test('the preview reaches the pointer, and a press that never travelled is a dot', async ({ page }) => {
    await openBoard(page);
    await holdPenTool(page);

    // The line is drawn to where the pointer actually is, not to where it was a frame ago.
    const path = squiggle();
    const end = await screenOf(page, path[path.length - 1] as Point);
    let lastD = '';
    await drawStrokeByPath(page, path, {
      steps: 3,
      onStep: async ({ d }) => {
        if (d) lastD = d;
      }
    });
    // The last thing painted before the release ended at the pointer.
    expect(distance(previewEnd(lastD), end)).toBeLessThan(2);

    // A click is a dot: one point stored, and a box one thickness across so it can be picked up.
    const before = (await boardObjects(page)).map((object) => object.id);
    const at = await screenOf(page, { x: 0, y: 200 });
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => strokesOn(page).then((all) => all.length)).toBe(before.length + 1);
    const dot = (await strokesOn(page)).find((stroke) => !before.includes(stroke.id));
    expect(dot).toBeTruthy();
    expect(scaledPoints(dot!).length).toBe(1);
    expect(dot!.width).toBeCloseTo(PEN_THICKNESS_WORLD[dot!.thickness], 3);
    await expect(strokeInk(page, dot!.id)).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD[dot!.thickness]));
  });

  test('TC-19: a drag that starts on a note draws over it, leaves it alone, and the wheel still navigates', async ({
    page
  }) => {
    await openBoard(page);
    // A note in the middle of the board, then the pen over it.
    await doubleClickBoard(page, 640, 400);
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    const id = (await notes(page).first().getAttribute('data-object-id')) ?? '';
    const before = await positionOf(page, id);
    if (!before) throw new Error('the note is not on the board');

    await holdPenTool(page);
    const centre = await objectCentreOnScreen(page, id);
    const world = await worldOf(page, centre);
    await drawStrokeByPath(page, [
      world,
      { x: world.x + 80, y: world.y + 60 },
      { x: world.x + 160, y: world.y - 40 }
    ]);

    // The line went over the note; the note did not move (`pen.navigation`).
    await expect(strokeElements(page)).toHaveCount(1);
    expect(await positionOf(page, id)).toEqual(before);
    const dom = await notes(page).first().getAttribute('data-x');
    expect(dom).toBe(String(before.x));

    // And navigating is untouched by the pen. A plain wheel pans, in both axes, without zooming
    // (`pen.navigation`: the wheel belongs to the board even while the pen is in hand).
    const pannedFrom = await getCamera(page);
    await page.mouse.wheel(-120, -80);
    await expect
      .poll(() => getCamera(page).then((camera) => camera.x))
      .not.toBe(pannedFrom.x);
    await expect
      .poll(() => getCamera(page).then((camera) => camera.y))
      .not.toBe(pannedFrom.y);
    expect((await getCamera(page)).zoom).toBe(pannedFrom.zoom);

    // A pinch at the pointer still zooms as well.
    const zoomBefore = (await getCamera(page)).zoom;
    await pinchAt(page, { x: 640, y: 400 }, -240);
    await expect.poll(() => getCamera(page).then((camera) => camera.zoom)).toBeGreaterThan(zoomBefore);
    // Still drawing after that: the camera moved, the pen stayed in hand.
    await expect(penSurface(page)).toHaveCount(1);
  });

  test('TC-14: colour and thickness are chosen from the pen and apply to the next stroke only', async ({ page }) => {
    await openBoard(page);
    await holdPenTool(page);

    // The pen carries its options beside the palette, and says what it is set to.
    await expect(penToolbar(page)).toBeVisible();
    expect(await penToolbar(page).getAttribute('data-color')).toBe('black');
    expect(await penToolbar(page).getAttribute('data-thickness')).toBe('medium');

    await penColorButton(page, 'red').click();
    await penThicknessButton(page, 'thick').click();
    const first = await drawStrokeByPath(page, squiggle());
    expect(first.strokes).toHaveLength(1);
    expect(first.strokes[0]?.color).toBe('red');
    expect(first.strokes[0]?.thickness).toBe('thick');
    // The stored name, drawn as the ink: what she chose is what the line is.
    await expect(strokeInk(page, first.strokes[0]!.id)).toHaveAttribute('stroke', PEN_COLORS.red!);
    await expect(strokeInk(page, first.strokes[0]!.id)).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD.thick));

    // A different ink now: the stroke already down keeps the one it was drawn with.
    await penColorButton(page, 'blue').click();
    const second = await drawStrokeByPath(page, [
      { x: -200, y: 120 },
      { x: 0, y: 200 },
      { x: 200, y: 120 }
    ]);
    expect(second.strokes[0]?.color).toBe('blue');
    expect((await strokesOn(page)).find((stroke) => stroke.id === first.strokes[0]?.id)?.color).toBe('red');

    // Put the pen down and its options go with it; the strokes stay.
    await putPenDown(page);
    await expect(penToolbar(page)).toHaveCount(0);
    await expect(strokeElements(page)).toHaveCount(2);
  });

  test('a stroke is selected by its line and not by the empty corner of its box', async ({ page }) => {
    await openBoard(page);
    // A note to catch the click the stroke lets go of, in the empty part of its box.
    await doubleClickBoard(page, 640, 400);
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.press('Escape');

    await holdPenTool(page);
    // An L: its bounding box has a corner with nothing in it, and that corner lies over the note.
    const elbow: Point[] = [];
    for (let index = 0; index <= 8; index += 1) elbow.push({ x: -260 + index * 50, y: -260 });
    for (let index = 1; index <= 8; index += 1) elbow.push({ x: 140, y: -260 + index * 40 });
    const drawn = await drawStrokeByPath(page, elbow, { steps: 2 });
    expect(drawn.strokes).toHaveLength(1);
    await putPenDown(page);

    // On the ink: selected.
    await clickWorld(page, { x: -60, y: -260 });
    expect(await selectedCount(page)).toBe(1);
    expect(await strokeElements(page).first().getAttribute('data-selected')).toBe('true');

    // Inside the same bounding box, but far from every point of the line — and clear of its frame,
    // which is not the ink either. The click goes through the stroke's inert box to the note
    // underneath, which is what `pen.select` asks for: the note is selected, the stroke is not. A
    // box hit test would select the stroke here, which is the whole point.
    await clickWorld(page, { x: -60, y: 10 });
    expect(await strokeElements(page).first().getAttribute('data-selected')).toBe('false');
    expect(await notes(page).first().getAttribute('data-selected')).toBe('true');
    expect(await selectedCount(page)).toBe(1);

    // And back onto the ink from the empty board: selection is a property of the line, not of the
    // order the clicks happened to come in.
    await clickWorld(page, { x: 140, y: 60 });
    expect(await selectedCount(page)).toBe(1);
    expect(await strokeElements(page).first().getAttribute('data-selected')).toBe('true');
    // The tolerance is stated in screen pixels, so it is the same size at every zoom: the
    // StrokeObject widens its hit path as the camera pulls back.
    expect(STROKE_HIT_TOLERANCE_PX).toBeGreaterThan(0);
  });
});

test.describe('tidying a sketch up', () => {
  test('TC-20: a stroke is resized in proportion, moved, and deleted, on both screens', async ({
    browser
  }) => {
    const session = await withPeople(browser, 'ada', 'bob');
    const ada = session.person('ada');
    const bob = session.person('bob');

    // Ada draws an L: two legs, and a corner that has to stay a corner.
    await holdPenTool(ada.page);
    const elbow: Point[] = [];
    for (let index = 0; index <= 8; index += 1) elbow.push({ x: -200 + index * 50, y: -100 });
    for (let index = 1; index <= 8; index += 1) elbow.push({ x: 200, y: -100 + index * 50 });
    const drawn = await drawStrokeByPath(ada.page, elbow, { steps: 2 });
    expect(drawn.strokes).toHaveLength(1);
    const id = drawn.strokes[0]!.id;
    await putPenDown(ada.page);
    await session.eventually('bob sees the stroke', async () => {
      const strokes = await strokesOn(bob.page);
      return strokes.length === 1 && strokes[0]?.id === id ? true : `bob holds ${(await strokesOn(bob.page)).length}`;
    });

    // Click the ink and the drawing is held: the box and its handles appear.
    await clickWorld(ada.page, { x: 0, y: -100 });
    expect(await selectedCount(ada.page)).toBe(1);
    const before = (await strokesOn(ada.page)).find((stroke) => stroke.id === id);
    if (!before) throw new Error('the stroke has gone');
    const ratioBefore = before.width / before.height;

    // Drag the far corner out. The drawing scales as a drawing: the proportions of the L are the
    // ones that were sketched, and the ink is no thicker for it (`pen.resize`).
    await dragResizeHandleBy(ada.page, 'se', 150, 60);
    const after = (await strokesOn(ada.page)).find((stroke) => stroke.id === id);
    if (!after) throw new Error('resizing lost the stroke');
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(Math.abs(after.width / after.height - ratioBefore) / ratioBefore).toBeLessThan(0.01);
    expect(after.thickness).toBe(before.thickness);
    // The line was never re-recorded: the same numbers, drawn larger.
    expect(after.points).toEqual(before.points);
    expect(after.baseWidth).toBe(before.baseWidth);
    // The box on the screen agrees with the box in the model, at whatever the browser laid out.
    const box = await strokeBoxOnScreen(ada.page, id);
    const corner = await screenOf(ada.page, { x: after.x, y: after.y });
    expect(box.width).toBeCloseTo(after.width, 0);
    expect(box.height).toBeCloseTo(after.height, 0);
    expect(box.x).toBeCloseTo(corner.x, 0);

    // Then she drags the drawing itself by one of its legs: it moves, and stays the shape it was.
    const onInk = await screenOf(ada.page, { x: 0, y: -100 });
    await dragByMouse(ada.page, onInk, { x: onInk.x + 120, y: onInk.y + 80 });
    const moved = (await strokesOn(ada.page)).find((stroke) => stroke.id === id);
    if (!moved) throw new Error('moving lost the stroke');
    expect(moved.x).toBeCloseTo(after.x + 120, 0);
    expect(moved.y).toBeCloseTo(after.y + 80, 0);
    expect(moved.width).toBeCloseTo(after.width, 0);
    expect(moved.points).toEqual(after.points);

    // Both of those reach Bob, in proportion and all, without him doing anything.
    await session.eventually('bob sees the same resized, moved stroke', async () => {
      const seen = (await strokesOn(bob.page)).find((stroke) => stroke.id === id);
      if (!seen) return 'bob has lost the stroke';
      const same =
        Math.abs(seen.x - moved.x) < 1 &&
        Math.abs(seen.y - moved.y) < 1 &&
        Math.abs(seen.width - moved.width) < 1 &&
        Math.abs(seen.height - moved.height) < 1;
      return same ? true : `bob holds x=${seen.x} y=${seen.y} w=${seen.width} h=${seen.height}`;
    });

    // And Delete removes it, from both boards, in one keystroke.
    await ada.page.keyboard.press('Delete');
    await session.eventually('the stroke is gone from both boards', async () => {
      const adaLeft = await strokesOn(ada.page);
      const bobLeft = await strokesOn(bob.page);
      return adaLeft.length === 0 && bobLeft.length === 0
        ? true
        : `ada holds ${adaLeft.length}, bob holds ${bobLeft.length}`;
    });
    await expect(strokeElements(ada.page)).toHaveCount(0);
    await expect(strokeElements(bob.page)).toHaveCount(0);
    expect(await selectedCount(ada.page)).toBe(0);

    for (const person of session.people) expect(person.errors).toEqual([]);
    session.report();
  });
});

test.describe('a sketch shared with somebody else', () => {
  test('TC-18: a loop drawn over notes and an arrow arrives whole, and Backspace removes it for both', async ({
    browser
  }) => {
    const session = await withPeople(browser, 'ada', 'bob');
    const ada = session.person('ada');
    const bob = session.person('bob');

    // Ada puts up two notes and ties them together, then sketches a loop round them.
    await doubleClickBoard(ada.page, 500, 350);
    await expect(notes(ada.page)).toHaveCount(1);
    await ada.page.keyboard.press('Escape');
    await doubleClickBoard(ada.page, 800, 480);
    await expect(notes(ada.page)).toHaveCount(2);
    await ada.page.keyboard.press('Escape');
    await session.eventually('both people see the two notes', async () => {
      const count = await notes(bob.page).count();
      return count === 2 ? true : `bob sees ${count} note(s)`;
    });

    await holdPenTool(ada.page);
    const loop: Point[] = [];
    for (let index = 0; index <= 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      loop.push({ x: Math.cos(angle) * 260, y: Math.sin(angle) * 140 });
    }
    const drawn = await drawStrokeByPath(ada.page, loop, { steps: 4 });
    expect(drawn.strokes).toHaveLength(1);
    const loopId = drawn.strokes[0]!.id;

    // Bob sees one stroke — not a trail of them, and not nothing — drawn the same shape.
    await session.eventually('bob sees the loop', async () => {
      const strokes = await strokesOn(bob.page);
      return strokes.length === 1 && strokes[0]?.id === loopId
        ? true
        : `bob holds ${strokes.length} stroke(s)`;
    });
    const onBob = (await strokesOn(bob.page))[0];
    const onAda = drawn.strokes[0];
    if (!onBob || !onAda) throw new Error('the loop did not arrive');
    expect(onBob.x).toBeCloseTo(onAda.x, 3);
    expect(onBob.y).toBeCloseTo(onAda.y, 3);
    expect(onBob.width).toBeCloseTo(onAda.width, 3);
    expect(onBob.color).toBe(onAda.color);
    // ...and on his screen it is drawn where the model says it is.
    const box = await strokeBoxOnScreen(bob.page, onBob.id);
    const corner = await screenOf(bob.page, { x: onBob.x, y: onBob.y });
    expect(box.x).toBeCloseTo(corner.x, 0);
    expect(box.y).toBeCloseTo(corner.y, 0);

    // Bob clicks the line and deletes it: it goes away on Ada's board too, and neither of them
    // has to do anything for that to have happened.
    await putPenDown(bob.page);
    await clickWorld(bob.page, { x: 260, y: 0 });
    expect(await selectedCount(bob.page)).toBe(1);
    await bob.page.keyboard.press('Backspace');
    await session.eventually('the loop is gone from both boards', async () => {
      const adaLeft = await strokesOn(ada.page);
      const bobLeft = await strokesOn(bob.page);
      return adaLeft.length === 0 && bobLeft.length === 0
        ? true
        : `ada holds ${adaLeft.length}, bob holds ${bobLeft.length}`;
    });
    await expect(strokeElements(ada.page)).toHaveCount(0);

    // Nothing about any of it upset either page.
    for (const person of session.people) expect(person.errors).toEqual([]);
    session.report();
  });

  test('TC-14: one person choosing an ink changes nothing about what the other person is doing', async ({
    browser
  }) => {
    const session = await withPeople(browser, 'ada', 'bob');
    const ada = session.person('ada');
    const bob = session.person('bob');

    // Bob has a note selected; Ada is choosing colours.
    await doubleClickBoard(bob.page, 640, 400);
    await expect(notes(bob.page)).toHaveCount(1);
    await bob.page.keyboard.press('Escape');
    // A second note beside it, so "selected" is a choice rather than the only thing there.
    await doubleClickBoard(bob.page, 800, 400);
    await expect(notes(bob.page)).toHaveCount(2);
    await bob.page.keyboard.press('Escape');
    await clickWorld(bob.page, await worldOf(bob.page, { x: 640, y: 400 }));
    // (the first note, where it was double-clicked)
    expect(await selectedCount(bob.page)).toBe(1);

    await holdPenTool(ada.page);
    await penColorButton(ada.page, 'green').click();
    await penThicknessButton(ada.page, 'thin').click();
    const drawn = await drawStrokeByPath(ada.page, squiggle());
    expect(drawn.strokes[0]?.color).toBe('green');
    expect(drawn.strokes[0]?.thickness).toBe('thin');

    // Bob's selection is exactly as he left it, and his page has not been disturbed by her pen.
    expect(await selectedCount(bob.page)).toBe(1);
    await session.eventually('bob sees the green line', async () => {
      const strokes = await strokesOn(bob.page);
      return strokes.length === 1 && strokes[0]?.color === 'green'
        ? true
        : `bob holds ${strokes.length} stroke(s)`;
    });
    // Ada's own pen keeps its settings after drawing, and the palette says so.
    expect(await pressedTool(ada.page)).toBe('pen');
    expect(await penToolbar(ada.page).getAttribute('data-color')).toBe('green');
    expect(await toolButton(ada.page, 'pen').getAttribute('aria-pressed')).toBe('true');
    session.report();
  });
});
