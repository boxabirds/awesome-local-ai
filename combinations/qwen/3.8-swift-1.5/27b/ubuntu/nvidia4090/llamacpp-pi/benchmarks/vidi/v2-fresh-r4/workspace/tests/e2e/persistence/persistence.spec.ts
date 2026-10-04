import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WranglerProcess } from '../helpers/wrangler-process';
import { seedBoard } from '../helpers/seed-board';
import { setCamera, settle } from '../helpers/board';
import { newBoardId } from '../../../src/shared/board-id';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

const SERVER_PORT = 27242;
const INSPECTOR_PORT = 27243;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Worker-scoped fixture: one real `wrangler dev --persist-to <tmp>` process for
 * the whole suite (workers: 1). Tests share it (boards are isolated by id) and
 * may restart it mid-test to simulate a process death.
 */
const test = base.extend<{}, { wrangler: WranglerProcess }>({
  wrangler: [
    async ({}, use) => {
      const persistDir = mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
      const proc = new WranglerProcess({
        port: SERVER_PORT,
        inspectorPort: INSPECTOR_PORT,
        persistDir,
        cwd: REPO_ROOT,
        // Enables the test-only /test/corrupt + /test/repair hooks used by TC-24.
        testHooks: true,
      });
      await proc.start();
      await use(proc);
      await proc.stop();
      rmSync(persistDir, { recursive: true, force: true });
    },
    { scope: 'worker' as const },
  ],
});

interface NotePos {
  text: string;
  cx: number;
  cy: number;
}

/** Read every rendered sticky note's text and screen-centre. */
async function readNotes(page: Page): Promise<NotePos[]> {
  const notes = page.locator('[data-vidi6="sticky-note"]');
  const count = await notes.count();
  const out: NotePos[] = [];
  for (let i = 0; i < count; i++) {
    const noteEl = notes.nth(i);
    const box = (await noteEl.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const text = (await noteEl.locator('[data-vidi6="sticky-text-display"]').textContent())?.trim() ?? '';
    out.push({ text, cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
  }
  return out;
}

/** Open a fresh context on a board and wait for the canvas + camera to settle. */
async function openBoard(browser: import('@playwright/test').Browser, boardId: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await setCamera(page, { x: -640, y: -400, zoom: 1 });
  await settle(page);
  return context;
}

async function createNoteAt(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Match notes by unique text; assert the two sets agree on position within tolerance. */
function assertSameNotes(before: NotePos[], after: NotePos[], tol = 3): void {
  expect(after.length).toBe(before.length);
  const afterByText = new Map(after.map((n) => [n.text, n]));
  for (const b of before) {
    const a = afterByText.get(b.text);
    expect(a, `note "${b.text}" missing after restart`).toBeTruthy();
    expect(Math.abs(a!.cx - b.cx), `note "${b.text}" x drift`).toBeLessThanOrEqual(tol);
    expect(Math.abs(a!.cy - b.cy), `note "${b.text}" y drift`).toBeLessThanOrEqual(tol);
  }
}

// 5x5 grid of screen positions for the 25-note board.
const GRID_COLS = [200, 400, 600, 800, 1000];
const GRID_ROWS = [100, 240, 380, 520, 660];

test.describe('persistence e2e (real wrangler --persist-to)', () => {
  // TC-19: overnight return — 25 notes survive a process restart at the same positions.
  test('TC-19: 25-note board survives a restart, identical positions and text', async ({ browser, wrangler }) => {
    const boardId = newBoardId();

    // Phase 1: create the board in a browser.
    const ctx1 = await openBoard(browser, boardId);
    const page = ctx1.pages()[0];
    let i = 0;
    for (const y of GRID_ROWS) {
      for (const x of GRID_COLS) {
        await createNoteAt(page, x, y, `n${String(i).padStart(2, '0')}`);
        i++;
      }
    }
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(25);
    const before = await readNotes(page);

    // Verify all 25 are durably stored: a fresh client must see them via initial
    // sync (proves the server has them, not just Alex's local doc).
    const ctxVerify = await openBoard(browser, boardId);
    const verify = ctxVerify.pages()[0];
    await expect(verify.locator('[data-vidi6="sticky-note"]')).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await ctxVerify.close();
    await ctx1.close();

    // Phase 2: kill the process (simulates a restart) and bring it back.
    await wrangler.restart();

    // Phase 3: reopen the same board in a fresh context and compare.
    const ctx2 = await openBoard(browser, boardId);
    const page2 = ctx2.pages()[0];
    await expect(page2.locator('[data-vidi6="sticky-note"]')).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const after = await readNotes(page2);
    assertSameNotes(before, after);
    await ctx2.close();
  });

  // TC-20: immediate exit — a note observed by a second client survives a hard kill.
  test('TC-20: note observed by Sam survives a hard kill + restart', async ({ browser, wrangler }) => {
    const boardId = newBoardId();
    const TEXT = `crash-${boardId.slice(0, 6)}`;

    // Alex creates the note.
    const ctxAlex = await openBoard(browser, boardId);
    const alex = ctxAlex.pages()[0];
    await createNoteAt(alex, 640, 400, TEXT);
    await expect(alex.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);

    // Sam opens the same board (fresh context) and polls until the note appears.
    const ctxSam = await openBoard(browser, boardId);
    const sam = ctxSam.pages()[0];
    await expect(sam.locator('[data-vidi6="sticky-note"]')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Hard kill: close both contexts and SIGKILL the process (no graceful drain).
    await ctxAlex.close();
    await ctxSam.close();
    await wrangler.stop();

    // Restart and reopen: the note must be there.
    await wrangler.start();
    const ctx3 = await openBoard(browser, boardId);
    const page = ctx3.pages()[0];
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const notes = await readNotes(page);
    expect(notes[0]?.text).toBe(TEXT);
    await ctx3.close();
  });

  // TC-21: big board open — PERSIST_TESTED_NOTES notes all render; time is logged.
  test('TC-21: large board (PERSIST_TESTED_NOTES) fully renders on open', async ({ browser, wrangler }) => {
    const boardId = newBoardId();

    // Seed the board over a real WebSocket (fast, one update).
    await seedBoard(wrangler.url, boardId, PERSIST_TESTED_NOTES);

    // Open a fresh context and wait for all notes to render.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const navStart = Date.now();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect
      .poll(() => page.locator('[data-vidi6="sticky-note"]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(PERSIST_TESTED_NOTES);
    const renderMs = Date.now() - navStart;
    console.log(`[TC-21] large board rendered in ${renderMs}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`);
    await ctx.close();
  });

  // TC-24: broken board — honest failure, edit lock. Recovery after repair is
  // covered by the integration tests (board-room-persistence TC-18); the E2E
  // test verifies the user-visible load-failure state.
  test('TC-24: a board that fails to load shows an honest error and locks editing', async ({ browser, wrangler }) => {
    const boardId = newBoardId();

    // Seed 25 notes (the room stores them, then goes idle).
    await seedBoard(wrangler.url, boardId, 25);

    // Corrupt the snapshot so the next load fails (worker runs with TEST_HOOKS=1).
    const corruptRes = await fetch(`${wrangler.url}/test/corrupt?board=${boardId}`);
    expect(corruptRes.status).toBe(200);

    // Open the board: it must show the honest load-failure message, be empty and
    // uneditable (never presented as an empty editable board).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    const status = page.locator('[role="status"]');
    await expect(status).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(status).toContainText("couldn't be loaded");

    const stickyBtn = page.getByRole('button', { name: /sticky note/i });
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(0);
    await expect(stickyBtn).toBeDisabled();

    // The board must NOT be presented as an empty editable board: no notes,
    // editing locked, clear error message.
    await ctx.close();
  });
});
