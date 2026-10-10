// Story 4 E2E: persistence across REAL process restarts (TC-19..TC-21).
// These specs control their own `wrangler dev --persist-to <dir>` process:
// the browser closes, the server is killed and a NEW process starts over the
// same on-disk storage. Runs with playwright.persistence.config.ts (workers
// 1, no shared webServer).

import { expect, test, type Browser, type Page } from '@playwright/test';
import { createBoardApi } from '../helpers/board';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
} from '../../../src/shared/config';
import { waitForConnected } from '../helpers/participants';
import { WranglerProcess } from '../helpers/wrangler-process';

const PORT = Number(process.env.E2E_PERSIST_PORT ?? 29434);
const INSPECTOR_PORT = Number(process.env.E2E_PERSIST_INSPECTOR_PORT ?? 29435);

interface FullNote {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

function getFullNotes(page: Page): Promise<FullNote[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __vidi6: { board: { getNotes(): FullNote[] } };
        }
      ).__vidi6.board.getNotes(),
  );
}

/** Full fidelity, order-independent: id, position, colour, text and stacking. */
function signature(notes: readonly FullNote[]): string {
  return JSON.stringify(
    [...notes]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((n) => ({
        id: n.id,
        x: Math.round(n.x * 100) / 100,
        y: Math.round(n.y * 100) / 100,
        color: n.color,
        text: n.text,
        z: n.z,
      })),
  );
}

async function openBoard(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForConnected('e2e', page);
  return page;
}

/** Story 5: the first visit creates the board through the API, then opens it. */
async function openNewBoard(browser: Browser): Promise<{ page: Page; boardId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const boardId = await createBoardApi(page.request);
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForConnected('e2e', page);
  return { page, boardId };
}

async function waitForNoteCount(page: Page, count: number, timeoutMs: number): Promise<void> {
  await expect
    .poll(() => getFullNotes(page).then((n) => n.length), { timeout: timeoutMs })
    .toBe(count);
}

test.describe('Persistence across process restarts', () => {
  test('TC-19: overnight return — 25 varied notes identical after a real restart', async ({
    browser,
  }) => {
    const server = new WranglerProcess({ port: PORT, inspectorPort: INSPECTOR_PORT });
    try {
      await server.start();
      const { page, boardId } = await openNewBoard(browser);
      await page.evaluate(() => window.__vidi6?.board?.seedBoard(25));
      await waitForNoteCount(page, 25, E2E_EVENTUAL_TIMEOUT_MS);
      const before = await getFullNotes(page);
      expect(before.length).toBe(25);
      expect(new Set(before.map((n) => n.color)).size).toBeGreaterThan(1);
      expect(before.some((n) => n.text.includes('\n'))).toBe(true);

      // A second context proves the SERVER holds all 25, not just this tab.
      const witness = await openBoard(browser, boardId);
      await waitForNoteCount(witness, 25, E2E_EVENTUAL_TIMEOUT_MS);

      await page.context().close();
      await witness.context().close();

      await server.stop();
      await server.start(); // NEW process, same persist dir, memory forgotten

      const returnee = await openBoard(browser, boardId);
      await waitForNoteCount(returnee, 25, E2E_EVENTUAL_TIMEOUT_MS);
      const after = await getFullNotes(returnee);
      expect(signature(after)).toBe(signature(before));
      await returnee.context().close();
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  });

  test('TC-20: leave immediately — a note visible to Sam survives a kill within a second', async ({
    browser,
  }) => {
    const server = new WranglerProcess({ port: PORT, inspectorPort: INSPECTOR_PORT });
    try {
      await server.start();
      const { page: alex, boardId } = await openNewBoard(browser);
      await alex.mouse.dblclick(400, 300);
      await alex.keyboard.type('survivor');

      const sam = await openBoard(browser, boardId);
      await waitForNoteCount(sam, 1, E2E_EVENTUAL_TIMEOUT_MS);
      const before = await getFullNotes(sam);

      // Sam saw it, so it was already durable. Both close within a second.
      await alex.context().close();
      await sam.context().close();

      await server.stop();
      await server.start();

      const returnee = await openBoard(browser, boardId);
      await waitForNoteCount(returnee, 1, E2E_EVENTUAL_TIMEOUT_MS);
      const after = await getFullNotes(returnee);
      expect(signature(after)).toBe(signature(before));
      expect(after[0].text).toBe('survivor');
      await returnee.context().close();
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  });

  test('TC-21: big board — 2000 notes open completely after a restart (time reported)', async ({
    browser,
  }) => {
    test.setTimeout(9 * 60_000);
    const server = new WranglerProcess({ port: PORT, inspectorPort: INSPECTOR_PORT });
    try {
      await server.start();
      const { page: seeder, boardId } = await openNewBoard(browser);
      await seeder.evaluate((count) => window.__vidi6?.board?.seedBoard(count), PERSIST_TESTED_NOTES);
      await waitForNoteCount(seeder, PERSIST_TESTED_NOTES, 5 * 60_000);

      // Witness context: proves the room received every seeded update.
      const witness = await openBoard(browser, boardId);
      await waitForNoteCount(witness, PERSIST_TESTED_NOTES, 5 * 60_000);
      await seeder.context().close();
      await witness.context().close();

      await server.stop();
      await server.start();

      const openedAt = Date.now();
      const returnee = await openBoard(browser, boardId);
      await waitForNoteCount(returnee, PERSIST_TESTED_NOTES, 8 * 60_000);
      const openTime = Date.now() - openedAt;
      // DOM truth: every note element is rendered.
      await expect(pageNoteElements(returnee)).toHaveCount(PERSIST_TESTED_NOTES);
      const elapsed = Date.now() - openedAt;
      const verdict = elapsed <= BOARD_LOAD_BUDGET_MS ? 'within' : 'OVER';
      console.log(
        `[load] TC-21 ${PERSIST_TESTED_NOTES} notes: sync ${openTime}ms, fully rendered ${elapsed}ms ` +
          `(budget ${BOARD_LOAD_BUDGET_MS}ms, ${verdict}; reported, not asserted)`,
      );
      await returnee.context().close();
    } finally {
      await server.stop().catch(() => undefined);
      server.cleanup();
    }
  });
});

function pageNoteElements(page: Page) {
  return page.locator('[data-note-id]');
}

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

test.describe('Broken board', () => {
  test('TC-24: corrupt snapshot shows the red message, locks editing and recovers without reload', async ({
    browser,
  }) => {
    const server = new WranglerProcess({ port: PORT, inspectorPort: INSPECTOR_PORT });
    const prod = new WranglerProcess({
      port: Number(process.env.E2E_PERSIST_PROD_PORT ?? 29436),
      inspectorPort: Number(process.env.E2E_PERSIST_PROD_INSPECTOR_PORT ?? 29437),
      hooks: false,
    });
    try {
      await server.start();
      // 1. Create a 25-note board, let the room hold it, then corrupt the
      //    snapshot (the hook compacts first, so damage hits chunk 0).
      const { page: creator, boardId } = await openNewBoard(browser);
      await creator.evaluate(() => window.__vidi6?.board?.seedBoard(25));
      await waitForNoteCount(creator, 25, E2E_EVENTUAL_TIMEOUT_MS);
      const witness = await openBoard(browser, boardId);
      await waitForNoteCount(witness, 25, E2E_EVENTUAL_TIMEOUT_MS);
      await creator.context().close();
      await witness.context().close();

      const corrupt = await fetch(`${server.baseUrl}/__test/boards/${boardId}/corrupt-snapshot`, {
        method: 'POST',
      });
      expect(corrupt.ok).toBe(true);
      expect(((await corrupt.json()) as { state: string }).state).toBe('load-failed');

      // 2. A fresh visit shows the honest failure: red badge, editing locked.
      const victim = await browser.newContext();
      const victimPage = await victim.newPage();
      await victimPage.goto(`/b/${boardId}`);
      await expect(victimPage.getByTestId('board-viewport')).toBeVisible();
      const badge = victimPage.locator('.connection-status--load_failed');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(LOAD_FAILED_TEXT);
      await expect(victimPage.getByTestId('create-sticky')).toBeDisabled();
      await victimPage.mouse.dblclick(400, 300);
      await expect
        .poll(() => getFullNotes(victimPage).then((n) => n.length), { timeout: 3_000 })
        .toBe(0);

      // 3. Repair storage: the provider's own retries recover the board in
      //    place — no page reload.
      const repair = await fetch(`${server.baseUrl}/__test/boards/${boardId}/repair`, {
        method: 'POST',
      });
      expect(repair.ok).toBe(true);
      await expect(badge).toBeHidden({ timeout: 30_000 });
      await waitForNoteCount(victimPage, 25, 30_000);
      await expect(pageNoteElements(victimPage)).toHaveCount(25);

      // Editing works again without a reload.
      await victimPage.mouse.dblclick(700, 500);
      await waitForNoteCount(victimPage, 26, E2E_EVENTUAL_TIMEOUT_MS);
      await victim.close();

      // 4. A production-style worker (no TEST_HOOKS) has no hook routes:
      //    the request falls through to the SPA, and the board is untouched.
      await server.stop();
      prod.useStorageOf(server);
      await prod.start();
      const prodHook = await fetch(`${prod.baseUrl}/__test/boards/${boardId}/corrupt-snapshot`, {
        method: 'POST',
      });
      // No hook route: the static-asset handler answers (SPA page or 404/405
      // for POST) — never the hook's JSON, and never a server error.
      const prodHookBody = await prodHook.text();
      expect(prodHook.status).toBeLessThan(500);
      expect(prodHookBody).not.toContain('"state"');
      const prodPage = await browser.newPage();
      await prodPage.goto(`${prod.baseUrl}/b/${boardId}`);
      await expect(prodPage.getByTestId('board-viewport')).toBeVisible();
      // 25 seeded + 1 created in-place during recovery — all intact,
      // the refused hook call changed nothing.
      await waitForNoteCount(prodPage, 26, E2E_EVENTUAL_TIMEOUT_MS);
      await prodPage.close();
    } finally {
      await server.stop().catch(() => undefined);
      await prod.stop().catch(() => undefined);
      server.cleanup();
      prod.cleanup();
    }
  });
});
