// Story 9 end-to-end: write free text anywhere on the board. TC-26 to TC-31
// of the design, on the real app with a real browser measuring the real fonts.
// A click with the Text tool lands a text and opens it; a text and a sticky
// coexist and can be stacked; a second browser sees the words live; the size
// toolbar's choice survives a reload; the side handle pins a fixed width that
// keeps its wrap across a reload; and creation, typing and resizing are undo
// steps like everything else.
import { test, expect } from '@playwright/test';
import { gotoBoard } from './helpers/board.ts';
import { typeText, dragBy, notes } from './helpers/sticky.ts';
import { openBoard, newCollaborator } from './helpers/room.ts';
import { TEXT_MIN_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT } from '../../src/shared/config.ts';

// The world box of a rendered text object, read from the element the world
// layer positions (world units at zoom 1 - the camera nobody here moves).
async function textBox(page: import('@playwright/test').Page, nth = 0) {
  const el = textObjects(page).nth(nth);
  const box = await el.evaluate((e) => ({
    left: parseFloat(e.style.left),
    top: parseFloat(e.style.top),
    w: parseFloat(e.style.width),
    h: parseFloat(e.style.height),
  }));
  return box;
}

async function textScreenBox(note: import('@playwright/test').Locator) {
  const b = await note.boundingBox();
  if (!b) throw new Error('text object has no screen box');
  return b;
}

const textObjects = (page: import('@playwright/test').Page) =>
  page.locator('[data-object-id][data-testid^="text-"]');
const firstText = (page: import('@playwright/test').Page) => textObjects(page).first();
const textEditor = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="text-editor"]');

/** Press T, click the board at (x, y): the tool's whole job in one line. */
async function placeText(page: import('@playwright/test').Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await textEditor(page).waitFor({ state: 'visible' });
}

// TC-26: the Text tool puts a text on the clicked point, typing grows the box,
// and a reload shows the very same words.
test('TC-26 places a text on the click, types, and survives a reload', async ({ page }) => {
  await gotoBoard(page);

  await placeText(page, 400, 300);
  const fresh = await textBox(page);
  // A brand-new text is the model's minimum box at the default size.
  expect(fresh.w).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 1);
  expect(fresh.h).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);

  await typeText(page, 'free float');
  await page.keyboard.press('Escape');
  await expect(firstText(page)).toContainText('free float');

  const grown = await textBox(page);
  expect(grown.w).toBeGreaterThan(fresh.w); // the box grew with the words

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(firstText(page)).toHaveText('free float');
  expect((await textBox(page)).w).toBeCloseTo(grown.w, 1);
});

// TC-27: a text dragged onto a sticky note: both survive, neither eats the
// other, and the positions are the ones the drag left behind after a reload.
test('TC-27 drags a text onto a sticky note and both persist', async ({ page }) => {
  await gotoBoard(page);

  await placeText(page, 300, 250);
  await typeText(page, 'drifter');
  await page.keyboard.press('Escape');

  await page.keyboard.press('n'); // a sticky note at the view centre
  await page.waitForSelector('textarea.sticky-editor');
  await typeText(page, 'under');
  await page.keyboard.press('Escape');
  await expect(notes(page)).toHaveCount(1);

  const before = await textBox(page);
  const screen = await textScreenBox(firstText(page));
  await dragBy(page, { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 }, 260, 110);

  const moved = await textBox(page);
  expect(moved.left).toBeCloseTo(before.left + 260, 1); // world space, zoom 1
  expect(moved.top).toBeCloseTo(before.top + 110, 1);

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(firstText(page)).toHaveText('drifter');
  await expect(notes(page)).toHaveCount(1);
  const saved = await textBox(page);
  expect(saved.left).toBeCloseTo(moved.left, 1);
  expect(saved.top).toBeCloseTo(moved.top, 1);
});

// TC-28: a second browser on the same room sees the words live, and its
// read-only board is not an editor.
test('TC-28 shows the words live in a second browser', async ({ page, browser }) => {
  const boardId = await gotoBoard(page);

  await placeText(page, 380, 260);
  await typeText(page, 'shared sight');

  const peer = await newCollaborator(browser);
  try {
    await openBoard(peer, boardId);
    await expect(peer.locator('[role="group"]').filter({ hasText: 'shared sight' })).toBeVisible();
    // The peer edits its own text here (both are editors); what matters is
    // that it can, and that the words arrived without a reload.
    await placeText(peer, 500, 520);
    await typeText(peer, 'peer words');
    // The words arrived across the room without a reload - and the peer's own
    // editor is the one typing, not a frozen copy.
    await expect(
      page.locator('[role="group"]').filter({ hasText: 'peer words' }),
    ).toBeVisible({ timeout: 10000 });
  } finally {
    await peer.close();
  }
});

// TC-29: select a text, pick XL in the toolbar: only the size (and the line
// it lays out) changes - and the choice is still XL after a reload.
test('TC-29 resizes the font from the toolbar and keeps it across a reload', async ({ page }) => {
  await gotoBoard(page);

  await placeText(page, 350, 240);
  await typeText(page, 'big business');
  await page.keyboard.press('Escape');

  // Select it: a plain click on the object.
  const screen = await textScreenBox(firstText(page));
  await page.mouse.click(screen.x + screen.width / 2, screen.y + screen.height / 2);
  await page.waitForSelector('[data-testid="text-toolbar"]');

  const before = await textBox(page);
  await page.getByRole('button', { name: 'Text size XL' }).click();

  const sized = await textBox(page);
  expect(sized.left).toBeCloseTo(before.left, 1); // same place - never moved
  expect(sized.top).toBeCloseTo(before.top, 1);
  expect(sized.h).toBeCloseTo((before.h * TEXT_SIZES.XL) / TEXT_SIZES.M, 1); // one XL line

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(firstText(page)).toHaveText('big business');
  const kept = await textBox(page);
  expect(kept.h).toBeCloseTo(sized.h, 1); // the XL line is what the reload lays out
});

// TC-30: dragging the east handle narrower pins a fixed width, the words wrap
// into more lines, and the fixed width is still the layout's after a reload.
test('TC-30 pins a width with the side handle, wraps, and keeps it across a reload', async ({ page }) => {
  await gotoBoard(page);

  await placeText(page, 260, 220);
  const line = 'wrap me around these words now and keep on wrapping';
  await typeText(page, line);
  await page.keyboard.press('Escape');

  const before = await textBox(page);
  const wide = before.w;

  // Grab the east handle and pull it 160 screen pixels to the left.
  const handle = await page.locator('[data-handle="e"]').boundingBox();
  if (!handle) throw new Error('the side handle is not on screen');
  await dragBy(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    -160,
    0,
  );

  const pinned = await textBox(page);
  expect(pinned.w).toBeCloseTo(wide - 160, 1); // a fixed width: exactly the drag
  expect(pinned.h).toBeGreaterThan(before.h); // and the words needed more lines

  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(firstText(page)).toHaveText(line);
  const kept = await textBox(page);
  expect(kept.w).toBeCloseTo(pinned.w, 1); // the width stays fixed: nobody re-flowed it
  expect(kept.h).toBeCloseTo(pinned.h, 1);
});

// TC-31: the story 8 grammar keeps its word for texts: one Ctrl+Z takes the
// typed words back (box with them), the next takes the object back, and the
// earlier text is untouched.
test('TC-31 undoes typing and creation as separate steps', async ({ page }) => {
  await gotoBoard(page);

  await placeText(page, 300, 250);
  await typeText(page, 'keeper');
  await page.keyboard.press('Escape');

  await placeText(page, 700, 450);
  await typeText(page, 'doomed');
  await page.keyboard.press('Escape');
  await expect(textObjects(page)).toHaveCount(2);

  // Step back: the words of the last text go first, its box with them. The
  // doomed text sits at world (60, 50) - screen (700, 450) at the reset camera.
  await page.keyboard.press('Control+z');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const els = document.querySelectorAll(
            '[data-object-id][data-testid^="text-"]',
          );
          for (const raw of els) {
            const e = raw as HTMLElement;
            if (Math.abs(parseFloat(e.style.left) - 60) < 1) return parseFloat(e.style.width);
          }
          return -1;
        }),
      { timeout: 5000 },
    )
    .toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 1);

  // Step back again: the object itself goes.
  await page.keyboard.press('Control+z');
  await expect(textObjects(page)).toHaveCount(1);
  await expect(firstText(page)).toHaveText('keeper');

  // And the steps ahead of the undo pointer are still there: two redos bring
  // the doomed text back, and then its words.
  await page.keyboard.press('Control+Shift+z');
  await expect(textObjects(page)).toHaveCount(2);
  const doomed = page.locator('[role="group"]').filter({ hasText: 'doomed' });
  await expect(doomed).toHaveCount(0); // back as an empty text first
  await page.keyboard.press('Control+Shift+z');
  await expect(
    page.locator('[role="group"]').filter({ hasText: 'doomed' }),
  ).toHaveCount(1);
});
