/**
 * Sharing a board by its link, end to end (TC-26 to TC-29, TC-31).
 *
 * These are the story's promises, tested the only way that counts: a real `wrangler dev`, a
 * real room, a real clipboard and a second browser that knows nothing except a string of
 * characters somebody sent it.
 *
 * What is asserted is the outcome, not the wait. `CREATE_BUDGET_MS` is measured and *reported*
 * rather than asserted, for the reason story 1 established and story 4 confirmed: this machine
 * runs the browser, the dev server and the Worker together, so a threshold it can meet would
 * pass on a slower box for the wrong reasons. The one promise about time that is asserted is
 * the one the product controls — a page that cannot reach the service keeps trying, and opens
 * the board the moment it can (TC-29).
 */

import { expect, test, type Page } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS } from '../../src/shared/config';
import {
  doubleClickBoard,
  getBoard,
  noteText,
  notes,
  stickyInput,
  stickyToolButton,
  waitForBoard
} from './helpers/board';
import { legacyBoardFixture } from './helpers/legacy-board';
import { connectionOf, createBoardOn, openBoardAt } from './helpers/participants';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Click New board and time it as far as a board that is really the person's: drawn, and in
 * sync with its room. The reload sentinel (below) proves nothing was reloaded on the way.
 */
async function clickNewBoard(page: Page): Promise<number> {
  const started = Date.now();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.locator('[data-vidi6="viewport"]')).toBeVisible();
  const drawn = Date.now() - started;
  await expect
    .poll(() => connectionOf(page), { message: 'the new board should be connected' })
    .toBe('connected');
  // Two numbers matter: when the board was on screen, and when it was really theirs. The
  // report gives the second, because that is the wait the person feels.
  console.log(`    board drawn after ${drawn}ms`);
  return Date.now() - started;
}

/** Something to type into the note a test is about to make. */
async function writeNote(page: Page, text: string, at = { x: 520, y: 360 }): Promise<void> {
  await doubleClickBoard(page, at.x, at.y);
  await page.keyboard.type(text);
  // Board space where no note is, which ends editing without making anything.
  await page.mouse.click(60, 640);
}

// TC-26 (the creating step on its own, and `share.link_stable`)
test('New board opens a board, in one address bar and no reload', async ({ page }) => {
  await page.goto('/');
  // A sentinel on the live page: if the app reached the board by loading a document, this
  // would be gone and the round trip would have cost a blank screen.
  await page.evaluate(() => {
    (window as unknown as { __noReload?: number }).__noReload = 1;
  });

  const elapsed = await clickNewBoard(page);

  const boardId = page.url().slice(`${BASE_URL}/b/`.length);
  expect(boardId, 'the address is a board link').toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(await getBoard(page)).toHaveLength(0);
  expect(
    await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)
  ).toBe(1);

  // And the address stands on its own: a browser refresh comes back to the same board rather
  // than to a blank page or to a new one. (`share.link_stable`)
  const link = page.url();
  await page.reload();
  await expect.poll(() => connectionOf(page)).toBe('connected');
  expect(page.url()).toBe(link);

  console.log(
    `  TC-26: click to a board of their own in ${elapsed}ms (budget ${CREATE_BUDGET_MS}ms, reported not asserted)`
  );
});

// TC-27
test('a link to a board nobody made leads to a way in, not a dead end', async ({ page }) => {
  // Well formed, and nobody ever made it: the interesting case, because the app has to have
  // asked and been told no.
  const missing = newBoardId();
  await page.goto(`/b/${missing}`);

  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  expect(await page.locator('[data-vidi6="viewport"]').count()).toBe(0);

  // One click, and the person is at a board rather than at an explanation.
  const elapsed = await clickNewBoard(page);
  expect(page.url(), 'a new board, not the dead link').not.toBe(`${BASE_URL}/b/${missing}`);
  expect(await getBoard(page)).toHaveLength(0);

  console.log(
    `  TC-27: Board not found to a board of their own in ${elapsed}ms (budget ${CREATE_BUDGET_MS}ms, reported not asserted)`
  );
});

// TC-26
test('create, share, join: the link is the way in, and the board is the same board', async ({
  browser
}) => {
  // The clipboard is part of the promise here, so it is granted rather than worked around — in
  // Chromium only, because that is the engine whose permission the design names. Firefox and
  // WebKit gate it differently, which is why `share.copy_fallback` exists; TC-29 covers the
  // denied case, and TC-23/TC-24 the missing-API case.
  const sharer = await browser.newContext({ viewport: VIEWPORT });
  await sharer.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  const sharerPage = await sharer.newPage();

  // Maya starts where anybody starts, at the address of the product rather than of a board.
  await sharerPage.goto('/');
  const started = Date.now();
  await sharerPage.getByRole('button', { name: 'New board' }).click();
  await waitForBoard(sharerPage);
  const boardId = sharerPage.url().slice(`${BASE_URL}/b/`.length);
  console.log(
    `  TC-26: Maya's click to a board of her own in ${Date.now() - started}ms ` +
      `(budget ${CREATE_BUDGET_MS}ms, reported not asserted)`
  );

  await writeNote(sharerPage, 'the thing Maya wrote');
  await expect(noteText(sharerPage, 0)).toContainText('the thing Maya wrote');

  await sharerPage.getByRole('button', { name: 'Share' }).click();
  const shown = await sharerPage.locator('.vidi6-share__link').inputValue();
  expect(shown, 'the panel shows the whole address').toBe(`${BASE_URL}/b/${boardId}`);

  await sharerPage.getByRole('button', { name: 'Copy link' }).click();
  await expect(sharerPage.getByRole('button', { name: /link copied/i })).toBeVisible();
  await sharerPage.bringToFront();
  const copied = await sharerPage.evaluate(() => navigator.clipboard.readText());
  expect(copied, 'what is in the clipboard is what the panel showed').toBe(shown);

  // A second browser: a different context, so nothing but the link can get it there.
  const joiner = await browser.newContext({ viewport: VIEWPORT });
  const joinerPage = await joiner.newPage();
  await joinerPage.goto(copied);
  await expect.poll(() => connectionOf(joinerPage)).toBe('connected');
  await expect(noteText(joinerPage, 0)).toContainText('the thing Maya wrote');

  // The same board, not a copy of it: what the joiner writes reaches the sharer.
  await writeNote(joinerPage, 'and from the other side', { x: 700, y: 500 });
  await expect(noteText(sharerPage, 1)).toContainText('and from the other side');

  await sharer.close();
  await joiner.close();
});

// TC-28
test('a service that does not answer is waited out, and the board opens when it can', async ({
  page
}) => {
  const boardId = await createBoardOn();

  // The check fails the way a real outage fails it: an answer that says nothing worked, and
  // takes a moment to say it, so "Opening board…" is something a test can catch.
  // Counted off the page rather than off the route handler: the request that succeeds is the
  // second one, and it is the pair that says the page kept asking.
  let asked = 0;
  page.on('request', (request) => {
    if (/\/api\/boards\//.test(request.url())) asked += 1;
  });
  await page.route('**/api/boards/*', async (route) => {
    // A real outage takes a moment to say nothing, and the moment is what makes
    // "Opening board…" catchable rather than a flicker.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error"}' });
  });

  await page.goto(`/b/${boardId}`);
  await expect(page.getByText('Opening board…')).toBeVisible();
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
  expect(page.url(), 'still at the link they were given').toBe(`${BASE_URL}/b/${boardId}`);
  expect(await page.locator('[data-vidi6="viewport"]').count()).toBe(0);

  // The service comes back, and nobody has to do anything.
  await page.unroute('**/api/boards/*');
  await expect(page.locator('[data-vidi6="viewport"]')).toBeVisible();
  await expect.poll(() => connectionOf(page)).toBe('connected');
  expect(asked, 'the page kept asking rather than giving up').toBeGreaterThanOrEqual(2);
});

// TC-29
test('a clipboard that says no hands over the link, selected, instead', async ({ page }) => {
  const boardId = await createBoardOn();

  // Stubbed before the app's own script runs, which is what a denial looks like from inside a
  // page: the API is there, and the write comes back refused.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) }
    });
  });
  await page.goto(`/b/${boardId}`);
  await waitForBoard(page);

  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();

  // Not "Copy failed": nothing has stopped working, and the text is already where the next
  // keystroke will find it.
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
  const field = await page.locator('.vidi6-share__link').evaluate((element) => {
    const input = element as HTMLInputElement;
    return {
      value: input.value,
      selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
      focused: document.activeElement === input
    };
  });
  expect(field.value).toBe(`${BASE_URL}/b/${boardId}`);
  expect(field.selected, 'the whole link, not part of it').toBe(true);
  expect(field.focused, 'the caret is where Ctrl+C will be pressed').toBe(true);
});

// TC-31
test('a board made before boards had a beginning opens, and is editable', async ({
  page,
  request
}) => {
  // A board as story 2 would have left it: updates, no `created_at`, no board id in the
  // document. Test-only route, and the only way to make the past on demand.
  const legacy = legacyBoardFixture();
  const seeded = await request.post(`/__test/boards/${legacy.id}/seed-legacy`, {
    // Plain JSON all the way down: a `Uint8Array` stringifies into an object, so the updates
    // travel as arrays of byte values, which is what the room reads.
    data: { updates: legacy.updates.map((update) => [...update]) }
  });
  expect(seeded.status()).toBe(200);
  const seededBody = await seeded.json();
  expect(seededBody.ok, JSON.stringify(seededBody)).toBe(true);
  expect(seededBody.rows, 'the old log has to actually be in there').toBeGreaterThanOrEqual(1);

  // `share.unopened_then_editable`: it opens, and the person can write on it.
  await openBoardAt(page, legacy.id);
  await expect(notes(page)).toHaveCount(1);
  await expect(noteText(page, 0)).toContainText('written before boards had a beginning');

  await stickyToolButton(page).click();
  const editor = stickyInput(page);
  await expect(editor).toBeVisible();
  await editor.fill('added after the migration');
  await page.mouse.click(60, 640);
  await expect(notes(page)).toHaveCount(2);

  // And a second person on the same old board sees the new note too: the migrated board is
  // the one live board, not a copy somebody can write to in private.
  const visitor = await page.context().browser()!.newContext({ viewport: VIEWPORT });
  const visitorPage = await visitor.newPage();
  await visitorPage.goto(`${BASE_URL}/b/${legacy.id}`);
  await expect.poll(() => connectionOf(visitorPage)).toBe('connected');
  await expect(visitorPage.locator('[data-vidi6="sticky"]')).toHaveCount(2);
  await visitor.close();
});
