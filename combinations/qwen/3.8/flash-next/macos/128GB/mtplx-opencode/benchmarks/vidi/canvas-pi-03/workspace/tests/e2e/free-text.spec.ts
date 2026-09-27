// Story 9 — free text anywhere on the board, in a real browser.
//
// These are the workflows the story is actually about: arming the Text tool
// with a real key press, placing text with real clicks and handle drags,
// wrapping measured by a real canvas font, and more than one person typing
// into the same block through the real sync server. The document is read back
// through the test-only window.__vidi6 hook; every interaction is a real
// Playwright input, because the behaviour under test (does the tool spend
// itself, does the box wrap at 600 CSS pixels, do two writers keep all their
// characters) only exists in the browser.

import { expect, test, type Page } from '@playwright/test';
import {
  allSnaps,
  marqueeDrag,
  mouseDrag,
  objectsSnapshot,
  openBoard,
  placeTextByTool,
  seedText,
  selectionIds,
  textBlocks,
  textBox,
  textCenter,
  toolState,
  typeText,
  waitConverged,
} from './helpers/board';
import { openRoom } from './helpers/live';
import { TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_PADDING_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { LONG_PROSE, SHORT_PHRASE } from '../fixtures/texts';

/** One text block's stored state, read from the page's own document. */
async function blockState(page: Page, id: string) {
  return page.evaluate((blockId) => window.__vidi6!.textBlock(blockId), id);
}

/** Wait until this page's document holds exactly n text blocks. */
async function waitForTextCount(page: Page, n: number, timeout = 10_000): Promise<void> {
  await expect.poll(() => textBlocks(page).then((b) => b.length), { timeout, intervals: [50] }).toBe(n);
}

test('TC-24 the Text tool places text, and only text', async ({ page }) => {
  await openBoard(page);

  // T arms the tool: the palette's Text button reads as pressed and the board
  // takes a text cursor.
  await page.keyboard.press('t');
  await expect.poll(() => toolState(page)).toBe('text');
  await expect(page.getByTestId('tool-text')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'text');

  // The next click writes a text block — not a sticky note — and the tool
  // spends itself on it.
  await page.mouse.click(420, 240);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await expect.poll(() => toolState(page)).toBe('select');
  const written = await objectsSnapshot(page);
  expect(written.length).toBe(1);
  expect(written[0].type).toBe('text');

  // Typing goes into the block that was just placed.
  await page.keyboard.type('Went well');
  await page.keyboard.press('Escape');
  const [block] = await textBlocks(page);
  expect(block.text).toBe('Went well');

  // Escape leaves the tool again: a second T is needed to place another block.
  await page.mouse.click(900, 620);
  expect(await toolState(page)).toBe('select');
  expect((await objectsSnapshot(page)).length).toBe(1);
});

test('TC-25 a long annotation wraps at 600 instead of running onto one line', async ({ page }) => {
  await openBoard(page);

  // A short heading stays exactly as wide as its own text.
  await placeTextByTool(page, 120, 140);
  await page.keyboard.type(SHORT_PHRASE);
  await page.keyboard.press('Escape');
  const [short] = await textBlocks(page);
  expect(short.width).toBeLessThan(TEXT_MAX_AUTO_WIDTH_WORLD);

  // A 1,000-character paragraph is wider than the cap, so it wraps inside the
  // cap and grows downwards instead of sideways.
  await placeTextByTool(page, 120, 260);
  await page.getByTestId('text-editor').fill(LONG_PROSE);
  await page.keyboard.press('Escape');
  await waitForTextCount(page, 2);

  const long = (await textBlocks(page)).find((b) => b.text === LONG_PROSE)!;
  expect(long.width, 'auto width never exceeds the cap').toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 1);
  const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
  expect(long.height, 'the paragraph is drawn on several lines').toBeGreaterThan(8 * lineHeight);
  expect(long.height, 'the box grew downwards, not sideways').toBeGreaterThan(long.width / 2);

  // The drawn box and the stored footprint are the same size at zoom 1.
  const drawn = await textBox(page, long.id);
  expect(drawn.width).toBeCloseTo(long.width, 0);
  expect(drawn.height).toBeCloseTo(long.height, 0);
});

test('TC-26 dragging the right handle pins the width and the text rewraps', async ({ page }) => {
  await openBoard(page);

  await placeTextByTool(page, 100, 60);
  await page.getByTestId('text-editor').fill(LONG_PROSE);
  await page.keyboard.press('Escape');
  const before = (await textBlocks(page))[0];
  expect(before.widthMode).toBe('auto');

  // A text block offers only its two width handles: its height follows the
  // text, so a top or bottom handle would fight the layout.
  await expect(page.getByTestId('handle-e')).toBeVisible();
  await expect(page.getByTestId('handle-w')).toBeVisible();
  await expect(page.getByTestId('handle-se')).toHaveCount(0);
  await expect(page.getByTestId('handle-nw')).toHaveCount(0);

  const handle = await page.getByTestId('handle-e').boundingBox();
  expect(handle).not.toBeNull();
  await mouseDrag(page, handle!.x + handle!.width / 2, handle!.y + handle!.height / 2, -200, 0);

  const after = await blockState(page, before.id);
  expect(after!.widthMode, 'a handle drag pins the width').toBe('fixed');
  expect(Math.abs(after!.width - (before.width - 200)), 'the width follows the drag').toBeLessThanOrEqual(2);
  expect(after!.height, 'the same words now need more lines').toBeGreaterThan(before.height);

  // And the handles are still only the horizontal pair.
  await expect(page.getByTestId('handle-e')).toBeVisible();
  await expect(page.getByTestId('handle-se')).toHaveCount(0);
});

test('TC-27 golden path: type a heading, make it XL, drag it narrower, delete and undo', async ({ page }) => {
  await openBoard(page);

  // A heading typed straight after the tool click, including a newline.
  await placeTextByTool(page, 160, 120);
  await page.keyboard.type('Weekly retro');
  await page.keyboard.press('Enter');
  await page.keyboard.type('What felt slow');
  await page.keyboard.press('Escape');
  const created = (await textBlocks(page))[0];
  expect(created.text).toBe('Weekly retro\nWhat felt slow');
  expect(created.size).toBe('M');
  const heightBefore = created.height;

  // The size stepper, then a narrower fixed width.
  await expect(page.getByTestId('text-toolbar')).toBeVisible();
  await page.getByTestId('text-size-XL').click();
  const grown = await blockState(page, created.id);
  expect(grown!.size).toBe('XL');
  expect(grown!.height, 'the box re-measures at the new font size').toBeGreaterThan(heightBefore);

  const handle = await page.getByTestId('handle-e').boundingBox();
  await mouseDrag(page, handle!.x + handle!.width / 2, handle!.y + handle!.height / 2, -120, 0);
  const pinned = await blockState(page, created.id);
  expect(pinned!.widthMode).toBe('fixed');

  // Delete removes the block, one Ctrl+Z brings text and box back together.
  await page.keyboard.press('Delete');
  await waitForTextCount(page, 0);
  await page.keyboard.press('Control+z');
  await waitForTextCount(page, 1);
  const restored = (await textBlocks(page))[0];
  expect(restored.text).toBe('Weekly retro\nWhat felt slow');
});

test('TC-28 two people typing into one block keep every character on both screens', async ({ browser, request }) => {
  const { createBoard } = await import('./helpers/board');
  const room = await createBoard(request);
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const [alice, bob] = await Promise.all([contextA.newPage(), contextB.newPage()]);
  await Promise.all([openRoom(alice, room), openRoom(bob, room)]);

  // One block, seeded once and synced to both screens.
  const id = await seedText(alice, 640, 300);
  expect(id).not.toBeNull();
  await waitConverged([alice, bob], 8_000);

  // Both open the SAME block in their own editors.
  for (const p of [alice, bob]) {
    const c = await textCenter(p, id!);
    await p.mouse.dblclick(c.x, c.y);
    await expect(p.getByTestId('text-editor')).toBeVisible();
  }

  // Type at the same time: the merge, not a lock, has to keep both inputs.
  await Promise.all([
    alice.getByTestId('text-editor').pressSequentially('AAAA', { delay: 15 }),
    bob.getByTestId('text-editor').pressSequentially('BBBB', { delay: 15 }),
  ]);

  await waitConverged([alice, bob], 8_000);
  const [fromAlice, fromBob] = await Promise.all([blockState(alice, id!), blockState(bob, id!)]);
  expect(fromAlice!.text).toBe(fromBob!.text);
  expect(fromAlice!.text).toContain('AAAA');
  expect(fromAlice!.text).toContain('BBBB');
  // The box is measured once by its author and shared: both screens agree.
  expect(fromAlice!.width).toBe(fromBob!.width);
  expect(fromAlice!.height).toBe(fromBob!.height);

  // Bob's still-open editor shows the merged text live.
  await expect(bob.getByTestId('text-editor')).toHaveValue(fromAlice!.text);

  await contextA.close();
  await contextB.close();
});

test('TC-29 everyone adds a heading at once and every screen ends with all of them', async ({ browser, request }) => {
  const { createBoard } = await import('./helpers/board');
  const room = await createBoard(request);
  const pages: Page[] = [];
  for (let i = 0; i < 5; i += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    pages.push(await ctx.newPage());
  }
  await Promise.all(pages.map((p) => openRoom(p, room)));

  // Five separate clients, five tool arming sequences, five headings — the
  // points are far apart so no client clicks on a block another one just made.
  const points = [
    [180, 140],
    [700, 140],
    [1000, 300],
    [180, 430],
    [700, 540],
  ];
  await Promise.all(
    pages.map(async (page, i) => {
      await page.keyboard.press('t');
      await page.mouse.click(points[i][0], points[i][1]);
      await page.getByTestId('text-editor').waitFor({ state: 'visible' });
      await page.keyboard.type(`Heading ${i}`);
      await page.keyboard.press('Escape');
    }),
  );

  await waitConverged(pages, 10_000);
  for (const page of pages) {
    await waitForTextCount(page, 5, 5_000);
    const blocks = await textBlocks(page);
    expect(blocks.map((b) => b.text).sort()).toEqual(['Heading 0', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4']);
  }

  // Every screen's whole document state is identical (toolbars aside, that is
  // what "all headings visible on all screens" means for the model).
  expect(new Set(await allSnaps(pages)).size).toBe(1);

  await Promise.all(pages.map((p) => p.context().close()));
});

test('TC-30 text left empty is not left on the board', async ({ page }) => {
  await openBoard(page);

  // A tool click with nothing typed in it: the block goes away with the editor.
  await placeTextByTool(page, 400, 300);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => objectsSnapshot(page).then((s) => s.length)).toBe(0);

  // So a marquee dragged over that same area has nothing to select…
  await marqueeDrag(page, 380, 280, 220, 120);
  expect((await selectionIds(page)).length).toBe(0);

  // …while the identical gesture over a block that DOES have text selects it.
  await placeTextByTool(page, 400, 300);
  await page.keyboard.type('Real text');
  await page.keyboard.press('Escape');
  await page.mouse.click(20, 700); // clear the selection first
  await marqueeDrag(page, 380, 280, 240, 120);
  const selected = await selectionIds(page);
  expect(selected.length).toBe(1);

  // And the abandoned point is still ordinary board: a double-click there
  // makes the note it always made, so no invisible box is sitting on it.
  await page.mouse.click(20, 700);
  await page.mouse.dblclick(500, 640);
  await expect.poll(() => objectsSnapshot(page).then((s) => s.filter((o) => o.type === 'sticky').length)).toBe(1);
});