/**
 * Story 5, share.e2e: full flow through the real browser, Vite dev server
 * and the real Worker (workerd) — the integration test's TC-10 equivalent
 * plus the UI flows.
 *
 * TC-26 to TC-29, TC-31.
 */
import { test, expect } from '@playwright/test';
import { createBoardViaApi, boardUrl } from './helpers/board';

test('TC-26: home → New board → board opens with toolbar and Share button', async ({
  page,
  request,
}) => {
  await page.goto('/');

  // Home page.
  const newBoard = page.getByTestId('new-board');
  await expect(newBoard).toBeVisible();
  await expect(newBoard).toHaveText('New board');
  await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();

  // Click → client-side navigation to /b/<id>; the URL carries a 22-char
  // base64url code.
  await newBoard.click();
  await page.waitForFunction(
    () => /^\/b\/[\w-]{22}$/.test(window.location.pathname),
    { timeout: 10_000 },
  );

  // The server confirms the board exists (integration proof of the POST).
  const id = new URL(page.url()).pathname.slice(3);
  const res = await request.get(`/api/boards/${id}`);
  expect(res.status()).toBe(200);

  // Board loaded: toolbar and Share button are visible.
  await expect(page.getByTestId('sticky-btn')).toBeVisible();
  await expect(page.getByTestId('share-btn')).toBeVisible();
});

// Clipboard permission grants + read-back are exercised on chromium (the
// design's "chromium is enough" for the copy flow); other engines skip it.
test('TC-27: Share panel copy flow (clipboard permitted)', async (
  { page, request },
  testInfo,
) => {
  test.skip(testInfo.project.name !== 'chromium', 'copy flow is exercised on chromium');
  const id = await createBoardViaApi(request);
  await page.goto(boardUrl(id));
  await expect(page.getByTestId('sticky-btn')).toBeVisible();

  // Grant clipboard permissions so the panel's writeText succeeds and the
  // written content can be read back for the assertion.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.getByTestId('share-btn').click();
  const panel = page.getByTestId('share-panel');
  await expect(panel).toBeVisible();

  const input = panel.locator('input');
  await expect(input).toHaveValue(new URL(page.url()).origin + `/b/${id}`);
  await expect(
    panel.getByText('Anyone with this link can view and edit this board.'),
  ).toBeVisible();

  await panel.getByRole('button', { name: 'Copy link' }).click();
  // The button flips to "Link copied".
  await expect(panel.getByRole('button', { name: /Link copied/ })).toBeVisible();

  // The actual clipboard content is the full link (read-back via the
  // permitted clipboard API).
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(new URL(page.url()).origin + `/b/${id}`);
});

test('TC-28: board not found page for a mistyped link; New board works', async ({
  page,
  request,
}) => {
  // A well-formed but unknown id (never created) → not-found page.
  const unknownId = 'a'.repeat(22);
  await page.goto(`/b/${unknownId}`);

  const heading = page.getByRole('heading', { name: 'Board not found' });
  await expect(heading).toBeVisible();
  await expect(
    page.getByText('Check the link, or ask the person who shared it to send it again.'),
  ).toBeVisible();

  // New board from the not-found page lands on a working board.
  await page.getByTestId('new-board').click();
  await page.waitForFunction(
    (unknown) => window.location.pathname !== `/b/${unknown}`,
    unknownId,
    { timeout: 10_000 },
  );
  expect(page.url()).toMatch(/\/b\/[\w-]{22}$/);
  const newId = new URL(page.url()).pathname.slice(3);
  expect(newId).not.toBe(unknownId);
  await expect(page.getByTestId('sticky-btn')).toBeVisible();

  // The mistyped address still does not exist (nothing was created there).
  const res = await request.get(`/api/boards/${unknownId}`);
  expect(res.status()).toBe(404);
});

test('TC-29: a second participant opening the shared link sees the same board', async ({
  context,
  request,
}) => {
  const first = await context.newPage();
  const id = await createBoardViaApi(request);
  await first.goto(boardUrl(id));
  await expect(first.getByTestId('sticky-btn')).toBeVisible();

  // Participant 1 adds a sticky note through the real UI.
  await first.getByTestId('sticky-btn').click();
  const note = first.getByTestId('sticky-note').first();
  await expect(note).toBeVisible();

  // Participant 2 (fresh page, same origin) opens the same shared link.
  const second = await context.newPage();
  await second.goto(boardUrl(id));
  await expect(second.getByTestId('sticky-btn')).toBeVisible();
  // The note created by participant 1 is visible to participant 2.
  const secondNote = second.getByTestId('sticky-note').first();
  await expect(secondNote).toBeVisible({ timeout: 10_000 });
  expect(await secondNote.count()).toBeGreaterThanOrEqual(1);
});

test('TC-31: created board survives a reload (server-side)', async ({
  page,
  request,
}) => {
  const id = await createBoardViaApi(request);
  await page.goto(boardUrl(id));
  await expect(page.getByTestId('sticky-btn')).toBeVisible();

  // Add a note, then reload.
  await page.getByTestId('sticky-btn').click();
  await expect(page.getByTestId('sticky-note').first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('sticky-btn')).toBeVisible();
  await expect(page.getByTestId('sticky-note').first()).toBeVisible({ timeout: 10_000 });

  // The board exists on the server (no client-side storage involved).
  const res = await request.get(`/api/boards/${id}`);
  expect(res.status()).toBe(200);
});
