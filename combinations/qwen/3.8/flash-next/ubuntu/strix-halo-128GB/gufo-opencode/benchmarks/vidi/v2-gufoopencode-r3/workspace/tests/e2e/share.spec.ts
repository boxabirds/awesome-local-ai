import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { createSticky, initDoc } from '../../src/shared/board-model';
import { createBoard, getNotes, openBoard } from './helpers/board';
import { seedLegacyBoard } from './helpers/seed-client';
import { removePersistDir, startWrangler, type WranglerProcess } from './helpers/wrangler-process';

const notChromium = ({ browserName }: { browserName: string }) => browserName !== 'chromium';

// One Y.Doc update (base64) carrying a few stickies, for legacy seeding.
function legacyUpdate(count: number): string {
  const doc = new Y.Doc();
  initDoc(doc);
  for (let i = 0; i < count; i += 1) {
    createSticky(doc, { x: 100, y: 100 + i * 200 });
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

test('TC-26 create, share, join: second person opens the copied link and edits live', async ({
  browser,
  browserName
}) => {
  test.skip(notChromium({ browserName }), 'TC-26 needs Chromium clipboard read/write');

  const mayaContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const samContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const maya = await mayaContext.newPage();
    await maya.goto('/');

    // Create through the home page; click-to-board time is logged, not asserted.
    const start = Date.now();
    await maya.getByRole('button', { name: 'New board' }).click();
    await expect(maya.getByTestId('board-viewport')).toBeVisible();
    const ms = Date.now() - start;
    console.log(
      `[create] TC-26 click-to-board ${ms}ms vs budget ${CREATE_BUDGET_MS}ms ` +
        `${ms > CREATE_BUDGET_MS ? 'OVER-BUDGET (reported only)' : ''} (not asserted)`
    );

    const noteId = await maya.evaluate(() =>
      window.__vidi6!.createNote({ x: 100, y: 100, text: 'From Maya', color: 'yellow' })
    );
    await expect
      .poll(async () => (await getNotes(maya)).some((n) => n.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(true);

    // Share → Copy link.
    await maya.getByRole('button', { name: 'Share' }).click();
    await maya.getByRole('button', { name: 'Copy link' }).click();
    await expect(maya.getByRole('button', { name: 'Link copied' })).toBeVisible();

    // Sam opens exactly what was copied to the clipboard.
    const link = await maya.evaluate(async () => navigator.clipboard.readText());
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    const sam = await samContext.newPage();
    await sam.goto(link);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    await expect
      .poll(async () => (await getNotes(sam)).some((n) => n.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(true); // Sam sees Maya's note on the shared board

    // Sam edits; Maya sees the edit without reload.
    const samNoteId = await sam.evaluate(() =>
      window.__vidi6!.createNote({ x: 400, y: 100, text: 'From Sam', color: 'blue' })
    );
    await expect
      .poll(async () => (await getNotes(maya)).some((n) => n.id === samNoteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(true);
  } finally {
    await Promise.all([mayaContext.close(), samContext.close()]);
  }
});

test('TC-27 a never-created link shows Board not found, then New board opens a fresh board', async ({
  page
}) => {
  await page.goto(`/b/${newBoardId()}`);
  await expect(page.getByText('Board not found')).toBeVisible();

  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  // A fresh board is empty and the URL now points at a real board.
  await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
});

test('TC-28 an unreachable service on open retries, then opens without reload', async ({
  page,
  request
}) => {
  const id = await createBoard(request);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${id}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

  await page.unroute('**/api/boards/*');
  // The scheduled retry succeeds; no navigation/reload happens here.
  await expect(page.getByTestId('board-viewport')).toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS
  });
  expect(page.url()).toBe(new URL(`/b/${id}`, page.url()).href);
});

test('TC-29 a blocked clipboard shows the manual-copy fallback with the link selected', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) }
    });
  });
  const id = await openBoard(page);

  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();

  const state = await page
    .getByRole('textbox')
    .evaluate((el) => ({
      value: (el as HTMLInputElement).value,
      start: (el as HTMLInputElement).selectionStart,
      end: (el as HTMLInputElement).selectionEnd,
      origin: window.location.origin
    }));
  expect(state.value).toBe(`${state.origin}/b/${id}`);
  expect(state.start).toBe(0);
  expect(state.end).toBe(state.value.length);
});

test('TC-31 a pre-existing legacy board (no created_at) opens, not Board not found', async ({
  browser,
  browserName
}) => {
  test.skip(notChromium({ browserName }), 'TC-31 spawns its own wrangler; run once on Chromium');

  let wrangler: WranglerProcess | null = null;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    wrangler = await startWrangler({ port: 22716, testHooks: true });
    const boardId = newBoardId();
    // Seeded as legacy storage: updates rows, no created_at.
    await seedLegacyBoard(wrangler.port, boardId, [legacyUpdate(2)]);

    const page = await context.newPage();
    await page.goto(`${wrangler.url}/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await expect
      .poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);
    expect(await page.getByText('Board not found').count()).toBe(0);
  } finally {
    await context.close();
    if (wrangler !== null) {
      await wrangler.stop();
      removePersistDir(wrangler.persistDir);
    }
  }
});
