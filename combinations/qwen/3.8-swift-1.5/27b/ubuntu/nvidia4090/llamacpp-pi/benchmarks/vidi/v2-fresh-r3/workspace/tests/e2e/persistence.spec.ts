import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
// @ts-ignore — Node APIs for process management (e2e runs under Node, not the browser tsconfig)
import { spawn } from 'node:child_process';
// @ts-ignore
import type { ChildProcess } from 'node:child_process';
// @ts-ignore
import { mkdirSync, rmSync } from 'node:fs';
import { getNotesState, type NoteState } from './helpers/board';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS } from '../../src/shared/config';

const nodeProcess = (globalThis as any).process as {
  env: Record<string, string | undefined>;
  stdout?: { write?: (s: string) => void };
  stderr?: { write?: (s: string) => void };
};

/**
 * Story 4 — persistence E2E (TC-19 to TC-21).
 *
 * These tests control a real `wrangler dev --persist-to` process: data is written
 * to a local SQLite file, the process is killed (memory wiped) and restarted, and
 * the board is verified to be intact. Only a real process restart proves that
 * forgetting memory does not lose data.
 *
 * The persistence server runs on its own port (23031) so it does not collide with
 * the shared e2e webServer (23024). Each test uses a fresh persist directory.
 */

const PORT = 23031;
const BASE = `http://127.0.0.1:${PORT}`;
const E2E_EVENTUAL_TIMEOUT_MS = 20000;

let server: ChildProcess | null = null;

async function startServer(persistDir: string): Promise<void> {
  mkdirSync(persistDir, { recursive: true });
  server = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistDir],
    { stdio: ['ignore', 'pipe', 'pipe'], env: nodeProcess.env as Record<string, string>, cwd: (nodeProcess as any).cwd ? (nodeProcess as any).cwd() : '/w/workspace' },
  );
  server.stdout?.on('data', (d: unknown) => nodeProcess.env.PERSIST_E2E_DEBUG && nodeProcess.stdout?.write?.(`[srv] ${String(d)}`));
  server.stderr?.on('data', (d: unknown) => nodeProcess.env.PERSIST_E2E_DEBUG && nodeProcess.stderr?.write?.(`[srv!] ${String(d)}`));
  await waitForServer(BASE);
}

async function stopServer(): Promise<void> {
  if (!server) return;
  const p = server;
  server = null;
  p.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 800));
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('persistence server did not start');
}

/** Opens a fresh context + page on the persistence server for a specific board. */
async function openBoard(browser: Browser, boardId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  return ctx;
}

async function noteCount(ctx: BrowserContext): Promise<number> {
  const page = ctx.pages()[0];
  if (!page) return 0;
  return (await getNotesState(page)).length;
}

function persistDir(name: string): string {
  return `/tmp/vidi6-persist-${name}`;
}

test.describe('persistence e2e (story 4)', () => {
  test.afterAll(async () => {
    await stopServer();
  });

  test('TC-19: overnight return — 25 notes survive a process restart', async ({ page }, testInfo) => {
    testInfo.setTimeout(120000);
    const browser: Browser = page.context().browser()!;
    const dir = persistDir('tc19');
    rmSync(dir, { recursive: true, force: true });
    await startServer(dir);

    // Create 25 notes, then leave.
    const boardId = 'tc19boardAAAAAAAAAAAAA';
    const ctx1 = await openBoard(browser, boardId);
    // Wait for the WebSocket connection to be established.
    await ctx1.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    const ids = await ctx1.pages()[0]!.evaluate((n) => (window as any).__vidi6.createNotes(n), 25);
    expect(ids).toHaveLength(25);
    await expect.poll(() => noteCount(ctx1), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
    const before: NoteState[] = await getNotesState(ctx1.pages()[0]!);
    await ctx1.close();
    // Allow workerd to flush storage to the persist SQLite before the kill.
    await new Promise((r) => setTimeout(r, 5000));

    // Kill and restart the process (memory wiped, SQLite remains).
    await stopServer();
    await startServer(dir);

    // Reopen: the board is exactly as it was left.
    const ctx2 = await openBoard(browser, boardId);
    await ctx2.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await expect.poll(() => noteCount(ctx2), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
    const after: NoteState[] = await getNotesState(ctx2.pages()[0]!);
    const beforeMap = new Map(before.map((n) => [n.id, n]));
    expect(after).toHaveLength(25);
    for (const n of after) {
      const b = beforeMap.get(n.id);
      expect(b, `note ${n.id} missing after restart`).toBeTruthy();
      expect(n.x).toBeCloseTo(b!.x, 0);
      expect(n.y).toBeCloseTo(b!.y, 0);
      expect(n.color).toBe(b!.color);
      expect(n.text).toBe(b!.text);
    }
    await ctx2.close();
    await stopServer();
  });

  test('TC-20: leave immediately — a seen note survives immediate exit + restart', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120000);
    const browser: Browser = page.context().browser()!;
    const dir = persistDir('tc20');
    rmSync(dir, { recursive: true, force: true });
    await startServer(dir);

    // Alex creates a note.
    const boardId = 'tc20boardAAAAAAAAAAAAA';
    const alex = await openBoard(browser, boardId);
    await alex.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await alex.pages()[0]!.evaluate(() => (window as any).__vidi6.createNotes(1));
    await expect.poll(() => noteCount(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Sam sees it (it was stored, not just in Alex's memory).
    const sam = await openBoard(browser, boardId);
    await sam.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Both leave within the same second; the process is killed.
    await alex.close();
    await sam.close();
    await stopServer();

    // Restart and reopen: the note is still there.
    await startServer(dir);
    const ctx3 = await openBoard(browser, boardId);
    await ctx3.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await expect.poll(() => noteCount(ctx3), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await ctx3.close();
    await stopServer();
  });

  test('TC-21: big board opens completely; load time logged against budget', async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(180000);
    const browser: Browser = page.context().browser()!;
    const dir = persistDir('tc21');
    rmSync(dir, { recursive: true, force: true });
    await startServer(dir);

    // Seed PERSIST_TESTED_NOTES notes.
    const boardId = 'tc21boardAAAAAAAAAAAAA';
    const seed = await openBoard(browser, boardId);
    await seed.pages()[0]!.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await seed.pages()[0]!.evaluate(
      (n) => (window as any).__vidi6.createNotes(n),
      PERSIST_TESTED_NOTES,
    );
    await expect.poll(() => noteCount(seed), { timeout: 60000 }).toBe(PERSIST_TESTED_NOTES);
    await seed.close();

    // A fresh context opens the board; measure navigation-to-rendered time.
    const ctx = await browser.newContext();
    const freshPage = await ctx.newPage();
    const t0 = Date.now();
    await freshPage.goto(`${BASE}/b/${boardId}`);
    await freshPage.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: 15000 });
    await expect
      .poll(async () => (await getNotesState(freshPage)).length, { timeout: 60000 })
      .toBe(PERSIST_TESTED_NOTES);
    const loadTime = Date.now() - t0;
    // Logged, not asserted (shared machine): reported against the budget.
    console.log(
      `TC-21: ${PERSIST_TESTED_NOTES} notes rendered in ${loadTime}ms ` +
        `(budget ${BOARD_LOAD_BUDGET_MS}ms, ${loadTime <= BOARD_LOAD_BUDGET_MS ? 'within' : 'over'} budget)`,
    );
    await ctx.close();
    await stopServer();
  });
});

