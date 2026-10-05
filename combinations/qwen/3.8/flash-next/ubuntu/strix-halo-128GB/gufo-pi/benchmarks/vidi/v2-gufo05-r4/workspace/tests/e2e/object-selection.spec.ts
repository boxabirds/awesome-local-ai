/**
 * Story 7 end-to-end tests: box-selecting, moving, resizing, nudging and deleting several
 * objects at once, in a real browser against the real room.
 *
 * What jsdom cannot tell anybody is whether a resize handle is where the box says it is,
 * whether a box drawn with the mouse really leaves a half-covered note alone, and whether
 * five people moving different parts of one board end up agreeing to the last decimal place.
 * Those are the things this file is for; the rules themselves are checked more cheaply in
 * the unit and component suites.
 *
 * Notes are put on the board through the sync wire (`seedBoard`) at world points worked out
 * from where the test wants them on screen, so a test says "six notes in a block" and gets
 * exactly that instead of two hundred double-clicks.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD
} from '../../src/shared/config';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import {
  boardShape,
  clickObject,
  createBoardOn,
  dragByMouse,
  dragResizeHandleBy,
  dragWithKey,
  getBoard,
  getCamera,
  marqueeBox,
  objectCentreOnScreen,
  objects,
  selectAllWithKeyboard,
  selectedCount,
  selectionBar,
  selectionCountLabel,
  selectionDeleteButton,
  selectionLive,
  waitForBoard,
  worldOf
} from './helpers/board';
import { boardOf, closeSessions, openSession, type Session } from './helpers/participants';
import { seedBoard } from './helpers/board-writer';

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

interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

/** A board of this test's own, holding one note at each given screen point. */
async function openBoardWithNotes(page: Page, centres: { x: number; y: number }[]): Promise<string[]> {
  const boardId = await createBoardOn();
  await page.goto(`/b/${boardId}`);
  await waitForBoard(page);

  // The screen points are turned into world points on the open board, so the notes land
  // where the test means them to whatever the camera does on the way up.
  const worlds: Point[] = [];
  for (const centre of centres) worlds.push(await worldOf(page, centre));

  await seedBoard(
    BASE_URL,
    boardId,
    (doc) => {
      for (const world of worlds) createSticky(doc, world);
    },
    centres.length
  );

  await expect(objects(page)).toHaveCount(centres.length);
  return (await getBoard(page)).map((note) => note.id);
}

/** Notes seeded onto a session's shared board, seen by everybody. */
async function seedNotes(session: Session, centres: { x: number; y: number }[]): Promise<void> {
  const worlds: Point[] = [];
  for (const centre of centres) worlds.push(await worldOf(session.people[0].page, centre));
  await seedBoard(
    BASE_URL,
    session.boardId,
    (doc) => {
      for (const world of worlds) createSticky(doc, world);
    },
    centres.length
  );
  await session.everyoneSees('everybody holds the whole board', centres.length);
}

async function shapeOf(page: Page, objectId: string): Promise<Shape> {
  const found = (await getBoard(page)).find((note) => note.id === objectId);
  if (!found) throw new Error(`object ${objectId} is not on the board`);
  return {
    x: found.x,
    y: found.y,
    width: found.width ?? STICKY_SIZE_WORLD,
    height: found.height ?? STICKY_SIZE_WORLD,
    z: found.z
  };
}

async function shapesOf(page: Page, ids: string[]): Promise<Record<string, Shape>> {
  const shapes: Record<string, Shape> = {};
  for (const id of ids) shapes[id] = await shapeOf(page, id);
  return shapes;
}

/** Within a tolerance, as a message a waiting test can print. */
function closeTo(actual: number, expected: number, tolerance = 0.5): string | true {
  return Math.abs(actual - expected) <= tolerance || `${actual} is not within ${tolerance} of ${expected}`;
}

/** Drag an object from its own middle by a screen delta, with no keys held. */
async function dragObjectBy(page: Page, objectId: string, deltaX: number, deltaY: number): Promise<void> {
  const centre = await objectCentreOnScreen(page, objectId);
  await dragByMouse(page, centre, { x: centre.x + deltaX, y: centre.y + deltaY });
}

test('TC-32: a box drawn with the mouse takes the objects inside it and only those', async ({ page }) => {
  const [inside, half, outside] = await openBoardWithNotes(page, [
    { x: 420, y: 380 },
    { x: 620, y: 380 },
    { x: 1000, y: 380 }
  ]);

  // A 400x400 box around the first note: the second is cut in half by its right edge, the
  // third is nowhere near it.
  await dragWithKey(page, { x: 220, y: 180 }, { x: 620, y: 580 }, 'Shift');

  // One object is selected, so the board shows that in its announcement rather than in a
  // bar: a selection of one gets the object's own toolbar instead (TC-18).
  await expect(selectionLive(page)).toHaveText('1 selected');
  await expect(selectionBar(page)).toHaveCount(0);
  expect(await selectedCount(page)).toBe(1);
  await expect(page.locator(`[data-object-id="${inside}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(page.locator(`[data-object-id="${half}"]`)).toHaveAttribute('data-selected', 'false');
  await expect(page.locator(`[data-object-id="${outside}"]`)).toHaveAttribute('data-selected', 'false');
  // The box was a gesture, not a drawing: it is gone once the button is up.
  await expect(marqueeBox(page)).toHaveCount(0);
});

test('TC-33: a selected block moves as one, above what it passes over, and resizes in proportion', async ({
  page
}) => {
  const columns = [300, 560, 820];
  const rows = [280, 540];
  const centres = [
    { x: columns[0], y: rows[0] },
    { x: columns[1], y: rows[0] },
    { x: columns[2], y: rows[0] },
    { x: columns[0], y: rows[1] },
    { x: columns[1], y: rows[1] },
    { x: columns[2], y: rows[1] },
    // The note nobody selects, which the block is dragged onto.
    { x: 1000, y: 410 }
  ];
  const ids = await openBoardWithNotes(page, centres);
  const six = ids.slice(0, 6);
  const leftBehind = ids[6];

  // Box the six, leaving the seventh out: the box cuts it rather than covering it.
  await dragWithKey(page, { x: 150, y: 130 }, { x: 930, y: 690 }, 'Shift');
  await expect(selectionCountLabel(page)).toHaveText('6 selected');

  const before = await shapesOf(page, ids);
  const orderBefore = (await getBoard(page)).map((note) => note.id);

  await dragObjectBy(page, six[0], 200, 60);

  const moved = await shapesOf(page, ids);
  for (const id of six) {
    expect(closeTo(moved[id].x, before[id].x + 200)).toBe(true);
    expect(closeTo(moved[id].y, before[id].y + 60)).toBe(true);
  }
  expect(closeTo(moved[leftBehind].x, before[leftBehind].x)).toBe(true);
  expect(closeTo(moved[leftBehind].y, before[leftBehind].y)).toBe(true);

  // The block ends up above the note it was dragged onto, and keeps its own order within
  // itself.
  for (const id of six) {
    expect(moved[id].z, `note ${id} should be above the one it was dropped on`).toBeGreaterThan(
      moved[leftBehind].z
    );
  }
  const orderAfter = (await getBoard(page)).map((note) => note.id);
  expect(orderAfter.filter((id) => six.includes(id))).toEqual(orderBefore.filter((id) => six.includes(id)));

  // Then resize the whole block from its bottom-right corner. That corner is the one that
  // moves, so the opposite one is the anchor everything is measured from.
  const anchor = {
    x: Math.min(...six.map((id) => moved[id].x)),
    y: Math.min(...six.map((id) => moved[id].y))
  };
  await dragResizeHandleBy(page, 'se', 80, 80);

  const resized = await shapesOf(page, six);
  const ratio = resized[six[0]].width / STICKY_SIZE_WORLD;
  expect(ratio, 'the block should have grown').toBeGreaterThan(1);
  for (const id of six) {
    // Every note keeps its square, and every distance is multiplied by the same number, so
    // sizes and gaps grow together and the arrangement survives.
    expect(closeTo(resized[id].width, resized[six[0]].width)).toBe(true);
    expect(closeTo(resized[id].height, resized[id].width)).toBe(true);
    expect(closeTo(resized[id].x - anchor.x, (moved[id].x - anchor.x) * ratio, 1)).toBe(true);
    expect(closeTo(resized[id].y - anchor.y, (moved[id].y - anchor.y) * ratio, 1)).toBe(true);
  }
  // The note left out of the selection is still the size it always was.
  expect(closeTo((await shapeOf(page, leftBehind)).width, STICKY_SIZE_WORLD)).toBe(true);
});

test('TC-34: arrows nudge the selection without moving the board, and Delete removes it', async ({
  page
}) => {
  const ids = await openBoardWithNotes(page, [
    { x: 320, y: 300 },
    { x: 560, y: 300 },
    { x: 440, y: 520 }
  ]);

  await selectAllWithKeyboard(page);
  await expect(selectionCountLabel(page)).toHaveText('3 selected');

  const before = await shapesOf(page, ids);
  const camera = await getCamera(page);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');

  const after = await shapesOf(page, ids);
  for (const id of ids) {
    expect(closeTo(after[id].x, before[id].x + 2 * NUDGE_STEP_WORLD)).toBe(true);
    expect(closeTo(after[id].y, before[id].y - NUDGE_LARGE_STEP_WORLD)).toBe(true);
  }

  // The board itself stayed exactly where it was: a nudge moves the objects, not the view,
  // and the page does not scroll out from under them.
  expect(await getCamera(page)).toEqual(camera);
  expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollTop])).toEqual(
    [0, 0, 0]
  );
  // And no browser text selection crept in with the Ctrl+A.
  expect(await page.evaluate(() => String(window.getSelection()?.toString() ?? ''))).toBe('');

  await page.keyboard.press('Delete');

  await expect(objects(page)).toHaveCount(0);
  await expect(selectionBar(page)).toHaveCount(0);
  await expect(selectionLive(page)).toHaveText('');
});

test('TC-31: the bin in the selection bar deletes everything selected', async ({ page }) => {
  await openBoardWithNotes(page, [
    { x: 320, y: 300 },
    { x: 560, y: 300 },
    { x: 800, y: 300 }
  ]);

  await selectAllWithKeyboard(page);
  await expect(selectionCountLabel(page)).toHaveText('3 selected');
  await selectionDeleteButton(page).click();

  await expect(objects(page)).toHaveCount(0);
  await expect(selectionBar(page)).toHaveCount(0);
  // A board with nothing on it is still a board: it takes a click, and makes another note.
  await page.mouse.dblclick(400, 400);
  await expect(objects(page)).toHaveCount(1);
});

test('TC-35: a note deleted by somebody else leaves my selection, and my count says so', async ({
  browser
}) => {
  const session = await withPeople(browser, 'lee', 'sam');
  const lee = session.person('lee').page;
  const sam = session.person('sam').page;

  await seedNotes(session, [
    { x: 320, y: 300 },
    { x: 560, y: 300 },
    { x: 800, y: 300 }
  ]);
  const ids = (await boardOf(lee) as StickySnapshot[]).map((note) => note.id);

  await clickObject(lee, ids[0]);
  await clickObject(lee, ids[1], true);
  await clickObject(lee, ids[2], true);
  await expect(selectionCountLabel(lee)).toHaveText('3 selected');

  // Sam deletes the middle one. Lee is told nothing: the document simply holds one fewer.
  await clickObject(sam, ids[1]);
  await sam.keyboard.press('Delete');

  await session.eventually("Lee's selection drops the note that is gone", async () => {
    const text = await selectionCountLabel(lee).textContent();
    return text === '2 selected' || `Lee's bar says ${JSON.stringify(text)}`;
  });
  expect(await selectedCount(lee)).toBe(2);
  await expect(lee.locator(`[data-object-id="${ids[0]}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(lee.locator(`[data-object-id="${ids[2]}"]`)).toHaveAttribute('data-selected', 'true');
  expect(await boardOf(lee)).toHaveLength(2);

  // And what is left still works as a selection: the stale id is simply not part of it.
  await lee.keyboard.press('ArrowRight');
  await session.eventually('the two remaining notes nudge for Sam too', async () => {
    const left = [ids[0], ids[2]];
    const onSam = await shapesOf(sam, left);
    const onLee = await shapesOf(lee, left);
    for (const id of [ids[0], ids[2]]) {
      const same = closeTo(onSam[id].x, onLee[id].x, 0.000001);
      if (same !== true) return same;
    }
    return true;
  });
});

test('TC-36: everybody moving their own part of the board ends up agreeing', async ({ browser }) => {
  test.setTimeout(240_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `editor${index}`);
  const session = await withPeople(browser, ...names);

  // One column of two notes each, far enough apart that nobody grabs somebody else's.
  const centres: { x: number; y: number }[] = [];
  for (let column = 0; column < MAX_CONCURRENT_EDITORS; column += 1) {
    for (const y of [250, 490]) centres.push({ x: 130 + column * 240, y });
  }
  await seedNotes(session, centres);

  const start = (await boardOf(session.people[0].page)) as StickySnapshot[];
  // Each person moves their own column down by an amount of their own.
  const plans = names.map((name, column) => ({
    name,
    ids: [start[column * 2].id, start[column * 2 + 1].id],
    by: 40 + column * 30
  }));

  await Promise.all(
    plans.map(async (plan) => {
      const page = session.person(plan.name).page;
      await clickObject(page, plan.ids[0]);
      await clickObject(page, plan.ids[1], true);
      await expect(selectionCountLabel(page)).toHaveText('2 selected');
      await dragObjectBy(page, plan.ids[0], 0, plan.by);
    })
  );

  // The final places are exactly where each person moved their own notes, on every screen.
  const expected = new Map<string, number>();
  for (const plan of plans) {
    for (const id of plan.ids) {
      const from = start.find((note) => note.id === id);
      if (!from) throw new Error(`note ${id} has gone missing`);
      expected.set(id, from.y + plan.by);
    }
  }

  for (const plan of plans) {
    const page = session.person(plan.name).page;
    await session.eventually(`${plan.name} agrees with the rest of the board`, async () => {
      const notes = (await boardOf(page)) as StickySnapshot[];
      if (notes.length !== start.length) return `${plan.name} holds ${notes.length} notes`;
      for (const note of notes) {
        const wanted = expected.get(note.id);
        if (wanted === undefined) return `note ${note.id} was moved by nobody`;
        const place = closeTo(note.y, wanted, 0.000001);
        if (place !== true) return `note ${note.id}: ${place}`;
      }
      return true;
    });
  }

  // Byte for byte the same board, including the layer each note ended up on.
  const shapes: string[] = [];
  for (const plan of plans) shapes.push(await boardShape(session.person(plan.name).page));
  for (const shape of shapes.slice(1)) expect(shape).toBe(shapes[0]);
  session.report();
});
