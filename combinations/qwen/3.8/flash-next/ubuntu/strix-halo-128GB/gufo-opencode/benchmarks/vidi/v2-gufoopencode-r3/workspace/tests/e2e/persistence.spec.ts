import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES
} from '../../src/shared/config';
import { getNotes } from './helpers/board';
import { connectionState, snapshotKey } from './helpers/participants';
import {
  corruptSnapshot,
  forceCompact,
  initBoard,
  readNoteCount,
  repairSnapshot,
  seedNotes
} from './helpers/seed-client';
import { removePersistDir, startWrangler, type WranglerProcess } from './helpers/wrangler-process';

// These specs drive their own `wrangler dev --persist-to <tmp>` processes so
// a kill + restart really does wipe memory while SQLite survives. They run
// on their own ports and never touch the shared e2e webServer.
test.describe.configure({ mode: 'serial' });

interface Board {
  context: BrowserContext;
  page: Page;
}

async function openBoard(browser: Browser, port: number, boardId: string): Promise<Board> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // Story 5: opening /b/<id> needs the board to exist; ensure it (idempotent).
  await initBoard(port, boardId);
  await page.goto(`http://127.0.0.1:${port}/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(() => connectionState(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
  return { context, page };
}

async function createVariedNotes(page: Page, count: number): Promise<void> {
  const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
  await page.evaluate(
    ({ n, colorNames }) => {
      const hook = window.__vidi6;
      if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
      for (let i = 0; i < n; i += 1) {
        hook.createNote({
          x: 300 + (i % 5) * 260,
          y: 200 + Math.floor(i / 5) * 200,
          text: `Note ${i + 1}: ${'content '.repeat((i % 4) + 1).trim()}`,
          color: colorNames[i % colorNames.length]
        });
      }
    },
    { n: count, colorNames: colors }
  );
}

async function createOneNote(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.createNote({ x: 100, y: 100, text: 'Just landed', color: 'pink' });
  });
}

test('TC-19 overnight return: 25 varied notes survive a process restart identical', async ({
  browser
}) => {
  test.setTimeout(420_000);
  let wrangler: WranglerProcess | null = null;
  const contexts: BrowserContext[] = [];
  try {
    wrangler = await startWrangler({ port: 22708, testHooks: true });
    const boardId = newBoardId();
    const first = await openBoard(browser, wrangler.port, boardId);
    contexts.push(first.context);

    await createVariedNotes(first.page, 25);
    await expect.poll(async () => (await getNotes(first.page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    }).toBe(25);
    const before = snapshotKey(await getNotes(first.page));

    // Append-before-broadcast: a note is stored once the ROOM has it. The
    // creator's own view updates locally immediately, so confirm the room has
    // received and stored all 25 before the hard kill (the "seen is saved"
    // signal), otherwise in-flight notes would not have reached storage.
    await expect
      .poll(() => readNoteCount(wrangler!.port, boardId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(25);

    // "Overnight": close the browser, kill the process (memory gone), restart.
    await first.context.close();
    contexts.length = 0;
    await wrangler.stop();
    wrangler = await startWrangler({ port: 22708, persistDir: wrangler.persistDir, testHooks: true });

    const second = await openBoard(browser, wrangler.port, boardId);
    contexts.push(second.context);
    await expect.poll(async () => (await getNotes(second.page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    }).toBe(25);
    const after = snapshotKey(await getNotes(second.page));
    expect(after).toBe(before); // ids, positions, colours, text, stacking
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (wrangler !== null) {
      await wrangler.stop();
      removePersistDir(wrangler.persistDir);
    }
  }
});

test('TC-20 leave immediately: a change seen by a peer survives an instant exit + restart', async ({
  browser
}) => {
  test.setTimeout(300_000);
  let wrangler: WranglerProcess | null = null;
  const contexts: BrowserContext[] = [];
  try {
    wrangler = await startWrangler({ port: 22710, testHooks: true });
    const boardId = newBoardId();
    const alex = await openBoard(browser, wrangler.port, boardId);
    const sam = await openBoard(browser, wrangler.port, boardId);
    contexts.push(alex.context, sam.context);

    const id = await createOneNote(alex.page);
    // Append-before-broadcast means: by the time Sam sees it, it is stored.
    await expect
      .poll(
        async () => (await getNotes(sam.page)).some((n) => n.id === id),
        { timeout: E2E_EVENTUAL_TIMEOUT_MS }
      )
      .toBe(true);

    // Walk out the door right away: close both sessions, kill the process.
    await Promise.all([alex.context.close(), sam.context.close()]);
    contexts.length = 0;
    await wrangler.stop();
    wrangler = await startWrangler({ port: 22710, persistDir: wrangler.persistDir, testHooks: true });

    const returner = await openBoard(browser, wrangler.port, boardId);
    contexts.push(returner.context);
    await expect
      .poll(
        async () => (await getNotes(returner.page)).some((n) => n.id === id),
        { timeout: E2E_EVENTUAL_TIMEOUT_MS }
      )
      .toBe(true);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (wrangler !== null) {
      await wrangler.stop();
      removePersistDir(wrangler.persistDir);
    }
  }
});

test('TC-24 broken board: honest failure message, editing blocked, recovery without reload', async ({
  browser
}) => {
  test.setTimeout(360_000);
  let wrangler: WranglerProcess | null = null;
  const contexts: BrowserContext[] = [];
  try {
    wrangler = await startWrangler({ port: 22714, testHooks: true });
    const boardId = newBoardId();
    const session = await openBoard(browser, wrangler.port, boardId);
    contexts.push(session.context);

    await createVariedNotes(session.page, 25);
    // Confirm the room has stored all 25, then fold them into a snapshot so
    // the failure below is a damaged snapshot (the fatal case).
    await expect
      .poll(() => readNoteCount(wrangler!.port, boardId), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(25);
    await forceCompact(wrangler.port, boardId);

    // Damage the snapshot; the room discards its doc and closes sockets 4500.
    await corruptSnapshot(wrangler.port, boardId);

    // Same page (no reload) shows the honest failure and locks editing.
    await expect
      .poll(() => connectionState(session.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe('load_failed');
    await expect(session.page.getByTestId('connection-status')).toContainText(
      "This board couldn't be loaded"
    );
    const createButton = session.page.getByRole('button', { name: 'Sticky note (N)' });
    await expect(createButton).toBeDisabled();
    const lockedCount = (await getNotes(session.page)).length;
    await createButton.click({ force: true }).catch(() => undefined);
    expect((await getNotes(session.page)).length).toBe(lockedCount);

    // Repair storage; the provider's own reconnect reloads the board with no
    // page reload, re-enabling editing.
    await repairSnapshot(wrangler.port, boardId);
    await expect
      .poll(() => connectionState(session.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS + 10_000
      })
      .toBe('connected');
    await expect
      .poll(async () => (await getNotes(session.page)).length, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS
      })
      .toBe(25);
    await expect(createButton).toBeEnabled();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (wrangler !== null) {
      await wrangler.stop();
      removePersistDir(wrangler.persistDir);
    }
  }
});

test('TC-21 big board open: all PERSIST_TESTED_NOTES notes render; open time logged', async ({
  browser
}) => {
  test.setTimeout(420_000);
  let wrangler: WranglerProcess | null = null;
  const contexts: BrowserContext[] = [];
  try {
    wrangler = await startWrangler({ port: 22712, testHooks: true });
    const boardId = newBoardId();
    await initBoard(wrangler.port, boardId);
    await seedNotes(wrangler.port, boardId, PERSIST_TESTED_NOTES);
    // Fold the append log into a chunked snapshot so the browser's open
    // exercises the snapshot + replay reconstruction path, not just a long log.
    await forceCompact(wrangler.port, boardId);

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    contexts.push(context);
    const page = await context.newPage();
    const navigationStart = Date.now();
    await page.goto(`http://127.0.0.1:${wrangler.port}/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const noteElements = page.locator('[data-testid="sticky-note"]');
    await expect
      .poll(() => noteElements.count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(PERSIST_TESTED_NOTES);
    const openMs = Date.now() - navigationStart;
    const flag = openMs > BOARD_LOAD_BUDGET_MS ? ' OVER-BUDGET (reported only)' : '';
    console.log(
      `[load] TC-21 ${PERSIST_TESTED_NOTES} notes: ${openMs}ms vs budget ` +
        `${BOARD_LOAD_BUDGET_MS}ms${flag} (reported, not asserted)`
    );

    const notes = await getNotes(page);
    expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
    expect(new Set(notes.map((n) => n.id)).size).toBe(PERSIST_TESTED_NOTES);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (wrangler !== null) {
      await wrangler.stop();
      removePersistDir(wrangler.persistDir);
    }
  }
});
