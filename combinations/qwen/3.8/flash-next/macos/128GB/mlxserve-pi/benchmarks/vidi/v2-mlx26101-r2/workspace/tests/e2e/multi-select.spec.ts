import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';
import { cameraState, expectNear, openBoard, waitForRender } from './helpers/board.js';
import { docNotes, noteById, waitForNoteCount } from './helpers/sticky.js';
import {
  clickNote,
  clearSelection,
  dragBy,
  dragHandle,
  expectSelection,
  marquee,
  nudgeSelection,
  pressDelete,
  screenCentre,
  seedStickyAt,
  selectAll,
  selectedNoteIds,
  selectionBar,
  selectionCount,
} from './helpers/select.js';
import {
  closeParticipants,
  expectSameBoard,
  openParticipants,
  person,
  type Participant,
} from './helpers/participants.js';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.js';

/**
 * Story 7 (select, move, resize, delete several objects at once) in a real
 * browser. The unit/component suites prove the model and the state machine;
 * these prove the gestures through the DOM and the sync path: a marquee that
 * grabs only fully-contained notes, a group transform that writes absolute
 * positions which converge across collaborators, and keyboard commands that
 * nudge and delete the whole selection without ever scrolling the page or moving
 * the camera.
 *
 * The view starts at the standard zoom (100%, board origin centred), so screen
 * pixels and world units are the same number and a fresh note is 200×200 on screen.
 */

const SIX = [
  { x: 200, y: 250 },
  { x: 420, y: 250 },
  { x: 640, y: 250 },
  { x: 200, y: 470 },
  { x: 420, y: 470 },
  { x: 640, y: 470 },
];

/**
 * Seed the six notes on the left, then a seventh parked clear of them on the
 * right (made last so it starts on top) where one of the six will land after a
 * +300 move, and select the six with a marquee that leaves the seventh out
 * because it sits wholly past the rectangle.
 */
async function seedSixAndSelectThem(page: Page): Promise<{ six: string[]; seventh: string }> {
  const six = await seedStickyAt(page, SIX);
  // The seventh is placed at x=880, wholly outside the six (their right edge is
  // x=740), so this double-click lands on empty board and really creates a note.
  await page.mouse.dblclick(880, 250);
  await page.keyboard.press('Escape');
  await waitForRender(page);
  await clearSelection(page);
  // A marquee that fully contains the six (100..740 × 150..570) and stops at x=760,
  // short of the seventh (780..980), so exactly six are grabbed.
  await marquee(page, { x: 95, y: 120 }, { x: 760, y: 600 });
  await expectSelection(page, six);
  const seventh = (await docNotes(page)).find((note) => !six.includes(note.id))?.id;
  if (!seventh) throw new Error('the seventh note is missing from the document');
  return { six, seventh };
}

test('TC-32 a marquee selects only fully-contained notes (A inside, B half, C outside)', async ({ page }) => {
  await openBoard(page);
  // A and B are neighbours (their boxes meet at x=460); C sits far bottom-right.
  const [a, b, c] = await seedStickyAt(page, [
    { x: 360, y: 300 }, // A: fully inside the marquee below
    { x: 560, y: 300 }, // B: straddles the marquee's right edge (only half inside)
    { x: 1050, y: 600 }, // C: entirely outside
  ]);

  // Shift+drag from empty space: the rectangle ends at x=500, so it covers A
  // (260..460) completely, catches only B's left sliver (460..500 of 460..660),
  // and never reaches C.
  await marquee(page, { x: 200, y: 150 }, { x: 500, y: 430 });

  await expectSelection(page, [a!]);
  expect(await selectedNoteIds(page), 'only A is inside').toEqual([a]);
  expect((await selectedNoteIds(page)).includes(b!), 'B is only partly inside').toBe(false);
  expect((await selectedNoteIds(page)).includes(c!), 'C is outside').toBe(false);
});

test('TC-32b a marquee adds to the selection and Escape clears everything', async ({ page }) => {
  await openBoard(page);
  const [a, b] = await seedStickyAt(page, [
    { x: 300, y: 250 },
    { x: 900, y: 600 },
  ]);

  await clickNote(page, a!);
  await expectSelection(page, [a!]);
  // A second marquee around B keeps A: a marquee never drops what it did not touch.
  await marquee(page, { x: 780, y: 480 }, { x: 1020, y: 720 });
  await expectSelection(page, [a!, b!]);
  expect(await selectionCount(page), 'two selected -> the bar reads "2 selected"').toBe(2);

  await clearSelection(page);
  await expectSelection(page, []);
  await expect(selectionBar(page)).toHaveCount(0);
});

test('TC-33 dragging one selected note moves all six, raises them, and leaves the camera alone', async ({ page }) => {
  await openBoard(page);
  const { six, seventh } = await seedSixAndSelectThem(page);

  const before = new Map((await docNotes(page)).map((n) => [n.id, n]));
  const cameraBefore = JSON.stringify(await cameraState(page));

  // Grab the top-left note and drag the selection 300 px right (= 300 world).
  await dragBy(page, await screenCentre(page, six[0]!), { x: 300, y: 0 });

  for (const id of six) {
    expectNear((await noteById(page, id)).x - before.get(id)!.x, 300, 2, `note ${id} moved by the drag`);
  }
  // The whole selection is raised: even its lowest member now sits above the
  // unselected seventh note it moved onto.
  const raised = Math.min(...(await Promise.all(six.map(async (id) => (await noteById(page, id)).z))));
  expect(raised, 'selected notes render above the unselected one').toBeGreaterThan((await noteById(page, seventh)).z);
  expect(JSON.stringify(await cameraState(page)), 'a note drag never moves the camera').toBe(cameraBefore);
});

test('TC-33b resizing the group scales notes and gaps, stays square, and stops at the minimum', async ({ page }) => {
  await openBoard(page);
  const { six } = await seedSixAndSelectThem(page);

  const gapBefore = (await noteById(page, six[1]!)).x - (await noteById(page, six[0]!)).x;

  // Drag the bottom-right handle outward: every note grows, so every gap grows too.
  await dragHandle(page, 'se', { x: 200, y: 200 });
  for (const id of six) {
    const n = await noteById(page, id);
    expectNear(n.width!, n.height!, 2, `grown note ${id} stays square`);
    expect(n.width!, `grown note ${id} is larger than it started`).toBeGreaterThan(STICKY_SIZE_WORLD);
  }
  const gapAfter = (await noteById(page, six[1]!)).x - (await noteById(page, six[0]!)).x;
  expect(gapAfter, 'the gap between notes scales with them').toBeGreaterThan(gapBefore);

  // Now shrink hard from the opposite handle. The scale clamps where the notes hit
  // STICKY_MIN_SIZE_WORLD - none goes smaller.
  await dragHandle(page, 'nw', { x: 6000, y: 6000 });
  for (const id of six) {
    const n = await noteById(page, id);
    expectNear(n.width!, n.height!, 2, `shrunken note ${id} stays square`);
    expect(n.width!, `note ${id} never shrinks below the minimum`).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
    expect(n.width!, `note ${id} is clamped near the minimum`).toBeLessThanOrEqual(STICKY_MIN_SIZE_WORLD + 3);
  }
});

test('TC-34 arrow nudges move the selection without scrolling or moving the camera; Delete removes all', async ({ page }) => {
  await openBoard(page);
  const six = await seedStickyAt(page, SIX);

  await selectAll(page);
  await expectSelection(page, six);

  const xBefore = new Map((await docNotes(page)).map((n) => [n.id, n.x]));
  const cameraBefore = JSON.stringify(await cameraState(page));

  // Three single steps then one large step.
  await nudgeSelection(page, 'ArrowRight', 3);
  await nudgeSelection(page, 'ArrowRight', 1, true);
  const expectedMove = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;

  for (const id of six) {
    expectNear((await noteById(page, id)).x - xBefore.get(id)!, expectedMove, 0.001, `note ${id} nudged right`);
  }

  expect(JSON.stringify(await cameraState(page)), 'arrow nudges never move the camera').toBe(cameraBefore);
  expect(await page.evaluate(() => window.scrollY), 'arrows never scroll the page').toBe(0);

  await pressDelete(page);
  await waitForNoteCount(page, 0);
  await expect(selectionBar(page)).toHaveCount(0);
});

test('TC-35 a collaborator deletes one of my selected notes: my selection prunes to the rest', async ({ browser }) => {
  const people = await openParticipants(browser, ['Lee', 'Sam']);
  try {
    const lee = person(people, 'Lee');
    const sam = person(people, 'Sam');

    // Four notes Lee will select (a 2x2 block top-left) and two far right that stay.
    const four = [
      { x: 300, y: 250 },
      { x: 520, y: 250 },
      { x: 300, y: 470 },
      { x: 520, y: 470 },
    ];
    const selected = await seedStickyAt(lee.page, four);
    await seedStickyAt(lee.page, [
      { x: 1050, y: 250 },
      { x: 1050, y: 470 },
    ]);
    await expectSameBoard(people);

    await marquee(lee.page, { x: 180, y: 120 }, { x: 650, y: 600 });
    await expectSelection(lee.page, selected);
    expect(await selectionCount(lee.page), 'Lee sees the bar read "4 selected"').toBe(4);

    // Sam deletes one of the four. Selection is local, so Sam selects it first.
    const victim = selected[0]!;
    await clickNote(sam.page, victim);
    await pressDelete(sam.page);

    // On Lee's side the note vanishes and the selection prunes itself to three.
    await expect.poll(() => selectionCount(lee.page), { message: 'Lee was never told "3 selected"' }).toBe(3);
    await expectSelection(lee.page, selected.slice(1));

    // Lee deletes the three still selected. Only the two far notes survive.
    await pressDelete(lee.page);
    await waitForNoteCount(lee.page, 2);
    await expectSameBoard(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-36 everyone moves a different note at once and every board converges', async ({ browser }) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
  const people: Participant[] = await openParticipants(browser, names);
  try {
    // One note per editor, laid out left to right without overlapping.
    const points = names.map((_, i) => ({ x: 220 + i * 220, y: 320 }));
    const ids = await seedStickyAt(people[0]!.page, points);
    await expectSameBoard(people);

    const xBefore = new Map((await docNotes(people[0]!.page)).map((n) => [n.id, n.x]));

    // Each editor selects a *different* note and nudges it three steps right: the
    // writes are absolute, so they never fight and every board ends identical.
    for (let i = 0; i < people.length; i += 1) {
      await clickNote(people[i]!.page, ids[i]!);
      await nudgeSelection(people[i]!.page, 'ArrowRight', 3);
    }

    await expectSameBoard(people);
    for (const id of ids) {
      expectNear((await noteById(people[0]!.page, id)).x - xBefore.get(id)!, NUDGE_STEP_WORLD * 3, 0.001, `note ${id} moved three steps`);
    }
  } finally {
    await closeParticipants(people);
  }
});
