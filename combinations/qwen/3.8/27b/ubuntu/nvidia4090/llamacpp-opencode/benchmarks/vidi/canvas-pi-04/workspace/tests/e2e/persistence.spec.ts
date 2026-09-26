// Story 4, task 6: E2E persistence (PRD anchors persist.*).
//
// These specs run against a real `wrangler dev` process owned by each test
// (see wrangler-process.ts) so they can KILL and RESTART the worker against
// the same `--persist-to` directory — the only way to prove a board survives
// a cold start (the room reloads from SQLite) and that a crash loses nothing
// that was already durably stored.
//
//   TC-19  overnight return      25 browser-created notes survive a restart
//   TC-20  leave immediately      a note stored before broadcast survives a crash
//   TC-21  big board open         a 2000-note board opens within the load budget
//   TC-24  broken board           a corrupted snapshot is surfaced, then repaired
//                                 live (no reload) once the retry interval elapses

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { newBoard } from './participants';
import { startWranglerProcess, type WranglerProcess } from './wrangler-process';

const base = test.extend<{ wrangler: WranglerProcess }>({
  wrangler: async ({}, use) => {
    const wrangler = await startWranglerProcess();
    await use(wrangler);
    await wrangler.dispose();
  },
});

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

interface Participant {
  context: BrowserContext;
  page: Page;
}

const V = '[data-testid="board-viewport"]';

function colorLabel(color: string): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

const STICKY_COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;

/** Wait until the page's board has first synced (badge state is "connected"). */
async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6
        ?.connectionState?.() === 'connected',
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/** The mapped connection state as exposed by the test hook. */
async function connectionState(page: Page): Promise<string> {
  return (
    (await page.evaluate(
      () =>
        (window as unknown as { __vidi6?: { connectionState(): string } })
          .__vidi6?.connectionState?.(),
    )) ?? 'unknown'
  );
}

/** Open a fresh context on `boardId` at `url` and wait until it is live. */
async function openParticipant(
  browser: Browser,
  url: string,
  boardId: string,
): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${url}/b/${boardId}`);
  await waitForConnected(page);
  return { context, page };
}

/**
 * Create a note centred on world (wx, wy) by jumping the camera there first
 * (so the double-click always lands on empty space, regardless of how many
 * notes already exist). Optionally type `text` and pick `color`.
 */
async function createNoteAtWorld(
  page: Page,
  wx: number,
  wy: number,
  text = '',
  color?: string,
): Promise<void> {
  const vp = await page.locator(V).boundingBox();
  if (vp === null) throw new Error('board viewport not found');
  await page.evaluate(
    (cam) => {
      (window as unknown as { __vidi6: { setCamera(c: unknown): void } }).__vidi6.setCamera(cam);
    },
    { x: wx - vp.width / 2, y: wy - vp.height / 2, zoom: 1 },
  );
  await page.locator(V).dblclick({ position: { x: vp.width / 2, y: vp.height / 2 } });
  if (text !== '') {
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Escape');
  if (color !== undefined) {
    await page.locator(`.note-toolbar button[aria-label="${colorLabel(color)}"]`).click();
  }
}

interface BoardNote {
  id: string;
  left: string;
  top: string;
  color: string;
  text: string;
}

/** Capture the board as an ordered list of notes (DOM order == stacking order). */
async function captureBoard(page: Page): Promise<BoardNote[]> {
  return page.locator('.sticky-note').evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      const textEl = e.querySelector('.sticky-note__text');
      return {
        id: e.getAttribute('data-note-id') ?? '',
        left: e.style.left,
        top: e.style.top,
        color: e.getAttribute('data-color') ?? '',
        text: textEl ? textEl.textContent ?? '' : '',
      };
    }),
  );
}

/** Call a /__test/ hook and assert it succeeded. */
async function postHook(
  wrangler: WranglerProcess,
  boardId: string,
  action: string,
  body?: unknown,
  timeoutMs = 120_000,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${wrangler.url}/__test/boards/${boardId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`hook /${action} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Wait until the ROOM has durably stored at least `expected` notes. The
 * browser may still be flushing its Yjs updates when the test finishes
 * creating notes; a cold restart must not lose any, so block until the
 * server's ground truth (the /notes hook) catches up.
 */
async function waitForServerNotes(
  wrangler: WranglerProcess,
  boardId: string,
  expected: number,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await postHook(wrangler, boardId, 'notes');
    if ((data.notes as number) >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`server never reached ${expected} notes (last: ${data.notes})`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------
// TC-19: overnight return.
// ---------------------------------------------------------------------------

base('TC-19: a board returns exactly as it was left', async ({ wrangler, browser }) => {
  const url = wrangler.url;
  // Story 5: the board must exist before anyone can open its link.
  const boardId = await newBoard(url);

  // Evening: create 25 varied notes in the browser.
  const eve = await openParticipant(browser, url, boardId);
  for (let i = 0; i < 25; i++) {
    const wx = (i % 5) * 300 - 600;
    const wy = Math.floor(i / 5) * 300 - 600;
    await createNoteAtWorld(eve.page, wx, wy, `note ${i}`, STICKY_COLORS[i % STICKY_COLORS.length]);
  }
  expect(await eve.page.locator('.sticky-note').count()).toBe(25);
  const before = await captureBoard(eve.page);
  // Every note must be durably stored server-side before the cold restart.
  await waitForServerNotes(wrangler, boardId, 25);
  await eve.context.close();

  // The machine goes off overnight: kill + cold restart against the same disk.
  await wrangler.restart();

  // Morning: a brand-new session sees the identical board.
  const morn = await openParticipant(browser, url, boardId);
  await expect(morn.page.locator('.sticky-note')).toHaveCount(25);
  const after = await captureBoard(morn.page);
  expect(after).toEqual(before);
  await morn.context.close();
});

// ---------------------------------------------------------------------------
// TC-20: leave immediately (crash loses nothing already stored).
// ---------------------------------------------------------------------------

base('TC-20: a note is durable before it is ever broadcast', async ({ wrangler, browser }) => {
  const url = wrangler.url;
  // Story 5: the board must exist before anyone can open its link.
  const boardId = await newBoard(url);

  const alex = await openParticipant(browser, url, boardId);
  await createNoteAtWorld(alex.page, 0, 0, 'survivor');

  // A second person observes the note — proof it was stored (and broadcast).
  const sam = await openParticipant(browser, url, boardId);
  await expect(sam.page.locator('.sticky-note')).toHaveCount(1);

  // Both leave and the machine crashes within the same second.
  await Promise.all([alex.context.close(), sam.context.close()]);
  await wrangler.restart();

  // The note is still there.
  const later = await openParticipant(browser, url, boardId);
  await expect(later.page.locator('.sticky-note')).toHaveCount(1);
  expect((await later.page.locator('.sticky-note__text').textContent()) ?? '')
    .toContain('survivor');
  await later.context.close();
});

// ---------------------------------------------------------------------------
// TC-21: big board open within the load budget.
// ---------------------------------------------------------------------------

base('TC-21: a large board opens within the load budget', async ({ wrangler, browser }) => {
  const boardId = newBoardId();

  // Grow a PERSIST_TESTED_NOTES board (the log auto-compacts as it grows, so
  // the board ends as one snapshot — the single-SyncStep2 load path).
  await postHook(wrangler, boardId, 'seed', { count: PERSIST_TESTED_NOTES });

  // Cold start: the room must reconstruct from the snapshot on first connect.
  await wrangler.restart();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${wrangler.url}/b/${boardId}`);

  // navigation start -> every note element rendered, within the budget.
  const elapsedMs = await page.evaluate(async (expected: number) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (document.querySelectorAll('.sticky-note').length >= expected) {
        return performance.now();
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return -1;
  }, PERSIST_TESTED_NOTES);

  expect(elapsedMs).toBeGreaterThanOrEqual(0);
  expect(elapsedMs).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// TC-24: broken board (corrupt snapshot -> surfaced -> repaired live).
// ---------------------------------------------------------------------------

base('TC-24: a broken board is surfaced and then repaired live', async ({ wrangler, browser }) => {
  const boardId = newBoardId();
  const url = wrangler.url;

  // Build a 25-note board, compact it (so there is a snapshot to corrupt),
  // then corrupt that snapshot. All durable in the --persist-to directory.
  await postHook(wrangler, boardId, 'seed', { count: 25 });
  await postHook(wrangler, boardId, 'compact');
  await postHook(wrangler, boardId, 'corrupt-snapshot');

  // Cold start so the room loads the CORRUPTED snapshot on construct.
  await wrangler.restart();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${url}/b/${boardId}`);

  // The room could not load: the client is told so (4500 -> load_failed).
  await expect
    .poll(() => connectionState(page), { timeout: 20_000 })
    .toBe('load_failed');
  await expect(page.locator('.connection-status[data-state="load_failed"]')).toBeVisible();
  await expect(page.locator('.connection-status')).toContainText(
    "This board couldn't be loaded. Retrying…",
  );
  // Nothing is on the board yet and editing is locked.
  expect(await page.locator('.sticky-note').count()).toBe(0);

  // A double-click and the Sticky button must create nothing while broken.
  const vp = await page.locator(V).boundingBox();
  if (vp !== null) {
    await page.locator(V).dblclick({ position: { x: vp.width / 2, y: vp.height / 2 } });
  }
  await page.keyboard.press('Escape');
  expect(await page.locator('.sticky-note').count()).toBe(0);
  const stickyButton = page.locator('[aria-label="Sticky note"]');
  expect(await stickyButton.count()).toBe(1);
  expect(await stickyButton.isDisabled()).toBeTruthy();

  // Mark the page so a full reload would be detectable.
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });

  // Repair the snapshot; the room retries the load once the minimum interval
  // has elapsed and the (auto-reconnecting) client picks the board up live.
  await postHook(wrangler, boardId, 'repair');
  const retryDeadline = Date.now() + LOAD_RETRY_MIN_INTERVAL_MS + 25_000;
  while (Date.now() < retryDeadline) {
    if ((await page.locator('.sticky-note').count()) === 25) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // The board is back, live, without a reload.
  await expect(page.locator('.sticky-note')).toHaveCount(25);
  await expect(page.locator('.connection-status[data-state="load_failed"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload,
    ),
  ).toBe(true);

  // Editing works again: a double-click creates a note.
  const vp2 = await page.locator(V).boundingBox();
  if (vp2 !== null) {
    await page.locator(V).dblclick({ position: { x: vp2.width / 2, y: vp2.height / 2 } });
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.sticky-note')).toHaveCount(26);
  await ctx.close();
});
