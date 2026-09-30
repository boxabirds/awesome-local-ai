import { test, expect } from '@playwright/test';
import { newBoardId } from '@shared/board-id';
import {
  createBoardViaUi,
  waitForConnected,
  getNoteCount,
  expectEventually,
  createNoteAtPoint,
} from './helpers/participants';
import { startWrangler, type WranglerProc } from './helpers/wrangler-process';

const LINK_RE = /\/b\/[A-Za-z0-9_-]{22}$/;

// TC-26: golden path — create from home, the URL is a shareable link, a second
// visitor who opens it joins the SAME board and sees a note made in the first tab.
test('TC-26: create from home, share the link, second visitor joins', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await createBoardViaUi(pageA);

  // The link is a full URL ending in /b/<valid id>.
  expect(pageA.url()).toMatch(LINK_RE);

  // A second context opens the link and lands on the same board.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(pageA.url());
  await pageB.waitForSelector('[data-testid="board-viewport"]');
  await waitForConnected(pageB);

  // A note made in A appears in B shortly after it is committed.
  await createNoteAtPoint(pageA, 400, 300);
  await expectEventually(
    () => getNoteCount(pageA),
    (c) => c === 1,
    'TC-26 note created in A',
  );
  const started = Date.now();
  await pageA.keyboard.press('Escape'); // commit / dismiss the editor
  await expectEventually(
    () => getNoteCount(pageB),
    (c) => c === 1,
    'TC-26 note appears in B',
  );
  expect(Date.now() - started).toBeLessThan(5000);

  await ctxA.close();
  await ctxB.close();
});

// TC-27: a bad link (malformed and unknown-but-valid) shows Board not found with no
// create request; the New board button then creates a different board.
test('TC-27: bad link shows not found and can create a different board', async ({ browser }) => {
  const unknown = newBoardId(); // valid format, never created
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/boards')) posts.push(req.url());
  });

  await page.goto(`/b/${unknown}`);
  await expect(page.getByText('Board not found')).toBeVisible();
  // No board-creation request was made while on the not-found page.
  expect(posts.length).toBe(0);

  // Malformed link also shows not found, with no create request.
  await page.goto('/b/abc');
  await expect(page.getByText('Board not found')).toBeVisible();
  expect(posts.length).toBe(0);

  // New board from the not-found page creates a *different* board.
  await page.getByRole('button', { name: 'New board' }).click();
  await page.waitForSelector('[data-testid="board-viewport"]');
  expect(page.url()).toMatch(LINK_RE);
  const created = page.url().split('/')[4];
  expect(created).not.toBe(unknown);
  expect(created).not.toBe('abc');
  expect(posts.length).toBe(1);

  await ctx.close();
});

// TC-28: a flaky existence check (unavailable, then 200) recovers: Opening board…,
// then Retrying…, then the board mounts — without a reload.
test('TC-28: unreachable check retries and opens without reload', async ({ browser }) => {
  // Create the board first so the id genuinely exists.
  const seedCtx = await browser.newContext();
  const seedPage = await seedCtx.newPage();
  const id = await createBoardViaUi(seedPage);
  await seedCtx.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const marker = 'marker-' + Math.random();
  await page.addInitScript((m) => {
    (window as unknown as { __noReload: string }).__noReload = m;
  }, marker);

  let n = 0;
  await page.route(`**/api/boards/${id}`, async (route) => {
    if (route.request().method() === 'GET') {
      n++;
      if (n === 1) {
        // Hold the first check open so the "Opening board…" state is observable.
        await new Promise((r) => setTimeout(r, 1200));
        await route.fulfill({ status: 503, body: 'down' });
        return;
      }
      if (n === 2) {
        await route.fulfill({ status: 503, body: 'down' });
        return;
      }
    }
    await route.fallback();
  });

  await page.goto(`/b/${id}`);
  // "Opening board…" (held), then the unreachable/retrying message while it fails.
  await expect(page.getByText('Opening board…')).toBeVisible();
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
    timeout: 8000,
  });

  // Then, once the check succeeds, the board mounts — with no page reload.
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
  const still = await page.evaluate(
    () => (window as unknown as { __noReload?: string }).__noReload,
  );
  expect(still).toBe(marker);

  await ctx.close();
});

// TC-29: clipboard blocked -> manual-copy message and the whole link selectable.
test('TC-29: blocked clipboard falls back to manual copy', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('clipboard blocked')) },
      configurable: true,
    });
  });

  const id = await createBoardViaUi(page);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();

  await expect(
    page.getByText(/blocked automatic copy.*Ctrl\+C/),
  ).toBeVisible();
  const field = page.getByLabel('Board link');
  const value = await field.inputValue();
  // The read-only field holds the whole link — the same URL as the current board.
  expect(value).toBe(page.url());
  expect(value).toBe(`http://127.0.0.1:8787/b/${id}`);
  expect(value).toMatch(LINK_RE);

  await ctx.close();
});

// TC-31: a legacy board (data present, no created_at) opens via its link and is
// never re-initialised. Uses a test-hooks wrangler to seed a legacy row.
test.describe('TC-31: legacy board opens', () => {
  test.setTimeout(180_000);
  let proc: WranglerProc | null = null;
  let procUrl = '';

  test.beforeAll(async () => {
    const port = 8909;
    proc = await startWrangler({ port, testHooks: true });
    procUrl = proc.url;
  });

  test.afterAll(async () => {
    proc?.kill();
  });

  test('opens a seeded legacy board without creating it', async ({ browser }) => {
    const id = newBoardId();
    // Seed updates rows without created_at (a legacy board) via the test hook.
    const seed = (await (
      await fetch(`${procUrl}/__test/seed?room=${id}&count=1&seed=7`, { method: 'POST' })
    ).json()) as { notes: number };
    expect(seed.notes).toBe(1);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/boards')) posts.push(req.url());
    });

    await page.goto(`${procUrl}/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
    await waitForConnected(page);
    expect(await getNoteCount(page)).toBe(1);
    // Opening an existing (legacy) board never triggers a board creation.
    expect(posts.length).toBe(0);

    await ctx.close();
  });
});
