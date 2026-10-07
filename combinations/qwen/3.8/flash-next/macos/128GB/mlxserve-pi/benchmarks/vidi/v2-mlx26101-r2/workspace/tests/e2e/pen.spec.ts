/**
 * Story 11 in a real browser: draw with a pen, and the line is where the hand went.
 *
 * The unit file has the arithmetic (the trail, the simplifier, the hit test) and the jsdom
 * file has the tool's state machine. Both of them simulate the pointer, and three things in
 * this story only exist once a real pointer, a real renderer and a real room are running:
 *
 * - The preview. It is painted on this screen alone, updated as the pointer moves, and
 *   thrown away on release. Whether it changes *every frame* is a question about
 *   `requestAnimationFrame` and the compositor, not about React's event system, so it is
 *   measured here by sampling the live document from inside the page while a real mouse is
 *   dragged through a recorded path.
 * - The sharing. A colleague must see nothing while you draw and the finished drawing
 *   afterwards, which is a statement about what crosses the wire and when.
 * - The hit test at the pixel level. jsdom does no geometry: only a browser knows whether a
 *   click on a thin line lands on the line, or on the note underneath the loop the line
 *   makes.
 *
 * Three rules hold through this file, and they are the rules the rest of the suite uses.
 *
 * Screen pixels and board units are compared through the page's live camera, never through
 * a number written down here. The board opens with the origin in the middle of the window at
 * 100 %, and every assertion still goes through `screenOf`/`worldOf`, because a test that
 * assumes the camera is a test that can pass while the camera is somewhere else.
 *
 * Where a drawing *is* is where it is *painted*. The stored box includes the half-pen of
 * padding every stroke carries, so the box is not where the ink is; the ink is measured from
 * the rendered path, and only then compared with the mouse.
 *
 * How long a stroke took to reach a colleague is printed and never asserted. Either it
 * arrives or it does not; the milliseconds are a fact about this machine.
 */

import { expect, test } from './fixtures.js';

import {
  cameraState,
  expectNear,
  openBoard,
  setCamera,
  wheel,
  waitForRender,
  zoomLabel,
} from './helpers/board.js';
import {
  dragBy,
  dragHandle,
  pressDelete,
  seedStickyAt,
  selectedNoteIds,
} from './helpers/select.js';
import { noteById, noteBox, waitForNoteCount } from './helpers/sticky.js';
import {
  closeParticipants,
  expectSameBoard,
  measureChange,
  openParticipants,
  person,
  printLatencyReport,
  type Participant,
} from './helpers/participants.js';
import {
  choosePenColor,
  choosePenThickness,
  docStrokes,
  drawStroke,
  enterPenTool,
  expectPenStillInHand,
  handleCount,
  loopPath,
  penColorButton,
  penCursor,
  penPreview,
  penSurface,
  penToolbar,
  penToolButton,
  pressPenLetter,
  pressStrokeLine,
  pressedPenOptions,
  putPenAway,
  selectedIds,
  strokeAt,
  strokeById,
  strokeElements,
  strokeInkBox,
  strokeInkCommands,
  strokeInkStyle,
  strokeHitWidth,
  strokeOf,
  strokePointOnScreen,
  strokeScreenBox,
  strokeTrailBox,
  waitForStrokeCount,
  worldOf,
  zigzagPath,
  type ScreenBox,
} from './helpers/stroke.js';
import { circle, pathBounds, scribble } from '../fixtures/pen-paths.js';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config.js';

/**
 * Watch this page's pen preview from inside the page, so the evidence is what the renderer
 * did rather than what a test happened to ask at the moment it happened to look.
 *
 * Two observers, because they answer two different questions. The `MutationObserver` counts
 * every change of the preview's `d`: that is how often the line was repainted during one
 * drag. The `requestAnimationFrame` sample records what was on the screen at each frame:
 * that is whether the preview was being rewritten *on frames*, which is the design's claim
 * about the preview and the thing a simulation cannot fake.
 */
async function startPreviewWatch(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const board = window as unknown as {
      __penMutations?: number;
      __penFrames?: (string | null)[];
      __penObserver?: MutationObserver;
    };
    board.__penMutations = 0;
    board.__penFrames = [];
    const surface = document.querySelector('[data-testid="pen-tool-surface"]');
    if (surface === null) throw new Error('the pen is not in hand, so there is nothing to watch');
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'd') board.__penMutations = (board.__penMutations ?? 0) + 1;
      }
      // A preview that appears and disappears is a change of the subtree, and counts too:
      // the first point of a stroke is a repaint like any other.
      board.__penMutations = (board.__penMutations ?? 0) + records.filter((r) => r.addedNodes.length > 0).length;
    });
    observer.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['d'] });
    board.__penObserver = observer;
    const frame = (): void => {
      const preview = document.querySelector('[data-testid="pen-preview"]');
      board.__penFrames?.push(preview === null ? null : preview.getAttribute('d'));
      if ((board.__penFrames?.length ?? 0) < 5000) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** What the watch saw: how many repaints, and how many distinct lines were on the screen. */
async function previewWatch(page: import('@playwright/test').Page): Promise<{
  mutations: number;
  frames: number;
  lines: number;
  emptyFrames: number;
}> {
  return page.evaluate(() => {
    const board = window as unknown as {
      __penMutations?: number;
      __penFrames?: (string | null)[];
      __penObserver?: MutationObserver;
    };
    board.__penObserver?.disconnect();
    const frames = board.__penFrames ?? [];
    const drawn = frames.filter((value): value is string => value !== null);
    return {
      mutations: board.__penMutations ?? 0,
      frames: frames.length,
      lines: new Set(drawn).size,
      emptyFrames: frames.length - drawn.length,
    };
  });
}

/** The box of a screen path, which is the shape of the drag a person made. */
const dragBox = (path: readonly { x: number; y: number }[]): ScreenBox => {
  const box = pathBounds(path as { x: number; y: number }[]);
  return box;
};

const ratio = (box: ScreenBox): number => box.width / box.height;

test.describe('pen.tool: drawing a stroke in a browser', () => {
  test('TC-17 draws a loop with a real mouse, and the line that is painted is the line the mouse drew', async ({
    page,
  }) => {
    await openBoard(page);
    await enterPenTool(page);

    // The preview is the pen's own: a line, and a ring at the tip of it.
    await expect(penPreview(page)).toHaveCount(0);
    await startPreviewWatch(page);

    const start = circle[0]!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // One mouse move per recorded point, and no interpolation between them: the recording is
    // the shape, and a drag that steps from one recorded point to another over an arc draws a
    // chord and then wonders where the edge of the circle went.
    for (const point of circle.slice(1, 41)) await page.mouse.move(point.x, point.y);
    // Part way along, with the button still down: there is a preview, and the document holds
    // nothing at all - a drawing in progress is not board content.
    await expect(penPreview(page)).toHaveCount(1);
    await expect(penCursor(page)).toHaveCount(1);
    expect(await docStrokes(page)).toHaveLength(0);
    const middle = await penPreview(page).getAttribute('d');

    for (const point of circle.slice(41, 81)) await page.mouse.move(point.x, point.y);
    const later = await penPreview(page).getAttribute('d');
    expect(later).not.toBe(middle);
    expect(await docStrokes(page)).toHaveLength(0);

    // The rest of the recording, and then the hand lets go. All of it, because a drawing is
    // measured against the whole path: leave out the last third of a circle and the shape
    // that comes back has a bite out of it, which is a fact about the test and not about
    // the pen.
    for (const point of circle.slice(81)) await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await waitForStrokeCount(page, 1);

    // The watch was running through all of that: the preview was rewritten many times in
    // one drag, and on more than one frame - which is what "updated every frame" means when
    // it is measured instead of asserted.
    const watch = await previewWatch(page);
    expect(watch.mutations).toBeGreaterThan(10);
    expect(watch.lines).toBeGreaterThan(5);
    expect(watch.emptyFrames).toBeGreaterThan(0);
    expect(watch.frames).toBeGreaterThan(watch.lines);

    // The preview is gone, the pen is still in hand, and the stroke is on the board.
    await expect(penPreview(page)).toHaveCount(0);
    await expectPenStillInHand(page);
    const stroke = await strokeAt(page, 0);

    // Where the ink is painted is where the mouse went: the same box in CSS pixels, as the
    // recorded path describes it. The simplifier may have taken points away, but it is not
    // allowed to move the line more than its tolerance, so the box agrees to a few pixels.
    const painted = await strokeInkBox(page, stroke.id);
    const drawn = dragBox(circle);
    expectNear(painted.x, drawn.x, 4, 'the drawing starts where the mouse started, sideways');
    expectNear(painted.y, drawn.y, 4, 'the drawing starts where the mouse started, up and down');
    expectNear(painted.width, drawn.width, 4, 'the drawing is as wide as the hand that drew it');
    expectNear(painted.height, drawn.height, 4, 'the drawing is as tall as the hand that drew it');

    // And the document holds the same drawing in board units: the trail it stored, put back
    // where the ink is painted, at this page's zoom - which is what the camera is for.
    const corner = await worldOf(page, { x: painted.x, y: painted.y });
    const stored = await strokeTrailBox(page, stroke.id);
    expectNear(stored.x + stroke.x, corner.x, 0.6, 'the stored trail is where the ink is painted');
    expectNear(stored.y + stroke.y, corner.y, 0.6, 'the stored trail is where the ink is painted');

    // A circle is a round thing: the path that draws it has one command per point of the
    // trail, so a stroke that had been reduced to a straight line would fail here.
    expect(await strokeInkCommands(page, stroke.id)).toBeGreaterThan(10);
    expect(stroke.points.length / 2).toBeGreaterThan(10);
    expect(stroke.points.length).toBeLessThan(circle.length);
  });

  test('TC-17b keeps the ink where the mouse went at 200 %, and the click tolerance with it', async ({
    page,
  }) => {
    await openBoard(page);

    // Zoom first, with the navigation the board already has, and then draw: the same drag of
    // the same hand is half as big on the board, which is the only way a drawing tool can be
    // wrong about the zoom without anyone noticing.
    const view = await cameraState(page);
    await setCamera(page, { ...view, zoom: 2 });
    await expect(zoomLabel(page)).toHaveText('200%');
    const zoom = (await cameraState(page)).zoom;
    expectNear(zoom, 2, 0.001, 'the board is at 200%');

    await enterPenTool(page);
    // A loop sampled finely, rather than a zigzag sampled coarsely. The line is drawn as a
    // curve *through* the stored points, so the corners of a zigzag are rounded off and what
    // is painted is a few pixels short of what was dragged - a fact about curves in general and
    // about no zoom in particular. A round shape with a point every six degrees has no corner
    // for a curve to round, which is what lets this test measure the ink against the mouse.
    const path = loopPath({ x: 640, y: 400 }, 150, 60, 0);
    const stroke = await drawStroke(page, path);

    // On the screen, the drag and the ink are the same size: the zoom does not shrink what a
    // person sees them both as.
    const painted = await strokeInkBox(page, stroke.id);
    const drawn = dragBox(path);
    expectNear(painted.width, drawn.width, 4, 'the ink is as wide as the drag, on the screen');
    expectNear(painted.height, drawn.height, 4, 'the ink is as tall as the drag, on the screen');

    // On the board, it is half: a screen pixel is half a board unit at 200%. The trail is also
    // shorter than the drag was, because the simplifier's tolerance is a screen distance
    // whatever the zoom: at 200 % it is entitled to take away more of a round shape's points
    // than it is at 100 %, which is the design's reason for measuring the tolerance there.
    expect(stroke.points.length / 2).toBeLessThan(path.length);

    // On the board, it is half: a screen pixel is half a board unit at 200%.
    const stored = await strokeTrailBox(page, stroke.id);
    expectNear(stored.width, drawn.width / zoom, 1.5, 'the trail is in board units, not screen pixels');
    expectNear(stored.height, drawn.height / zoom, 1.5, 'the trail is in board units, not screen pixels');

    // The tolerance is six *screen* pixels: as wide as the ink here, and in board units half
    // of what it was at 100%, which is how the same rule is the same distance at every zoom.
    expectNear((await strokeHitWidth(page, stroke.id)) * zoom, 12, 0.5, 'the clickable line is six screen pixels wide on each side');

    // The pen is still the pen after all of that, and the stroke is the only thing there is.
    await expectPenStillInHand(page);
    expect(await docStrokes(page)).toHaveLength(1);
  });

  test('TC-19 lets the board be moved about while the pen is in hand, and takes nothing with it', async ({
    page,
  }) => {
    await openBoard(page);

    // Somebody's note, in the middle of the board: the thing a pen is likely to be dragged
    // across, and the thing that must not move when it is.
    const [note] = await seedStickyAt(page, [{ x: 640, y: 420 }]);
    if (note === undefined) throw new Error('the fixture note was not created');
    await waitForNoteCount(page, 1);
    const before = await noteById(page, note);

    await enterPenTool(page);

    // The wheel still moves the board, pen and all. This is the pan the design insists on:
    // a drawing tool that swallowed the wheel would trap a person in the part of the board
    // they can already see.
    const cameraBefore = await cameraState(page);
    await wheel(page, { x: 640, y: 400 }, -200);
    const cameraAfterWheel = await cameraState(page);
    expect(cameraAfterWheel.y).not.toBe(cameraBefore.y);
    await expect(penSurface(page)).toHaveCount(1);

    // A drag that starts on the note. The pen answers it, so the note is never told the
    // pointer went down: it stays where it was, unselected, and a stroke appears instead.
    const centre = await page.evaluate((id) => {
      const element = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
      if (element === null) throw new Error(`note ${id} is not on the screen`);
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    }, note);
    const cameraBeforeDrag = await cameraState(page);
    const stroke = await drawStroke(page, [
      centre,
      { x: centre.x + 60, y: centre.y - 40 },
      { x: centre.x + 130, y: centre.y + 10 },
    ]);

    const cameraAfterDrag = await cameraState(page);
    expectNear(cameraAfterDrag.x, cameraBeforeDrag.x, 0.001, 'drawing did not pan the board');
    expectNear(cameraAfterDrag.y, cameraBeforeDrag.y, 0.001, 'drawing did not pan the board');
    expectNear(cameraAfterDrag.zoom, cameraBeforeDrag.zoom, 0.001, 'drawing did not zoom the board');

    const after = await noteById(page, note);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(await selectedNoteIds(page)).toHaveLength(0);
    expect(await selectedIds(page)).toHaveLength(0);

    // The stroke went over the note and is above it, which is what it means to annotate:
    // a drawing that slipped behind the thing it was drawn on is a drawing nobody sees.
    expect(stroke.z).toBeGreaterThan(after.z);
    const painted = await strokeInkBox(page, stroke.id);
    const box = await noteBox(page, 0);
    expect(painted.x + painted.width / 2).toBeGreaterThan(box.x);
    expect(painted.x + painted.width / 2).toBeLessThan(box.x + box.width);

    // And the pen is still in hand, so the next stroke needs no second click.
    await expectPenStillInHand(page);
  });

  test('TC-19b keeps the pen drawing across the whole board, and the tools out of each other', async ({
    page,
  }) => {
    await openBoard(page);
    await enterPenTool(page);

    // Two strokes, one after the other, without touching the toolbar in between: the pen is
    // a tool you use, not a mode that ends when you have made one thing.
    const first = await drawStroke(page, zigzagPath({ x: 300, y: 260 }, 220, 60, 3));
    await expectPenStillInHand(page);
    const second = await drawStroke(page, loopPath({ x: 800, y: 520 }, 90));
    expect(await docStrokes(page)).toHaveLength(2);
    expect(second.z).toBeGreaterThan(first.z);

    // Escape puts the pen away; the strokes stay, and are still strokes.
    await putPenAway(page);
    await expect(strokeElements(page)).toHaveCount(2);
    await expect(penToolbar(page)).toHaveCount(0);

    // Escape again, on a board with nothing selected, is not a selection or a deletion.
    await page.keyboard.press('Escape');
    expect(await docStrokes(page)).toHaveLength(2);
    expect(await selectedIds(page)).toHaveLength(0);

    // The letter takes the pen back up, and the choices it was left with are still its
    // choices: a pen that forgot its ink between strokes would be a pen to be avoided.
    await pressPenLetter(page);
    await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(penToolbar(page)).toHaveCount(1);
    const options = await pressedPenOptions(page);
    expect(options.color).toBe(DEFAULT_PEN_COLOR);
    expect(options.thickness).toBe(DEFAULT_PEN_THICKNESS);
  });

  test('TC-17c holds the pen to its own ink and width, in the document and on the screen', async ({
    page,
  }) => {
    await openBoard(page);
    await enterPenTool(page);

    // The option bar offers the inks and the widths, one pressed at the start, and the
    // board remembers which one was chosen without a single stroke being drawn.
    await expect(penToolbar(page)).toHaveCount(1);
    await choosePenColor(page, 'purple');
    await choosePenThickness(page, 'thick');
    await putPenAway(page);
    await enterPenTool(page);
    const kept = await pressedPenOptions(page);
    expect(kept.color).toBe('purple');
    expect(kept.thickness).toBe('thick');

    const stroke = await drawStroke(page, zigzagPath({ x: 380, y: 380 }, 300, 70, 3));

    // In the document, the ink and the pen are named, not guessed at.
    expect(stroke.color).toBe('purple');
    expect(stroke.thickness).toBe('thick');

    // On the screen, the line is drawn in that ink and at that width - in board units, so
    // the zoom has nothing to do with how thick a line a person drew with a thick pen.
    const ink = await strokeInkStyle(page, stroke.id);
    expectNear(ink.width, PEN_THICKNESS_WORLD.thick, 0.01, 'the ink is as wide as the pen chosen');
    expect(ink.stroke).toBe(PEN_COLORS.purple.toLowerCase());

    // A different pen for the next stroke, and the first is not retroactively rewritten.
    await choosePenThickness(page, 'thin');
    const next = await drawStroke(page, zigzagPath({ x: 380, y: 520 }, 300, 70, 3));
    expect(next.thickness).toBe('thin');
    expect((await strokeById(page, stroke.id)).thickness).toBe('thick');
    expectNear((await strokeInkStyle(page, stroke.id)).width, PEN_THICKNESS_WORLD.thick, 0.01);
    expectNear((await strokeInkStyle(page, next.id)).width, PEN_THICKNESS_WORLD.thin, 0.01);
    // Every stroke so far was drawn with a chosen pen, so this page holds no default stroke;
    // what a stroke looks like when nobody chose anything is TC-19b's business, where the pen
    // is taken up cold. What belongs here is that choosing is not retroactive: the two
    // drawings keep their own pens, and both are still on the board.
    const onTheBoard = await docStrokes(page);
    expect(onTheBoard.map((entry) => entry.thickness)).toEqual(['thick', 'thin']);
    expect(onTheBoard.every((entry) => entry.color === 'purple')).toBe(true);
  });
});

test.describe('pen.tool: a stroke a colleague can see', () => {
  let people: Participant[] = [];

  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test('TC-18 shows a colleague nothing while the pen is down, and the finished stroke afterwards', async ({
    browser,
  }) => {
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const priya = person(people, 'Priya');
    const sam = person(people, 'Sam');
    await expectSameBoard(people);

    await enterPenTool(priya.page);

    // Priya is halfway through a loop. On her screen there is a line; on Sam's there is
    // nothing - no stroke in his document, no element drawn for it, and nothing that looks
    // like somebody's unfinished drawing.
    const start = scribble[0]!;
    await priya.page.mouse.move(start.x, start.y);
    await priya.page.mouse.down();
    for (const point of scribble.slice(1, 61)) await priya.page.mouse.move(point.x, point.y);
    await expect(penPreview(priya.page)).toHaveCount(1);
    expect(await docStrokes(sam.page)).toHaveLength(0);
    expect(await strokeElements(sam.page).count()).toBe(0);

    for (const point of scribble.slice(61, 121)) await priya.page.mouse.move(point.x, point.y);
    expect(await docStrokes(sam.page)).toHaveLength(0);

    // The release is the moment the drawing becomes board content, and the moment Sam's
    // screen hears about it. How long that took is printed for the design's budget and not
    // judged by it: either it arrives or it does not.
    const waited = await measureChange(
      'TC-18 a finished stroke reaches a colleague',
      async () => {
        for (const point of scribble.slice(121)) await priya.page.mouse.move(point.x, point.y);
        await priya.page.mouse.up();
        await waitForRender(priya.page);
      },
      async () => (await docStrokes(sam.page)).length === 1,
    );
    printLatencyReport('TC-18 stroke delivery', [waited]);

    const finished = await strokeAt(priya.page, 0);

    await expect(strokeElements(sam.page)).toHaveCount(1);
    // What Sam is shown is the drawing, not a description of it: the same trail, the same
    // ink, the same pen, the same box - because it was simplified once, on Priya's screen,
    // and everybody else is looking at what that produced.
    const his = await strokeById(sam.page, finished.id);
    expect(his.points).toEqual(finished.points);
    expect(his.color).toBe(finished.color);
    expect(his.thickness).toBe(finished.thickness);
    expectNear(his.x, finished.x, 0.001, 'the same box');
    expectNear(his.y, finished.y, 0.001, 'the same box');

    // And it is drawn where it is stored, on his screen too - the same board units, the same
    // camera, so the same pixels.
    const onHerScreen = await strokeInkBox(priya.page, finished.id);
    const onHisScreen = await strokeInkBox(sam.page, finished.id);
    expectNear(onHisScreen.x, onHerScreen.x, 1, 'a stroke is drawn in the same place on every screen');
    expectNear(onHisScreen.width, onHerScreen.width, 1, 'a stroke is as big on every screen');

    // Nothing of the pen itself came across: Sam has no preview, no cursor ring and no pen
    // in hand, because the pen is Priya's.
    await expect(strokeElements(sam.page).first().locator('[data-testid="pen-preview"]')).toHaveCount(0);
    expect(await penPreview(sam.page).count()).toBe(0);
    expect(await penToolButton(sam.page).getAttribute('aria-pressed')).toBe('false');
  });

  test('TC-18b lets two people draw on the same board, and each keeps their own pen', async ({
    browser,
  }) => {
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const priya = person(people, 'Priya');
    const sam = person(people, 'Sam');

    await choosePenColorOn(priya, 'blue');
    await choosePenColorOn(sam, 'red');
    const hers = await drawStroke(priya.page, loopPath({ x: 460, y: 330 }, 110));
    await waitForStrokeCount(sam.page, 1);
    const his = await drawStroke(sam.page, loopPath({ x: 800, y: 470 }, 110));
    await waitForStrokeCount(priya.page, 2);

    // Two drawings, in two inks, both on both screens, and neither person's tool changed by
    // what the other one did.
    expect(hers.color).toBe('blue');
    expect(his.color).toBe('red');
    for (const participant of people) {
      const strokes = await docStrokes(participant.page);
      expect(strokes.map((stroke) => stroke.color).sort()).toEqual(['blue', 'red']);
      await expect(strokeElements(participant.page)).toHaveCount(2);
    }
    await expect(penColorButton(priya.page, 'blue')).toHaveAttribute('aria-pressed', 'true');
    await expect(penColorButton(sam.page, 'red')).toHaveAttribute('aria-pressed', 'true');

    // The order they arrived in is the order they are drawn in, on both screens: the newest
    // drawing is on top of the oldest one, which is what a stack of drawings is.
    for (const participant of people) {
      const strokes = await docStrokes(participant.page);
      const byId = new Map(strokes.map((stroke) => [stroke.id, stroke] as const));
      const first = byId.get(hers.id);
      const second = byId.get(his.id);
      if (first === undefined || second === undefined) throw new Error('a drawing went missing');
      expect(second.z > first.z).toBe(true);
    }
  });
});

test.describe('stroke.object: tidying a drawing up in a browser', () => {
  test('TC-20 selects a stroke by its line, resizes it in proportion, moves it and deletes it', async ({
    page,
  }) => {
    await openBoard(page);

    // A drawing wide enough that its middle is empty, which is the shape that makes a
    // stroke different from every object before it.
    await enterPenTool(page);
    const stroke = await drawStroke(page, scribble);
    await putPenAway(page);

    // A click on the line is a click on the drawing. The point is taken from the stored
    // trail and converted by this page's camera, so it is a point of the ink rather than a
    // point of the box.
    await pressStrokeLine(page, stroke.id, 3);
    expect(await selectedIds(page)).toEqual([stroke.id]);
    await expect(strokeOf(page, stroke.id)).toHaveAttribute('data-selected', 'true');

    // A stroke is resizable and its proportions are its own: eight handles, the corners
    // included, because a drawing may be made bigger but not squashed.
    expect(await handleCount(page)).toBe(8);

    const before = await strokeScreenBox(page, stroke.id);
    const beforeInk = await strokeInkBox(page, stroke.id);
    const beforePen = await strokeInkStyle(page, stroke.id);

    // Drag a corner a long way, and not along the diagonal: the only drag that can tell
    // "the box grew" apart from "the drawing grew".
    await dragHandle(page, 'se', { x: 150, y: 40 });
    const resized = await strokeScreenBox(page, stroke.id);
    expectNear(ratio(resized), ratio(before), resized.width * 0.01, 'the drawing kept its proportions');

    // The drawing grew by the same factor as the box, in both directions - and it is measured
    // on the painted line, not in the document. The stored trail is a record of the hand and a
    // resize never rewrites it, which is the other half of this same promise: comparing two
    // numbers out of the document here would be comparing a thing with itself.
    const afterInk = await strokeInkBox(page, stroke.id);
    const scale = resized.width / before.width;
    expect(scale).toBeGreaterThan(1.1);
    expectNear(afterInk.width / beforeInk.width, scale, 0.02, 'the drawing grew with the box');
    expectNear(afterInk.height / beforeInk.height, scale, 0.02, 'the drawing grew with the box');

    // And the pen did not grow with it. The width of the painted line is the pen that was
    // chosen, in board units; a stroke twice the size is the same drawing with the same pen,
    // not the same drawing with a thicker one.
    const afterPen = await strokeInkStyle(page, stroke.id);
    expectNear(afterPen.width, beforePen.width, 0.01, 'resizing a drawing does not thicken the pen');
    expect(afterPen.stroke).toBe(beforePen.stroke);

    // The trail in the document is untouched by all of that: a resize writes two numbers,
    // and the drawing itself is what it always was.
    expect((await strokeById(page, stroke.id)).points).toEqual(stroke.points);

    // Move it: the whole drawing comes with the box, and the drawing is not redrawn.
    const beforeMove = await strokeById(page, stroke.id);
    const movedFrom = await strokePointOnScreen(page, stroke.id, 2);
    await dragBy(page, movedFrom, { x: 90, y: -60 });
    const moved = await strokeById(page, stroke.id);
    const camera = await cameraState(page);
    expectNear(moved.x - beforeMove.x, 90 / camera.zoom, 0.6, 'the drawing moved as far as the mouse did');
    expectNear(moved.y - beforeMove.y, -60 / camera.zoom, 0.6, 'the drawing moved as far as the mouse did');
    expect(moved.points).toEqual(stroke.points);
    expect(moved.width).toBe(beforeMove.width);
    expect(await selectedIds(page)).toEqual([stroke.id]);

    // Two gestures, two undos. The first takes the move back: the drawing is where the resize
    // left it, the same size it was - which is why the size is the number that does *not*
    // change here, and the place is the one that does. The second takes the resize as well, and
    // the drawing is the drawing it was when the pen left the board.
    expect(beforeMove.width).not.toBe(stroke.width);
    await page.keyboard.press('Control+z');
    const afterMoveUndo = await strokeById(page, stroke.id);
    expectNear(afterMoveUndo.x, beforeMove.x, 0.01, 'the move was taken back');
    expectNear(afterMoveUndo.y, beforeMove.y, 0.01, 'the move was taken back');
    expect(afterMoveUndo.width).toBe(beforeMove.width);
    await page.keyboard.press('Control+z');
    const afterResizeUndo = await strokeById(page, stroke.id);
    expect(afterResizeUndo.width).toBe(stroke.width);
    expect(afterResizeUndo.x).toBe(stroke.x);
    expect(afterResizeUndo.points).toEqual(stroke.points);

    // Delete, and it is gone: out of the document and off the screen.
    await pressDelete(page);
    await expect(strokeElements(page)).toHaveCount(0);
    expect(await docStrokes(page)).toHaveLength(0);
    expect(await selectedIds(page)).toHaveLength(0);

    // Undo puts the drawing back, whole: the same trail, back in the same box.
    await page.keyboard.press('Control+z');
    await expect(strokeElements(page)).toHaveCount(1);
    const restored = await strokeById(page, stroke.id);
    expect(restored.points).toEqual(stroke.points);
  });

  test('TC-20b leaves the note inside the loop alone, and takes the loop instead', async ({
    page,
  }) => {
    await openBoard(page);

    // A note, and a loop drawn around it: the box of the drawing covers the note, and holds
    // nothing but the note inside it.
    const [note] = await seedStickyAt(page, [{ x: 640, y: 420 }]);
    if (note === undefined) throw new Error('the fixture note was not created');
    const before = await noteById(page, note);
    const box = await noteBox(page, 0);

    await enterPenTool(page);
    const stroke = await drawStroke(
      page,
      loopPath({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 160),
    );
    // The pen goes back: while it is in hand the board belongs to the pen, and every pointer
    // event is a drawing - which is the other half of TC-19 and would be the answer to a
    // question about hit testing if it were asked with the pen still down.
    await putPenAway(page);

    // The middle of the drawing is a point of the note, and a click there reaches the note:
    // the drawing's box is not the drawing.
    const middle = await worldOf(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(middle.x).toBeGreaterThan(stroke.x);
    expect(middle.x).toBeLessThan(stroke.x + (stroke.width ?? 0));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForRender(page);
    expect(await selectedIds(page)).toEqual([note]);
    expect(await strokeOf(page, stroke.id).getAttribute('data-selected')).toBe('false');
    expect((await noteById(page, note)).x).toBe(before.x);

    // And a click on the line itself, which is nowhere near the middle, takes the drawing -
    // the two clicks are three hundred pixels apart and select two different objects.
    await page.keyboard.press('Escape');
    await pressStrokeLine(page, stroke.id, 6);
    expect(await selectedIds(page)).toEqual([stroke.id]);
  });

  test('TC-20c deletes a drawing on one screen and every other screen, in one step', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, ['Dana', 'Priya']);
    try {
      const dana = person(people, 'Dana');
      const priya = person(people, 'Priya');

      await enterPenTool(dana.page);
      const stroke = await drawStroke(dana.page, loopPath({ x: 640, y: 400 }, 120));
      await waitForStrokeCount(priya.page, 1);

      await putPenAway(dana.page);
      await pressStrokeLine(dana.page, stroke.id, 4);
      expect(await selectedIds(dana.page)).toEqual([stroke.id]);

      // Dana's Delete key, and Priya's screen follows: the same document, the same
      // forgetting.
      const waited = await measureChange(
        'TC-20c a deleted drawing leaves a colleague',
        async () => {
          await pressDelete(dana.page);
          await waitForRender(dana.page);
        },
        async () => (await docStrokes(priya.page)).length === 0,
      );
      printLatencyReport('TC-20c delete delivery', [waited]);
      await expect(strokeElements(priya.page)).toHaveCount(0);
      await expect(strokeElements(dana.page)).toHaveCount(0);

      // Whose undo is an undo? Dana's: her Ctrl+Z brings the drawing back for both of them,
      // because the drawing is in the room and not on her screen.
      const brought = await measureChange(
        'TC-20c an undone drawing returns to a colleague',
        async () => {
          await dana.page.keyboard.press('Control+z');
          await waitForRender(dana.page);
        },
        async () => (await docStrokes(priya.page)).length === 1,
      );
      printLatencyReport('TC-20c undo delivery', [brought]);
      await expect(strokeElements(priya.page)).toHaveCount(1);
      expect((await strokeById(priya.page, stroke.id)).points).toEqual(stroke.points);

      // Priya moving what Dana drew, in her own window: the drawing follows, and Dana sees it
      // go. A drawing is a thing on the board, not a thing the person who drew it owns.
      const movedFrom = await strokePointOnScreen(priya.page, stroke.id, 2);
      const beforeMove = await strokeById(priya.page, stroke.id);
      const moved = await measureChange(
        'TC-20c a moved drawing follows a colleague',
        async () => {
          await dragBy(priya.page, movedFrom, { x: 70, y: 40 });
        },
        async () => (await strokeById(dana.page, stroke.id)).x !== beforeMove.x,
      );
      printLatencyReport('TC-20c move delivery', [moved]);
      const after = await strokeById(dana.page, stroke.id);
      expect(after.points).toEqual(stroke.points);
      expect(after.x).toBeGreaterThan(beforeMove.x);
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('the three things a person does with a pen', () => {
  test('the golden path: annotate a cluster, share the sketch, tidy it up', async ({ browser }) => {
    // Three windows, two drawings, a resize, a delete and their delivery from one screen to
    // two others, all of it driven at arm's length from the browser: the work is hundreds of
    // separate mouse events, and a unit test's budget does not cover the round trips.
    test.setTimeout(150_000);
    const people = await openParticipants(browser, ['Dana', 'Priya', 'Sam']);
    const latencies: number[] = [];
    try {
      const dana = person(people, 'Dana');
      const priya = person(people, 'Priya');
      const sam = person(people, 'Sam');
      await expectSameBoard(people);

      // 1. Annotate a cluster. Notes on the board, and a drawing that goes round one of them:
      // the note is what the drawing is about, so it has to stay exactly where it was.
      const notes = await seedStickyAt(dana.page, [
        { x: 460, y: 320 },
        { x: 700, y: 470 },
      ]);
      await waitForNoteCount(priya.page, 2);
      const cluster = await noteBox(dana.page, 0);
      const beforeDrawing = await noteById(dana.page, notes[0]!);
      await pressPenLetter(dana.page);
      const circleRound = await drawStroke(
        dana.page,
        loopPath({ x: cluster.x + cluster.width / 2, y: cluster.y + cluster.height / 2 }, 150),
      );
      const underline = await drawStroke(
        dana.page,
        zigzagPath({ x: 380, y: 600 }, 340, 30, 6),
      );
      await waitForStrokeCount(sam.page, 2);
      // The drawing went round the note and the note never heard about it: same place, same
      // order in the stack. A pen that moved what it was drawn over would be a pen that
      // cannot be used to annotate anything.
      const afterDrawing = await noteById(dana.page, notes[0]!);
      expect(afterDrawing.x).toBe(beforeDrawing.x);
      expect(afterDrawing.y).toBe(beforeDrawing.y);
      expect(afterDrawing.z).toBe(beforeDrawing.z);
      expect(await selectedIds(dana.page)).toHaveLength(0);

      // 2. The shared sketch. Everybody is looking at the same two drawings, and the marks
      // that made them are where the hands went: the drawing that circles a note has that
      // note's middle inside it, on every screen.
      for (const participant of people) {
        await expect(strokeElements(participant.page)).toHaveCount(2);
      }
      const roundBox = await strokeInkBox(priya.page, circleRound.id);
      const noteBoxOnHisScreen = await noteBox(priya.page, 0);
      expect(roundBox.x).toBeLessThan(noteBoxOnHisScreen.x);
      expect(roundBox.x + roundBox.width).toBeGreaterThan(noteBoxOnHisScreen.x + noteBoxOnHisScreen.width);
      expect(await penPreview(sam.page).count()).toBe(0);

      // Dana's pen goes back into her pocket first: while it is in hand the board is hers to
      // draw on and nothing else, which is exactly what TC-19 is about, and a click for a
      // drawing would be answered as a stroke.
      await putPenAway(dana.page);

      // 3. Tidy up. Priya makes the underline longer - in proportion, with the same pen - and
      // Dana watches it happen in her own window; then Dana deletes the circle and it leaves
      // all three screens, and the note it was drawn round is still there.
      await pressPenLetter(priya.page);
      await putPenAway(priya.page);
      await pressStrokeLine(priya.page, underline.id, 4);
      const before = await strokeById(priya.page, underline.id);
      await dragHandle(priya.page, 'se', { x: 120, y: 20 });
      const grown = await strokeInkBox(priya.page, underline.id);
      expectNear(
        grown.width / grown.height,
        (await strokeInkBox(dana.page, underline.id)).width / (await strokeInkBox(dana.page, underline.id)).height,
        0.02,
        'the drawing keeps its proportions on the screen that drew it and the one that watched',
      );
      latencies.push(
        await measureChange(
          'flow a resized drawing reaches the third screen',
          async () => {
            await waitForRender(priya.page);
          },
          async () => (await strokeById(sam.page, underline.id)).width !== before.width,
        ),
      );

      await pressStrokeLine(dana.page, circleRound.id, 5);
      expect(await selectedIds(dana.page)).toEqual([circleRound.id]);
      latencies.push(
        await measureChange(
          'flow a deleted drawing leaves everybody',
          async () => {
            await pressDelete(dana.page);
            await waitForRender(dana.page);
          },
          async () =>
            (await docStrokes(priya.page)).length === 1 && (await docStrokes(sam.page)).length === 1,
        ),
      );
      for (const participant of people) {
        await expect(strokeElements(participant.page)).toHaveCount(1);
        // The note the circle was drawn round is still on the board: deleting a drawing
        // deletes the drawing, which is the least a board has to get right.
        await expect(participant.page.getByTestId('sticky-note')).toHaveCount(2);
      }
      expect(await docStrokes(sam.page)).toHaveLength(1);
      expect((await strokeById(sam.page, underline.id)).points).toEqual(underline.points);
    } finally {
      printLatencyReport('pen flow', latencies);
      await expectSameBoard(people);
      await closeParticipants(people);
    }
  });
});

/**
 * Choose an ink through the option bar, the way a person does: the toolbar is the pen's
 * settings, and a test that draws in red has usually picked red first.
 */
async function choosePenColorOn(who: Participant, color: string): Promise<void> {
  await enterPenTool(who.page);
  await choosePenColor(who.page, color);
}
