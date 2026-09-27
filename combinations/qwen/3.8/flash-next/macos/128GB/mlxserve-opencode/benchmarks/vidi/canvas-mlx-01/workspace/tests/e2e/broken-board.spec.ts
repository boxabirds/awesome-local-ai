/**
 * Story 4 broken-board e2e (tag `@slow`, run with `E2E_NIGHTLY=1`): a board whose saved
 * snapshot has been made unreadable is presented honestly — a red "couldn't be loaded" badge
 * and no editing — never as an empty editable board, and it recovers (without a page reload)
 * once the storage is repaired.
 *
 * The corruption is driven through the room's test-only `/__test/board/:id/{corrupt,repair}`
 * endpoint, which is compiled into the code but inert unless the dev server is started with
 * `TEST_HOOKS=1` (never set in the production config). Only a single board is affected; other
 * boards keep working (TC-24's isolation clause) because each board is its own DO SQLite file.
 */
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { createPersistedDevServer } from './helpers/dev-server.js';
import {
  createNote,
  newBoardPage,
  noteIds,
  waitForConnected,
} from './helpers/live.js';
import { boardStorageOp } from './helpers/seed.js';

const PORT = Number(process.env.VIDI_BROKEN_PORT ?? 8820);
const BADGE = '.test-connection-status';

test.describe('broken board (@slow)', () => {
  test.slow();
  test.describe.configure({ mode: 'serial' });

  test('TC-24 @slow an unreadable board shows a red failure, is not editable, and recovers on repair', async ({
    browser,
  }) => {
    const server = createPersistedDevServer(PORT, { TEST_HOOKS: '1' });
    await server.start();
    const boardId = newBoardId();

    // Create a note and let it save, then make the board's snapshot unreadable.
    const a = await newBoardPage(browser, boardId, server.base);
    const id = await createNote(a);
    expect(await boardStorageOp(server.base, boardId, 'corrupt')).toBe(200);

    // Open the broken board in a fresh context: the honest failure, not an empty board.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const broken = await ctx.newPage();
    await broken.goto(`${server.base}/b/${boardId}`);
    await broken.waitForFunction(
      () => typeof (window as unknown as { __vidi6?: unknown }).__vidi6 === 'object',
    );
    await expect(broken.locator(BADGE)).toHaveAttribute('data-status', 'load_failed', { timeout: 15_000 });
    await expect(broken.locator(BADGE)).toContainText("couldn't be loaded");
    // Red failure colour and the board is not editable.
    await expect(broken.locator(BADGE)).toHaveCSS('color', 'rgb(198, 40, 40)');
    await expect(broken.getByTestId('create-sticky')).toBeDisabled();

    // Repair the storage. The still-open client recovers on its own reconnect — no reload.
    expect(await boardStorageOp(server.base, boardId, 'repair')).toBe(200);
    await waitForConnected(broken, 30_000);
    await expect
      .poll(() => noteIds(broken).then((ids) => (ids.includes(id) ? 1 : 0)), { timeout: 15_000 })
      .toBe(1);
    await expect(broken.getByTestId('create-sticky')).toBeEnabled();

    await a.context().close();
    await ctx.close();
    await server.stop();
    server.cleanup();
  });
});
