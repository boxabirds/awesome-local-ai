// Story 5 E2E (share.pages, share.share_panel, share.legacy_boards):
// real Chromium against the real workerd server.
// TC-26 create/share/join, TC-27 bad link, TC-28 flaky service, TC-29
// clipboard blocked, TC-31 legacy board still opens.

import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { createBoardApi, getNotes } from './helpers/board';

// Chromium-only project (see NOTES.md engine limits); clipboard is granted
// so the real writeText path is exercised. The copied text is captured with
// an in-page wrapper around the real clipboard, so nothing depends on
// read-permission gesture rules.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function installClipboardRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = store;
    const clipboard = (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    if (clipboard) {
      const original = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (text: string) => {
        store.push(text);
        return original(text);
      };
    }
  });
}

function copiedText(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (window as unknown as { __copied?: string[] }).__copied?.[0],
  );
}

test('TC-26: Maya creates a board, copies the link; Sam joins and both edit live', async ({
  browser,
  page,
}) => {
  await installClipboardRecorder(page);
  const clickedAt = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  const clickToBoard = Date.now() - clickedAt;
  const budgetVerdict = clickToBoard <= CREATE_BUDGET_MS ? 'within' : 'OVER';
  console.log(
    `[create] TC-26 click-to-board: ${clickToBoard}ms ` +
      `(budget ${CREATE_BUDGET_MS}ms, ${budgetVerdict}; reported, not asserted)`,
  );

  // The empty board opens directly at the new link.
  expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  expect(await getNotes(page)).toHaveLength(0);

  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('shared note');
  await expect
    .poll(() => getNotes(page).then((n) => n.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(1);

  await page.getByRole('button', { name: 'Share' }).click();
  const panel = page.getByRole('dialog', { name: 'Share board' });
  await expect(panel).toBeVisible();
  const field = panel.getByRole('textbox', { name: 'Board link' });
  await expect(field).toHaveValue(`${new URL(page.url()).origin}/b/${page.url().split('/b/')[1]}`);

  await panel.getByRole('button', { name: 'Copy link' }).click();
  await expect(panel.getByRole('button', { name: 'Link copied' })).toBeVisible();
  const link = await copiedText(page);
  expect(link).toBe(page.url());

  // Sam joins through the copied link in a fresh context (like a new machine).
  const samContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  try {
    const sam = await samContext.newPage();
    await sam.goto(link!);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    await expect
      .poll(() => getNotes(sam).then((n) => n.some((note) => note.text.includes('shared note'))), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);

    // Sam edits; Maya sees the edit live.
    await sam.mouse.dblclick(600, 400);
    await sam.keyboard.type('from sam');
    await expect
      .poll(() => getNotes(page).then((n) => n.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);
    await expect
      .poll(
        () => getNotes(page).then((n) => n.some((note) => note.text.includes('from sam'))),
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);
  } finally {
    await samContext.close();
  }
});

test('TC-27: an unknown link says Board not found; New board then works from it', async ({
  page,
}) => {
  await page.goto(`/b/${newBoardId()}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  expect(await getNotes(page)).toHaveLength(0);
});

test('TC-28: an unreachable service shows the retry message; the board opens without a reload', async ({
  page,
}) => {
  const boardId = await createBoardApi(page.request);
  await page.route('**/api/boards/*', (route) => route.abort());
  await page.goto(`/b/${boardId}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
  await expect(page.getByTestId('board-viewport')).toHaveCount(0);

  // The service "comes back": the page's own backoff retry opens the board.
  await page.unroute('**/api/boards/*');
  await expect(page.getByTestId('board-viewport')).toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
});

test('TC-29: a rejected clipboard falls back to manual copy with the link selected', async ({
  page,
}) => {
  const boardId = await createBoardApi(page.request);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('permission denied')) },
    });
  });
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();

  await page.getByRole('button', { name: 'Share' }).click();
  const panel = page.getByRole('dialog', { name: 'Share board' });
  await panel.getByRole('button', { name: 'Copy link' }).click();
  await expect(panel.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();

  const [start, end, value] = await panel
    .getByRole('textbox', { name: 'Board link' })
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd, input.value];
    });
  expect(value).toBe(`${new URL(page.url()).origin}/b/${boardId}`);
  expect(start).toBe(0);
  expect(end).toBe(value.length);
});

test('TC-31: a legacy board (storage without created_at) still opens', async ({ page, request }) => {
  const boardId = newBoardId();
  // Build real updates exactly like a story 2/3 client, then write them to
  // the board's storage WITHOUT created_at through the test hook.
  const doc = new Y.Doc();
  const noteId = createSticky(doc, { x: 100, y: 100 });
  if (typeof noteId === 'string') getStickyText(doc, noteId)?.insert(0, 'legacy note');
  const update = Y.encodeStateAsUpdate(doc);

  const seeded = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
    data: { updates: [Buffer.from(update).toString('base64')] },
  });
  expect(seeded.status()).toBe(200);

  await page.goto(`/b/${boardId}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(() => getNotes(page).then((n) => n.some((note) => note.text.includes('legacy note'))), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(true);
});
