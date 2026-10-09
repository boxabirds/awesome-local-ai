import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { UNDERLINE, loopAt, moved } from '../fixtures/pen-paths';
import {
  boardLink,
  clipboardContext,
  closeParticipants,
  createBoard,
  expectConverged,
  expectNoErrors,
  logLatency,
  participantOf,
  type Participant,
} from './helpers/participants';
import { boardNotes, noteRect, readCamera, settle, waitForCentredBoard } from './helpers/board';
import { createNote, dragHandle } from './helpers/selection';
import {
  clickPenColour,
  clickPenThickness,
  clickPenTool,
  drawStrokeOnBoard,
  holdPenAlong,
  penOptionPressed,
  penSurfaceVisible,
  previewSamples,
  selectStrokeOnBoard,
  selectedStrokeIds,
  startPreviewSampling,
  strokeIn,
  strokeInkPoint,
  strokePainting,
  strokesOn,
  thin,
  toolPressed,
  waitForStrokes,
  type StrokeRecord,
} from './helpers/pen';

/**
 * Story 11 in real browsers: an annotation drawn round a cluster of notes, a sketch one person
 * makes and another waits for, and a stroke tidied up afterwards (TC-17 to TC-20).
 *
 * Two things about these tests are unlike the other stories', and both come from what a pen is.
 * A stroke only enters the document when the pointer leaves the board, so half of what a
 * spectator has to be shown is that there is nothing to see while a person is drawing (TC-18) —
 * and the line a person sees under their own pointer exists only in that browser, sampled here
 * once per animation frame, because "redrawn every frame" is a claim about frames (TC-17).
 *
 * Delivery times are logged against the live budget and never asserted (story 3's rule).
 */

/** Where the recorded paths are drawn, in screen pixels, well clear of the controls. */
const LOOP_AT = { x: 400, y: 200 };
const UNDERLINE_AT = { x: 380, y: 520 };
const LOOP = thin(loopAt(LOOP_AT), 3);
const UNDERLINE_THIN = thin(moved(UNDERLINE, UNDERLINE_AT), 2);

/** One person on a board the service made. */
async function aloneOn(browser: Browser, name: string): Promise<Participant> {
  const link = boardLink(await createBoard(browser));
  const context = await clipboardContext(browser);
  const page = await context.newPage();
  const person = participantOf(name, context, page);
  await page.goto(link);
  await waitForCentredBoard(page);
  return person;
}

/** Two people on one board, by the names the story uses. */
async function twoPeople(
  browser: Browser,
  first: string,
  second: string,
): Promise<{ a: Participant; b: Participant; people: Participant[] }> {
  const link = boardLink(await createBoard(browser));
  const people: Participant[] = [];
  for (const name of [first, second]) {
    const context = await clipboardContext(browser);
    const page = await context.newPage();
    const person = participantOf(name, context, page);
    await page.goto(link);
    await waitForCentredBoard(page);
    people.push(person);
  }
  return { a: people[0] as Participant, b: people[1] as Participant, people };
}

test('TC-17: a loop drawn with the pen is shown as it is drawn and stays on the board', async ({
  browser,
}) => {
  const person = await aloneOn(browser, 'Alex');
  const page = person.page;
  try {
    await clickPenTool(page);
    expect(await penSurfaceVisible(page)).toBe(true);

    // The preview is sampled in the page, once per animation frame, because that is the thing
    // the claim is about: the line under the pointer is redrawn as the hand moves.
    await startPreviewSampling(page);
    await holdPenAlong(page, LOOP);

    const samples = await previewSamples(page);
    const drawn = samples.filter((d) => d.length > 0);
    expect(drawn.length, 'frames with a line under the pointer').toBeGreaterThan(1);
    // Consecutive frames differ: it is being redrawn, not painted once at the end.
    const distinct = new Set(drawn);
    expect(distinct.size, 'different lines across those frames').toBeGreaterThan(1);
    let changed = 0;
    for (let index = 1; index < drawn.length; index += 1) {
      if (drawn[index] !== drawn[index - 1]) changed += 1;
    }
    expect(changed, 'frames where the line grew').toBeGreaterThan(1);
    // Nothing of it is in the document yet.
    expect(await strokesOn(page)).toHaveLength(0);

    await page.mouse.up();
    const strokes = await waitForStrokes(page, 1);
    const stroke = strokes[0] as StrokeRecord;
    // The loop came back as one stroke, roughly where it was drawn and roughly its size.
    expect(stroke.type).toBe('stroke');
    expect(stroke.points).toBeGreaterThan(2);
    expect(stroke.width).toBeGreaterThan(150);
    expect(stroke.height).toBeGreaterThan(120);
    expect(stroke.x).toBeLessThan(LOOP_AT.x + 20);
    await expect(page.locator('[data-testid="stroke-object"]')).toHaveCount(1);
    // And it is still there when the page is opened again.
    await page.reload();
    await waitForCentredBoard(page);
    await expect(page.locator('[data-testid="stroke-object"]')).toHaveCount(1);
    expect((await strokesOn(page)).map((entry) => entry.id)).toEqual([stroke.id]);

    expectNoErrors([person]);
  } finally {
    await closeParticipants([person]);
  }
});

test('TC-19: while the pen is up the wheel still moves the board and a note is not in the way', async ({
  browser,
}) => {
  const person = await aloneOn(browser, 'Alex');
  const page = person.page;
  try {
    // A note to draw over, and its place on the board, both taken before the pen is up — the
    // pen surface takes every press, so it is also true that a note cannot be made now.
    const note = await createNote(page, { x: 640, y: 400 });
    const before = await boardNotes(page);
    const noteBefore = before.find((entry) => entry.id === note);
    if (!noteBefore) throw new Error('the note vanished before the pen came out');

    await clickPenTool(page);
    const camera = await readCamera(page);
    await page.mouse.move(640, 420);
    await page.mouse.wheel(0, 240);
    await settle(page);
    const scrolled = await readCamera(page);
    // Scroll still navigates: the pen takes presses, not the wheel (design: pen.navigation).
    expect(scrolled.y, 'the board scrolled with the wheel').not.toBe(camera.y);
    expect(scrolled.zoom, 'and did not zoom').toBe(camera.zoom);

    // A drag that starts on the note draws over it: the note keeps its place, nothing is
    // selected, and the board does not move. The path is moved so that its first press lands
    // exactly on the middle of the note, which is the case the PRD is nervous about.
    const rect = await noteRect(page, note);
    const cameraNow = await readCamera(page);
    await holdPenAlong(page, startingAt(thin(loopAt(LOOP_AT), 4), { x: rect.centerX, y: rect.centerY }));
    await page.mouse.up();
    const strokes = await waitForStrokes(page, 1);
    expect(strokes).toHaveLength(1);
    const after = (await boardNotes(page)).find((entry) => entry.id === note);
    if (!after) throw new Error('the note was deleted by a pen drag');
    expect(after.x, 'the note stayed where it was').toBe(noteBefore.x);
    expect(after.y, 'the note stayed where it was').toBe(noteBefore.y);
    // (The board's own note reader counts every object, and a stroke is one of them.)
    expect((await boardNotes(page)).filter((entry) => entry.type === 'sticky')).toHaveLength(1);
    expect(await selectedStrokeIds(page), 'and the pen selected nothing').toEqual([]);
    const settled = await readCamera(page);
    expect(settled.x).toBe(cameraNow.x);
    expect(settled.y).toBe(cameraNow.y);

    expectNoErrors([person]);
  } finally {
    await closeParticipants([person]);
  }
});

test('TC-18: a sketch is invisible until the pointer leaves, then it is there for everyone', async ({
  browser,
}) => {
  const { a: priya, b: sam, people } = await twoPeople(browser, 'Priya', 'Sam');
  try {
    await clickPenTool(priya.page);
    await holdPenAlong(priya.page, UNDERLINE_THIN);

    // Priya has been drawing for a moment now. She can see her line; Sam cannot see it at all,
    // in his document or on his screen (PRD: "Others do not see a stroke while it is being drawn").
    expect(await strokesOn(priya.page), 'not even Priya has a stroke mid-drag').toHaveLength(0);
    expect(await strokesOn(sam.page)).toHaveLength(0);
    await expect(sam.page.locator('[data-testid="stroke-object"]')).toHaveCount(0);
    await expect(sam.page.locator('[data-testid="pen-preview"]')).toHaveCount(0);

    const releasedAt = Date.now();
    await priya.page.mouse.up();
    const strokes = await waitForStrokes(sam.page, 1);
    logLatency({
      op: 'a finished stroke → Sam',
      latencyMs: Date.now() - releasedAt,
      budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });

    // What Sam got is the stroke Priya drew: one line, with her device on it.
    const priyas = await strokesOn(priya.page);
    expect(priyas.map((entry) => entry.id)).toEqual(strokes.map((entry) => entry.id));
    expect(strokes[0]?.points).toBeGreaterThan(2);
    expect(strokes[0]?.createdBy).toBe(priyas[0]?.createdBy);
    expect(strokes[0]?.color).toBe('black');
    expect(await priya.page.locator('[data-testid="pen-tool-surface"]').count()).toBe(1);
    // And Sam, who only watched, never had a pen of his own.
    expect(await sam.page.locator('[data-testid="pen-tool-surface"]').count()).toBe(0);

    await expectConverged(people);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-20: a stroke is selected by its line, stretched in proportion, moved and deleted', async ({
  browser,
}) => {
  const { a: dana, b: sam, people } = await twoPeople(browser, 'Dana', 'Sam');
  const page = dana.page;
  try {
    await clickPenTool(page);
    await clickPenColour(page, 'red');
    await clickPenThickness(page, 'thick');
    expect(await penOptionPressed(page, 'pen-colour-red')).toBe(true);
    expect(await penOptionPressed(page, 'pen-thickness-thick')).toBe(true);
    const [stroke] = await drawStrokeOnBoard(page, LOOP);
    if (!stroke) throw new Error('the Pen tool drew nothing');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    await waitForStrokes(sam.page, 1);

    // The pen is still up — the tidying starts by putting it down.
    expect(await toolPressed(page, 'tool-pen')).toBe(true);
    await page.keyboard.press('v');
    await settle(page);
    expect(await penSurfaceVisible(page)).toBe(false);

    // A click on the ink selects it; the selection box appears with its handles.
    await selectStrokeOnBoard(page, stroke.id);
    expect(await selectedStrokeIds(page)).toEqual([stroke.id]);
    await expect(page.locator('[data-handle="se"]')).toHaveCount(1);

    // Stretch the corner: the box keeps the ratio it had, and the line stays as fat as it was.
    const painting = await strokePainting(page, stroke.id);
    const before = await strokeIn(page, stroke.id);
    const ratio = before.width / before.height;
    await dragHandle(page, 'se', { x: 90, y: 60 });
    const resized = await strokeIn(page, stroke.id);
    expect(
      Math.abs(resized.width / resized.height / ratio - 1),
      `the ratio held at ${ratio.toFixed(3)}`,
    ).toBeLessThan(0.01);
    expect(resized.thickness, 'the line did not get fatter').toBe('thick');
    expect((await strokePainting(page, stroke.id)).strokeWidth).toBe(painting.strokeWidth);

    // Drag it somewhere else: the box moves and does not change size.
    const moved = await dragStrokeBody(page, stroke.id, { x: 120, y: 60 });
    expect(moved.x - stroke.x).toBeGreaterThanOrEqual(100);
    expect(moved.y - stroke.y).toBeGreaterThanOrEqual(40);
    expect(moved.width).toBeCloseTo(resized.width, 1);
    expect(moved.height).toBeCloseTo(resized.height, 1);

    // Delete it: it goes, on both screens.
    await page.keyboard.press('Delete');
    await settle(page);
    await waitForStrokes(page, 0);
    await waitForStrokes(sam.page, 0);
    await expect(page.locator('[data-testid="stroke-object"]')).toHaveCount(0);
    await expect(sam.page.locator('[data-testid="stroke-object"]')).toHaveCount(0);

    await expectConverged(people);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

/** The same path, slid along so that its first point lands on `at`. */
function startingAt(
  points: readonly { x: number; y: number }[],
  at: { x: number; y: number },
): { x: number; y: number }[] {
  const first = points[0];
  if (!first) throw new Error('an empty path has nowhere to start');
  return points.map((point) => ({ x: point.x + at.x - first.x, y: point.y + at.y - first.y }));
}

/** Press the middle of a stroke's ink, drag it, and report the box it ended up in. */
async function dragStrokeBody(
  page: Page,
  id: string,
  by: { x: number; y: number },
): Promise<StrokeRecord> {
  const at = await strokeInkPoint(page, id);
  await page.mouse.move(Math.round(at.x), Math.round(at.y));
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      Math.round(at.x + (by.x * step) / 8),
      Math.round(at.y + (by.y * step) / 8),
    );
  }
  await page.mouse.up();
  await settle(page);
  return strokeIn(page, id);
}

