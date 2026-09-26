// Story 5 — sharing a board with a link (e2e).
//
// Everything here goes through the REAL stack: a real POST /api/boards, a real
// Durable Object per board, a real clipboard, and separate browser contexts for
// the two people. The story's whole premise is that a link is a durable object
// reference — "copy in one app, paste in another" — which only means something
// if the paste target is a different profile with its own sockets.
//
// Boards a test needs are created through the API (helpers/board.ts), because
// story 5 removed implicit board creation: an unknown id is a 404, not a board.

import { expect, test } from '@playwright/test';
import { createBoard, snapshot, seedSticky } from './helpers/board';
import { typeStickyViaDoc } from './helpers/live';
import {
  ORIGIN,
  boardIdOf,
  copyBoardLink,
  openLink,
  selectedLink,
  shareContext,
} from './helpers/share';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { buildBoardUpdates } from '../fixtures/boards';

// Clipboard reads need the page focused, and the first create of a run pays
// for a cold workerd; both are why a couple of these get a longer budget.
test.describe.configure({ timeout: 120_000 });

test('TC-26 Maya creates a board, copies its link, and Sam joins by opening what he pasted', async ({ browser }) => {
  const mayaContext = await shareContext(browser, 1);
  const maya = await mayaContext.newPage();
  await maya.goto(`${ORIGIN}/`);
  // Warm the create path (one throwaway board, limiter bypassed) so the timed
  // section measures the app, not a cold runtime.
  await createBoard(maya.request);

  const t0 = Date.now();
  await maya.getByTestId('create-board').click();
  await expect(maya.getByTestId('board-page')).toBeVisible();
  const elapsed = Date.now() - t0;
  expect(elapsed, `create → board took ${elapsed}ms (budget ${CREATE_BUDGET_MS}ms)`).toBeLessThanOrEqual(
    CREATE_BUDGET_MS,
  );

  const boardId = boardIdOf(maya.url());
  expect(isValidBoardId(boardId), boardId).toBe(true);

  // Maya makes a note the real way (double-click on empty board space). It is
  // in the document BEFORE she copies, so what Sam sees is what she saw.
  await maya.mouse.dblclick(420, 300);
  await expect.poll(() => snapshot(maya).then((s) => s.length)).toBe(1);

  // The link goes through the clipboard, not out of React state.
  const link = await copyBoardLink(maya);
  expect(link).toBe(`${ORIGIN}/b/${boardId}`);

  // Sam: a separate context, no shared storage, nothing ever loaded before.
  const samContext = await shareContext(browser, 2);
  const sam = await openLink(samContext, link);
  await expect(sam.getByTestId('board-page')).toBeVisible();
  await expect
    .poll(() => snapshot(sam).then((s) => s.map((n) => n.id).join(',')), { timeout: 15_000 })
    .toBe((await snapshot(maya)).map((n) => n.id).join(','));

  // Share BACK: Sam edits the same note, Maya sees it inside the live-update
  // budget (nobody reloads, nobody reopens anything).
  const noteId = (await snapshot(maya))[0].id;
  await typeStickyViaDoc(sam, noteId, ' (from Sam)');
  await expect
    .poll(() => snapshot(maya).then((s) => s[0]?.text ?? ''), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toContain('(from Sam)');

  // And a note Sam creates arrives on Maya's screen the same way.
  await seedSticky(sam, 320, 40);
  await expect
    .poll(() => snapshot(maya).then((s) => s.length), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toBe(2);

  await mayaContext.close();
  await samContext.close();
});

test('TC-26b a link made by one client is a real board for a second client (round trip)', async ({ browser, request }) => {
  // Maya's board, created by HER (not by the test rig): Sam must be able to
  // join a board he never created, and edit it.
  const mayaContext = await shareContext(browser, 11);
  const maya = await mayaContext.newPage();
  await maya.goto(`${ORIGIN}/`);
  await maya.getByTestId('create-board').click();
  await expect(maya.getByTestId('board-page')).toBeVisible();
  const link = await copyBoardLink(maya);
  const createdFor = boardIdOf(link);
  expect(await request.get(`${ORIGIN}/api/boards/${createdFor}`).then((r) => r.status())).toBe(200);

  const samContext = await shareContext(browser, 12);
  const sam = await openLink(samContext, link);
  await expect(sam.getByTestId('board-page')).toBeVisible();

  // Sam writes first; Maya must receive it on the same document.
  await seedSticky(sam, -260, 60);
  await expect
    .poll(() => snapshot(maya).then((s) => s.length), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toBe(1);

  // Maya writes back and Sam receives it — the link did not hand Sam a
  // private copy.
  await seedSticky(maya, 260, -60);
  await expect
    .poll(() => snapshot(sam).then((s) => s.length), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toBe(2);

  // Sam's URL still names Maya's board: no new board, no redirect.
  expect(boardIdOf(sam.url())).toBe(createdFor);

  await mayaContext.close();
  await samContext.close();
});

test('TC-27 an unknown link says Board not found, and Create a new board makes a different board', async ({ browser }) => {
  const ghost = newBoardId(); // valid SHAPE, never created
  const context = await shareContext(browser, 3);
  const page = await openLink(context, `${ORIGIN}/b/${ghost}`);

  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();

  // Probing must not create anything: the same link is still unknown.
  const recheck = await page.request.get(`${ORIGIN}/api/boards/${ghost}`);
  expect(recheck.status()).toBe(404);
  // …and a socket to that address is refused, so nobody can quietly start a
  // board there by connecting.
  const upgrade = await page.request.get(`${ORIGIN}/api/rooms/${ghost}`);
  expect(upgrade.status()).toBe(426); // (no Upgrade header here; the point is: never 101)

  // Recover: the not-found page's own button makes a NEW board.
  await page.getByTestId('create-board').click();
  await expect(page.getByTestId('board-page')).toBeVisible();
  const fresh = boardIdOf(page.url());
  expect(fresh).not.toBe(ghost);
  expect(isValidBoardId(fresh), fresh).toBe(true);
  expect((await snapshot(page)).length).toBe(0);

  await context.close();
});

test('TC-27b a malformed id is not even looked up', async ({ browser }) => {
  const context = await shareContext(browser, 4);
  const page = await context.newPage();
  const lookedUp: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/boards')) lookedUp.push(request.url());
  });

  for (const bad of ['abc', 'A'.repeat(21), 'A'.repeat(23), 'has space']) {
    await page.goto(`${ORIGIN}/b/${encodeURIComponent(bad)}`);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  }
  // Nothing was probed, so nothing can be leaked or created by a bad link.
  expect(lookedUp).toEqual([]);

  await context.close();
});

test('TC-28 an unreachable service retries, and the board opens without a reload', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const context = await shareContext(browser, 5);
  const page = await context.newPage();

  // Out: every existence check for this page fails at the network layer.
  await page.route('**/api/boards/**', (route) => route.abort());
  await page.goto(`${ORIGIN}/b/${boardId}`);
  await expect(page.getByTestId('unreachable-board')).toBeVisible();
  await expect(page.getByTestId('unreachable-board')).toContainText('Retrying');
  // The board UI must NOT be mounted while the check is failing.
  await expect(page.getByTestId('board-page')).toHaveCount(0);

  // Mark the document, then let the service come back.
  await page.evaluate(() => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
  });
  await page.unroute('**/api/boards/**');

  await expect(page.getByTestId('board-page')).toBeVisible({ timeout: 20_000 });
  // Same document object: the retry recovered in place, no reload happened.
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(
    true,
  );

  await context.close();
});

test('TC-29 a refused clipboard selects the whole link instead of failing', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const context = await shareContext(browser, 6, { clipboardDenied: true });
  const page = await openLink(context, `${ORIGIN}/b/${boardId}`);
  await expect(page.getByTestId('board-page')).toBeVisible();

  await page.getByTestId('share-button').click();
  await page.getByTestId('copy-link').click();

  await expect(page.getByTestId('manual-copy-message')).toBeVisible();
  await expect(page.getByTestId('manual-copy-message')).toHaveText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );
  // The whole link is selected and focused, ready for a manual Ctrl+C.
  const link = `${ORIGIN}/b/${boardId}`;
  expect(await selectedLink(page)).toBe(link);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
    'share-link-field',
  );

  await context.close();
});

test('TC-29b with no clipboard API at all, the same fallback appears', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const context = await shareContext(browser, 7, { noClipboard: true });
  const page = await openLink(context, `${ORIGIN}/b/${boardId}`);
  await expect(page.getByTestId('board-page')).toBeVisible();

  await page.getByTestId('share-button').click();
  await page.getByTestId('copy-link').click();

  await expect(page.getByTestId('manual-copy-message')).toBeVisible();
  expect(await selectedLink(page)).toBe(`${ORIGIN}/b/${boardId}`);

  await context.close();
});

test('TC-30 past the create limit the app says so instead of spinning', async ({ browser }) => {
  // A random key per run: the limiter bucket is per visitor, and re-running
  // this spec inside 60s would otherwise inherit a half-drained bucket.
  const context = await shareContext(browser, 1 + Math.floor(Math.random() * 254));
  const page = await context.newPage();
  const outcomes: string[] = [];

  // One visitor, one limiter bucket: BOARD_CREATE_LIMIT boards are allowed,
  // then the app must report the refusal (and never navigate to a fake board).
  for (let attempt = 0; attempt < BOARD_CREATE_LIMIT + 2; attempt += 1) {
    await page.goto(`${ORIGIN}/`);
    await page.getByTestId('create-board').click();
    const settled = await Promise.race([
      page
        .getByTestId('board-page')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'board' as const),
      page
        .getByTestId('create-message')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => 'refused' as const),
    ]).catch(() => 'stalled' as const);
    outcomes.push(settled);
    if (settled !== 'board') break;
  }

  expect(outcomes, `create outcomes: ${outcomes.join(',')}`).toContain('refused');
  // The boundary itself, not just "a refusal happened sometime": exactly the
  // limit is allowed for this visitor, and the next attempt is the refused one.
  expect(outcomes.filter((o) => o === 'board').length, `create outcomes: ${outcomes.join(',')}`).toBe(
    BOARD_CREATE_LIMIT,
  );
  await expect(page.getByTestId('create-message')).toHaveText(/too quickly/);
  // The button stays usable: the visitor is not stuck.
  await expect(page.getByTestId('create-board')).toBeEnabled();
  // And they were never moved off the home page by a refused create.
  expect(page.url()).toBe(`${ORIGIN}/`);

  await context.close();
});

test('TC-31 a pre-story-5 board (content but no created_at) still opens', async ({ browser, request }) => {
  const boardId = newBoardId();
  const { updates, expected } = buildBoardUpdates(4);

  // The legacy shape: stored updates, no created_at stamp. Only reachable with
  // TEST_HOOKS on the dev server (playwright.config.ts).
  for (const update of updates) {
    const seeded = await request.post(`${ORIGIN}/__test/rooms/${boardId}/legacy-seed`, {
      data: Buffer.from(update),
      headers: { origin: ORIGIN, referer: `${ORIGIN}/` },
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);
  }

  // …which the existence rule counts as a board (share.legacy_boards).
  const check = await request.get(`${ORIGIN}/api/boards/${boardId}`);
  expect(check.status()).toBe(200);

  const context = await shareContext(browser, 9);
  const page = await openLink(context, `${ORIGIN}/b/${boardId}`);
  await expect(page.getByTestId('board-page')).toBeVisible();
  await expect(page.getByTestId('not-found-page')).toHaveCount(0);

  // The seeded notes are on the board, and Sam can add to them.
  await expect
    .poll(() => snapshot(page).then((s) => s.length), { timeout: 20_000 })
    .toBe(expected.length);
  await seedSticky(page, 0, 0);
  await expect
    .poll(() => snapshot(page).then((s) => s.length), { timeout: 10_000 })
    .toBe(expected.length + 1);

  await context.close();
});
