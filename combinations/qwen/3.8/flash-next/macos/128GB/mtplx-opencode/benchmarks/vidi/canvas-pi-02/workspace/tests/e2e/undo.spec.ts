import { type Page } from '@playwright/test';
import { expect, test } from './helpers/boardTest';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  type BoardWindow,
  readNotes,
  screenPointOf,
  seedNotes,
  settle,
  setCamera,
} from './helpers/board';
import { openCrowd, openFreshPair } from './helpers/boards';

/**
 * Story 8 in a real browser: undo and redo are personal.
 *
 * The component suite proves the shortcuts reach the controller and the
 * buttons mirror the stacks; what only a real room can prove is that a
 * colleague's changes - which arrive over the wire, not from this browser's
 * undo-tracked origin - never enter my history at all. That is what these
 * three tests run against: two or six separate browsers on one board, undo
 * keys pressed at the same time, and the convergence of the room as the
 * ground truth.
 *
 * Key shape throughout: notes seeded *through another page* are that page's
 * own work - on my screen they are remote, exactly like a real colleague's
 * keystroke. Notes seeded through my own page are my own work and *are* in
 * my history, which is what makes the control cases meaningful.
 */

/** Press at a page-space point, drag by (dx, dy), release, then let it settle. */
async function dragFrom(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  options: { shift?: boolean } = {},
): Promise<void> {
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
  await settle(page);
}

/**
 * Wait until two browsers describe the same document, id for id.
 *
 * Room sync is not instant; every "on both screens" assertion in this file
 * means *eventually*, and the only honest way to wait for that is to poll
 * the two live documents until they agree (or the test times out and says
 * so).
 */
async function expectSameBoard(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [left, right] = await Promise.all([readNotes(a), readNotes(b)]);
        return JSON.stringify(left) === JSON.stringify(right);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Where the dragged row is, as one browser's document sees it.
 *
 * A note's stored `x` is its top-left corner while the seeded text carries
 * its centre - "still displaced" and "back home" are both statements about
 * `x` compared against `centre - HALF`. Getting that one note-width wrong
 * is how an undo test convinces itself nothing moved.
 */
function displaced(notes: { x: number; text: string }[]): number {
  return notes.filter((note) => {
    const seeded = /^move (-?\d+)$/.exec(note.text);
    return (
      seeded &&
      Math.abs(note.x - (Number.parseFloat(seeded[1]!) - STICKY_SIZE_WORLD / 2)) > 50
    );
  }).length;
}

function home(notes: { x: number; text: string }[]): boolean {
  return notes.every((note) => {
    const seeded = /^move (-?\d+)$/.exec(note.text);
    const centre = Number.parseFloat(seeded?.[1] ?? NaN);
    return (
      !Number.isFinite(centre) ||
      Math.abs(note.x - (centre - STICKY_SIZE_WORLD / 2)) <= 1
    );
  });
}

/** How many notes carry the given marker text. */
function withText(notes: { text: string }[], marker: string): number {
  return notes.filter((note) => note.text.includes(marker)).length;
}

/** Wait until every given page sees exactly `count` notes in its document. */
async function expectBoardSize(pages: readonly Page[], count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const sizes = await Promise.all(
          pages.map(async (page) => (await readNotes(page)).length),
        );
        return sizes.every((size) => size === count);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test("TC-22 undo restores my eight deleted notes, leaves the colleague's note, and reverses", async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const [mia, raj] = await openFreshPair(browser, 'TC-22', testInfo.parallelIndex);
  const errors: string[] = [];
  for (const page of [mia, raj]) {
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }

  await settle(mia);
  await settle(raj);
  // Half scale, camera parked top-left so the whole two-row box is on one
  // screen (the camera's x/y is the world point at the viewport's top-left
  // corner - the same convention `screenPointOf` reads).
  await setCamera(mia, { x: -1300, y: -700, zoom: 0.5 });

  // Eight notes, seeded *through Raj's browser*: on Mia's screen they are
  // remote changes, which is the whole point - her undo cannot reach them.
  // Mixed colours and texts, so "restores" can mean all of it. They live
  // two rows deep and end before x = 700; Raj's ninth note will be at
  // x = 1400, outside any rectangle this test draws.
  const eight = [
    { x: -1000, y: -400, color: 'yellow', text: 'alpha' },
    { x: -500, y: -400, color: 'blue', text: 'bravo' },
    { x: 0, y: -400, color: 'pink', text: 'charlie' },
    { x: 500, y: -400, color: 'green', text: 'delta' },
    { x: -1000, y: 400, color: 'violet', text: 'echo' },
    { x: -500, y: 400, color: 'orange', text: 'foxtrot' },
    { x: 0, y: 400, color: 'yellow', text: 'golf' },
    { x: 500, y: 400, color: 'blue', text: 'hotel' },
  ];
  await seedNotes(raj, eight);
  await expectBoardSize([mia, raj], 8);

  // Mia box-selects the eight: the rectangle fully contains every one of
  // them (a half-inside note would not be selected) and stops well short
  // of Raj's note.
  const start = await screenPointOf(mia, { x: -1150, y: -650 });
  const end = await screenPointOf(mia, { x: 700, y: 650 });
  await dragFrom(mia, start.x, start.y, end.x - start.x, end.y - start.y, {
    shift: true,
  });
  await expect
    .poll(
      () =>
        mia.evaluate(
          () => document.querySelectorAll('[data-testid="local-selection-outline"]').length,
        ),
      { timeout: 5_000 },
    )
    .toBe(8);

  // The exact document before the mistake, for the exact comparison after.
  const beforeDelete = await readNotes(mia);

  // Delete removes the eight. This is Mia's own step, and the only thing
  // in her history.
  await mia.keyboard.press('Delete');
  await settle(mia);
  await expectBoardSize([mia, raj], 0);

  // Raj adds his ninth note while Mia's mistake is still undo-able.
  await raj.evaluate(() => {
    const hooks = (window as unknown as BoardWindow).__vidi6;
    hooks?.seedNote({ x: 1400, y: 0, text: 'raj' });
  });
  await expectBoardSize([mia, raj], 1);

  // One undo: the eight come back, here and there, exactly as they were -
  // text, colour and position - beside Raj's untouched note. Compared as
  // *sets*: paint order is not part of the promise, positions are.
  const asSet = (notes: { text: string; x: number; y: number; color: string }[]) =>
    JSON.stringify(
      notes
        .filter((note) => note.text !== 'raj')
        .map((note) => [note.text, note.x, note.y, note.color])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    );
  const beforeDeleteSet = asSet(beforeDelete);
  await mia.keyboard.press('ControlOrMeta+z');
  await settle(mia);
  await settle(raj);
  await expect
    .poll(
      async () => {
        const [here, there] = await Promise.all([readNotes(mia), readNotes(raj)]);
        return (
          here.length === 9 &&
          there.length === 9 &&
          asSet(here) === beforeDeleteSet &&
          here.some((note) => note.text === 'raj') &&
          there.some((note) => note.text === 'raj')
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Her history is exhausted: a board that never had her history cannot
  // offer more of it.
  await expect(mia.getByTestId('undo-button')).toBeDisabled();

  // Redo reverses the undo: the eight disappear again, on both screens,
  // and Raj's note is still nobody's to undo.
  await mia.getByTestId('redo-button').click();
  await settle(mia);
  await expect
    .poll(
      async () => {
        const [here, there] = await Promise.all([readNotes(mia), readNotes(raj)]);
        return here.length === 1 && there.length === 1 && here[0]?.text === 'raj';
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  await expectSameBoard(mia, raj);
  expect(errors).toEqual([]);
});

test('TC-23 undoing a move whose note a colleague deleted errors nowhere, and the next undo still works', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const [mia, raj] = await openFreshPair(browser, 'TC-23', testInfo.parallelIndex);
  const errors: string[] = [];
  for (const page of [mia, raj]) {
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }

  await settle(mia);
  await settle(raj);
  await setCamera(mia, { x: 0, y: 0, zoom: 0.5 });

  // Two notes of Mia's own - then, past the capture window, one move.
  const ids = await seedNotes(mia, [
    { x: -150, y: 0, text: 'mine' },
    { x: 300, y: 0, text: 'also mine' },
  ]);
  await expectBoardSize([mia, raj], 2);
  await mia.waitForTimeout(700);

  const centre = await screenPointOf(mia, { x: -150, y: 0 });
  await dragFrom(mia, centre.x, centre.y, 60, 0);
  await expect
    .poll(
      async () => {
        const notes = await readNotes(raj);
        return notes.some((note) => note.x > -140);
      },
      { timeout: 5_000 },
    )
    .toBe(true);

  // Raj deletes the moved note over the wire. It vanishes on both screens.
  const moved = ids[0]!;
  await raj.evaluate((id) => {
    const hooks = (window as unknown as BoardWindow).__vidi6;
    if (!hooks?.removeNote(id)) throw new Error('the note to delete was already gone');
  }, moved);
  await expectBoardSize([mia, raj], 1);

  // Mia's history still *thinks* that note is somewhere to move back to.
  // Undoing the move must be a quiet no-op; the undo after it must still
  // reach her own creation. Whatever granularity Yjs gives the two steps,
  // the room has to converge and nothing may throw.
  await mia.keyboard.press('ControlOrMeta+z');
  await settle(mia);
  await settle(raj);
  await expectSameBoard(mia, raj);
  await expect
    .poll(
      async () => {
        const notes = await readNotes(mia);
        return !notes.some((note) => note.id === moved);
      },
      { timeout: 5_000 },
    )
    .toBe(true);

  // The next undo still works: the board ends empty on both screens - the
  // stack drains, the deleted target is skipped, and no console noise is
  // printed while it happens.
  await mia.keyboard.press('ControlOrMeta+z');
  await settle(mia);
  await settle(raj);
  await expectSameBoard(mia, raj);
  await expect
    .poll(async () => (await readNotes(mia)).length, { timeout: 5_000 })
    .toBe(0);
  await expect(mia.getByTestId('undo-button')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('TC-24 everyone undoing at once undoes exactly their own changes', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const actors = MAX_CONCURRENT_EDITORS;
  const { pages } = await openCrowd(browser, actors + 1, 'TC-24', testInfo.parallelIndex);
  const board = pages.slice(0, actors);
  const seeder = pages[actors]!;

  const errors: string[] = [];
  for (const page of pages) {
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }

  await Promise.all(pages.map((page) => settle(page)));

  // Two rows of five notes, all on screen at half scale from the origin:
  // a drag row and a typing row. Note i is *moved* by exactly one browser
  // and *typed into* by exactly one browser - so every change in the rest
  // of this test has a single, checkable author. Their texts carry their
  // seeded x, so "back home" is a fact a late reader can also verify.
  const xs = [-1000, -500, 0, 500, 1000];
  const MOVE_ROW_Y = -400;
  const TYPE_ROW_Y = 400;
  await seedNotes(seeder, [
    ...xs.map((x) => ({ x, y: MOVE_ROW_Y, text: `move ${x}` })),
    ...xs.map((x) => ({ x, y: TYPE_ROW_Y, text: `type ${x}` })),
  ]);
  await expectBoardSize(pages, 10);

  await Promise.all(
    board.map((page) => setCamera(page, { x: -1300, y: -700, zoom: 0.5 })),
  );

  // Each browser: drag its drag-row note right, pause past the capture
  // window - so move and typing are two personal steps, not one - then
  // type into its typing-row note. Sequential across browsers: by the time
  // browser four acts, the other nine changes it can see are all remote.
  // Each step is *confirmed* before the browser moves on: the dragged row
  // still displaced and the typed marker present mean the two personal
  // steps are real, and an undo round that fails later says so precisely.
  for (let index = 0; index < actors; index += 1) {
    const page = board[index]!;
    const x = xs[index]!;
    const centre = await screenPointOf(page, { x, y: MOVE_ROW_Y });
    await dragFrom(page, centre.x, centre.y, 60, 0);
    await page.waitForTimeout(700);
    const typeCentre = await screenPointOf(page, { x, y: TYPE_ROW_Y });
    await page.mouse.dblclick(typeCentre.x, typeCentre.y);
    await page.waitForTimeout(150);
    await page.keyboard.type(`p${index} was here`);
    await page.keyboard.press('Escape');
    await settle(page);
    await expect
      .poll(
        async () => {
          const notes = await readNotes(page);
          return withText(notes, `p${index} was here`) === 1;
        },
        { timeout: 8_000 },
      )
      .toBe(true);
  }

  // The board converges before any undo: every browser agrees on every
  // position and every text - all five drags and all five typings visible
  // everywhere. That agreement is what the undos must not break.
  await expect
    .poll(
      async () => {
        const snapshots = await Promise.all(board.map((page) => readNotes(page)));
        return (
          snapshots.length === actors &&
          snapshots.every(
            (notes) =>
              notes.length === 10 &&
              displaced(notes) === actors &&
              withText(notes, 'was here') === actors,
          )
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Round one: everyone presses undo at once. Each browser's own typing
  // is gone everywhere; the *dragged positions* are still displaced
  // everywhere they were dragged - undo only ever reached each browser's
  // own steps, and never a colleague's. And the undo buttons are still
  // enabled: nobody's history is drained, which is the part a "global
  // undo" could not pass.
  await Promise.all(board.map((page) => page.keyboard.press('ControlOrMeta+z')));
  await Promise.all(board.map((page) => settle(page)));
  await expect
    .poll(
      async () => {
        const snapshots = await Promise.all(board.map((page) => readNotes(page)));
        return (
          snapshots.length === actors &&
          snapshots.every(
            (notes) =>
              notes.length === 10 &&
              withText(notes, 'was here') === 0 &&
              displaced(notes) === actors,
          )
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  for (const page of board) {
    await expect(page.getByTestId('undo-button')).toBeEnabled();
  }

  // Round two: everyone undoes again - their own drag this time - and the
  // board converges back to the untouched baseline: ten notes, no text
  // edits anywhere, every dragged note home. Identical documents on five
  // screens, five personal histories, no cross-talk, no errors.
  await Promise.all(board.map((page) => page.keyboard.press('ControlOrMeta+z')));
  await Promise.all(board.map((page) => settle(page)));
  await expect
    .poll(
      async () => {
        const snapshots = await Promise.all(board.map((page) => readNotes(page)));
        const [first, ...rest] = snapshots;
        if (!first) return false;
        const clean = first.every(
          (note) => !note.text.includes('was here') && note.text.length > 0,
        );
        return (
          first.length === 10 &&
          home(first) &&
          clean &&
          rest.every((notes) => JSON.stringify(notes) === JSON.stringify(first))
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  for (const page of board) {
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  }
  expect(errors).toEqual([]);
});
