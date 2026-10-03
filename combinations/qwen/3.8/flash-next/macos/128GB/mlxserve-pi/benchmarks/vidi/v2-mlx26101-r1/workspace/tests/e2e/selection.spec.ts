// Story 7 e2e: select, move, resize and delete several objects at once.
//
// Real-browser proof (chromium) of the marquee, the generic transform gesture and
// the selection keyboard commands, driven through the same mouse / keyboard paths a
// person uses. Notes are seeded at *screen* points (converted to world through the
// live board's own camera), so every box is on-screen and geometry is asserted
// exactly at the current zoom.

import { expect, test, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  dragHandle,
  dragScreen,
  noteCenter,
  noteScreenBox,
  noteWorldPos,
  noteZIndex,
  readCameraRaw,
  readZoom,
  seedNotesAtScreen,
  selectNotes,
  selectedIdSet,
  selectionBar,
  selectionCount,
  shiftMarquee,
  stickyIds,
} from './helpers/sticky';
import { createFreshBoard, createParticipants, everyoneSeesNotes, waitForSameScreen, type Participant } from './helpers/participants';
import { gotoBoard } from './helpers/board';

const GRID_6: readonly { x: number; y: number }[] = [
  { x: 250, y: 140 },
  { x: 470, y: 140 },
  { x: 250, y: 300 },
  { x: 470, y: 300 },
  { x: 250, y: 460 },
  { x: 470, y: 460 },
];

/** Marquee over `inside`, leaving `partly` half-covered and `outside` clear. */
async function marqueeInside(page: Page, inside: string[], partly: string, outside: string) {
  const boxes = await Promise.all(inside.map((id) => noteScreenBox(page, id)));
  const p = await noteScreenBox(page, partly);
  const left = Math.min(...boxes.map((b) => b.x)) - 15;
  const top = Math.min(...boxes.map((b) => b.y)) - 15;
  const bottom = Math.max(...boxes.map((b) => b.y + b.h)) + 15;
  const right = p.x + p.w - 10; // stops inside `partly`, so it is not fully covered
  await shiftMarquee(page, [left, top], [right, bottom]);
  await expect
    .poll(() => selectedIdSet(page).then((s) => [...s].sort()))
    .toEqual([...inside].sort());
  expect((await selectedIdSet(page)).has(partly)).toBe(false);
  expect((await selectedIdSet(page)).has(outside)).toBe(false);
}

/** Close every participant's context, so heavy multi-browser tests leak nothing. */
async function closeParticipants(people: readonly Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.close()));
}

test.describe('multi-select: marquee', () => {
  test('TC-32 selects only the objects fully inside the marquee', async ({ page }) => {
    await gotoBoard(page);
    const [a, b, c, h, d] = await seedNotesAtScreen(page, [
      { x: 300, y: 300 },
      { x: 520, y: 300 },
      { x: 740, y: 300 },
      { x: 900, y: 300 },
      { x: 1150, y: 650 },
    ]);
    await marqueeInside(page, [a!, b!, c!], h!, d!);
  });
});

test.describe('multi-select: group transform', () => {
  test('TC-33 moves a group above an unselected note, then resizes it evenly', async ({
    page,
  }) => {
    await gotoBoard(page);
    const zoom = await readZoom(page);

    const six = await seedNotesAtScreen(page, GRID_6);
    const seventh = (await seedNotesAtScreen(page, [{ x: 1050, y: 140 }]))[0]!;

    // The seventh was created last, so it starts stacked above the six.
    expect(await noteZIndex(page, seventh)).toBeGreaterThan(
      await noteZIndex(page, six[0]!),
    );

    // Marquee the six (the seventh sits clear to the right).
    const sixBoxes = await Promise.all(six.map((id) => noteScreenBox(page, id)));
    await shiftMarquee(
      page,
      [
        Math.min(...sixBoxes.map((b) => b.x)) - 15,
        Math.min(...sixBoxes.map((b) => b.y)) - 15,
      ],
      [
        Math.max(...sixBoxes.map((b) => b.x + b.w)) + 15,
        Math.max(...sixBoxes.map((b) => b.y + b.h)) + 15,
      ],
    );
    expect(await selectionCount(page)).toBe(6);

    // Drag one of the six: the whole group moves together, by the same world delta.
    const before = await Promise.all(six.map((id) => noteWorldPos(page, id)));
    const start = await noteCenter(page, six[0]!);
    await dragScreen(page, start.x, start.y, 300 * zoom, 0);
    const after = await Promise.all(six.map((id) => noteWorldPos(page, id)));
    for (let i = 0; i < six.length; i++) {
      expect(Math.abs(after[i]!.x - (before[i]!.x + 300))).toBeLessThanOrEqual(2);
      expect(Math.abs(after[i]!.y - before[i]!.y)).toBeLessThanOrEqual(2);
    }
    // Bring-to-front lifted the moved group above the never-selected note.
    const movedTop = Math.max(
      ...(await Promise.all(six.map((id) => noteZIndex(page, id)))),
    );
    expect(movedTop).toBeGreaterThan(await noteZIndex(page, seventh));

    // Resize with the bottom-right handle: every note grows and stays square.
    const widthsBefore = await Promise.all(
      six.map((id) => noteScreenBox(page, id).then((b) => b.w)),
    );
    await dragHandle(page, 'se', 200 * zoom, 200 * zoom);
    const grown = await Promise.all(six.map((id) => noteScreenBox(page, id)));
    for (let i = 0; i < six.length; i++) {
      expect(grown[i]!.w).toBeGreaterThan(widthsBefore[i]! + 5);
      expect(Math.abs(grown[i]!.w - grown[i]!.h)).toBeLessThanOrEqual(2);
    }

    // Shrink hard (well past the minimum): the whole selection stops at the type
    // minimum, with none of the notes going below it. Drag the bottom-right corner
    // toward the top-left corner, leaving only a sliver of box.
    const cur = await Promise.all(six.map((id) => noteScreenBox(page, id)));
    const r = Math.max(...cur.map((b) => b.x + b.w));
    const b = Math.max(...cur.map((bb) => bb.y + bb.h));
    const l = Math.min(...cur.map((bb) => bb.x));
    const t = Math.min(...cur.map((bb) => bb.y));
    await dragScreen(page, r, b, l + 20 - r, t + 20 - b);
    const widths = await Promise.all(
      six.map((id) => noteScreenBox(page, id).then((bx) => bx.w / zoom)),
    );
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
  });
});

test.describe('multi-select: keyboard', () => {
  test('TC-34 nudges a selection with the arrows and deletes it', async ({ page }) => {
    await gotoBoard(page);
    const ids = await seedNotesAtScreen(page, GRID_6);
    await page.keyboard.press('Control+a'); // select all six
    expect(await selectionCount(page)).toBe(6);

    const before = await Promise.all(ids.map((id) => noteWorldPos(page, id)));
    const camBefore = await readCameraRaw(page);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    const expected = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    const after = await Promise.all(ids.map((id) => noteWorldPos(page, id)));
    for (let i = 0; i < ids.length; i++) {
      expect(Math.abs(after[i]!.x - (before[i]!.x + expected))).toBeLessThanOrEqual(2);
      expect(Math.abs(after[i]!.y - before[i]!.y)).toBeLessThanOrEqual(2);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await readCameraRaw(page)).toEqual(camBefore);

    await page.keyboard.press('Delete');
    await expect.poll(() => stickyIds(page).then((x) => x.length)).toBe(0);
    await expect(selectionBar(page)).toHaveCount(0);
  });
});

test.describe('multi-select: collaboration', () => {
  test('TC-35 a peer deleting a selected note prunes the selection live', async ({
    browser,
    request,
  }) => {
    const board = await createFreshBoard(request);
    const [lee, sam] = await createParticipants(browser, board, ['Lee', 'Sam']);

    // Lee makes a small grid of notes; both see all of them.
    const grid = [];
    for (let r = 0; r < 4; r++)
      for (let cIdx = 0; cIdx < 5; cIdx++)
        grid.push({ x: 200 + cIdx * 210, y: 150 + r * 160 });
    const ids = await seedNotesAtScreen(lee.page, grid);
    await everyoneSeesNotes([lee, sam], ids.length);

    // Lee marquee-selects the first four notes.
    await selectNotes(lee.page, ids.slice(0, 4));
    expect(await selectionCount(lee.page)).toBe(4);
    const selected = [...(await selectedIdSet(lee.page))].sort();

    // Sam deletes one of the notes Lee has selected.
    const victim = selected[0]!;
    await selectNotes(sam.page, [victim]);
    await sam.page.keyboard.press('Delete');

    // On Lee's screen, within the latency budget, the note is gone and the bar
    // counts one fewer; the other three keep their outlines.
    await expect
      .poll(() => selectionCount(lee.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(3);
    const remaining = [...(await selectedIdSet(lee.page))].sort();
    expect(remaining).toEqual(selected.filter((id) => id !== victim));

    // Lee deletes the remaining three; they leave the board too.
    await lee.page.keyboard.press('Delete');
    await expect
      .poll(() => lee.ids().then((n) => n.length))
      .toBe(ids.length - 4);
    await closeParticipants([lee, sam]);
  });

  test('TC-36 many editors moving different selections converge identically', async ({
    browser,
    request,
  }) => {
    const board = await createFreshBoard(request);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `e${i}`);
    const people = await createParticipants(browser, board, names);

    // A shared starting set: two notes per editor, spaced out.
    const grid = people.flatMap((_, i) => [
      { x: 180 + (i % 3) * 360, y: 160 + Math.floor(i / 3) * 300 },
      { x: 300 + (i % 3) * 360, y: 160 + Math.floor(i / 3) * 300 },
    ]);
    const ids = await seedNotesAtScreen(people[0]!.page, grid);
    await everyoneSeesNotes(people, ids.length);
    const initial = await people[0]!.notePos(ids[0]!);

    // Every editor selects its own pair and moves it at the same time.
    await Promise.all(
      people.map(async (p: Participant, i: number) => {
        const pair = [ids[i * 2]!, ids[i * 2 + 1]!];
        await selectNotes(p.page, pair);
        const c = await noteCenter(p.page, pair[0]!);
        await dragScreen(p.page, c.x, c.y, 40 + i * 15, 30 + i * 12);
      }),
    );

    // Absolute writes converge: every screen ends up identical.
    const { screen } = await waitForSameScreen(people);
    const moved = screen.find((n) => n.id === ids[0]!)!;
    expect(Math.abs(moved.x - initial.x)).toBeGreaterThan(1); // it really moved
    for (const p of people) expect(p.pageErrors).toEqual([]);
    await closeParticipants(people);
  });
});
