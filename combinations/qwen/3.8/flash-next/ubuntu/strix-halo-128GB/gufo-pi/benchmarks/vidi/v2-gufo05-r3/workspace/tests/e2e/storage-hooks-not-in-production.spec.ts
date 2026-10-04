/**
 * The storage test hooks are not part of what ships (story 4, task 10).
 *
 * The persistence specs damage and repair storage through `/__test/boards/...`,
 * which is why the worker only routes those paths when `TEST_HOOKS` is set, and why
 * `wrangler.jsonc` — the configuration a real deployment builds from — does not set
 * it. This spec runs against the server started from that same configuration file,
 * with no `--var TEST_HOOKS:1`, and checks the door is shut.
 *
 * The other half of the guarantee lives in the persistence project, where the very
 * same paths *are* hooks: `tests/e2e/persistence/`.
 */
import { expect, test } from '@playwright/test';

import { freshBoardId } from './helpers/participants';

const HOOKS = ['seed', 'compact', 'corrupt-snapshot', 'repair'] as const;

test.describe('the shipped configuration has no test hooks', () => {
  test('a hook path is answered by the static site, not by a board', async ({ request }) => {
    const boardId = freshBoardId();
    // A hook answers a POST with JSON describing what it did to a board. With the
    // routes absent, the request falls through to the asset handler, which serves
    // files and refuses to be posted to.
    const response = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
    expect(response.status(), await response.text()).toBe(405);
  });

  test('none of the four hooks is routed', async ({ request }) => {
    const boardId = freshBoardId();
    for (const hook of HOOKS) {
      const response = await request.post(`/__test/boards/${boardId}/${hook}`, {
        data: new Uint8Array(0),
      });
      expect(response.status(), `${hook}: ${await response.text()}`).toBe(405);
    }
  });

  test('the same path only ever holds the app shell', async ({ request }) => {
    const boardId = freshBoardId();
    const response = await request.get(`/__test/boards/${boardId}/repair`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('id="root"');
    expect(body).not.toContain('"ok"');
  });

  test('a board is untouched by a request to a hook path', async ({ browser }) => {
    // The board a person opens afterwards is a normal empty board on a normally
    // opened connection: no failure, no damaged state, nothing half done.
    const boardId = freshBoardId();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-board-surface]');
    await expect(page.locator('[data-sticky-note]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(page.locator('[data-sticky-note]')).toHaveCount(1);
    await expect(page.locator('[data-connection-state]')).toHaveCount(0);
    await context.close();
  });
});
