import { expect, test } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { setCamera, settle } from './helpers/board';

// Story 4 end-to-end: these tests drive a real `wrangler dev --persist-to`
// process through start / kill / restart cycles so reload-after-restart runs
// against real persisted storage, and use the TEST_HOOKS-only endpoints to
// seed, snapshot, corrupt and repair boards server-side.
const PORT = Number(process.env.VIDI6_E2E_PORT ?? 27618);
const INSPECTOR_PORT = Number(process.env.VIDI6_INSPECTOR_PORT ?? 27619);
const BASE = `http://127.0.0.1:${PORT}`;

const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
let child: ChildProcess | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--inspector-port',
        String(INSPECTOR_PORT),
        '--persist-to',
        persistDir,
        '--var',
        'TEST_HOOKS:1',
        '--local'
      ],
      {
        stdio: 'ignore',
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
      }
    );
    const deadline = Date.now() + 180_000;
    const probe = (): void => {
      void fetch(BASE + '/')
        .then((response) => {
          if (response.status < 500) resolve();
          else again();
        })
        .catch(again);
    };
    const again = (): void => {
      if (Date.now() > deadline) reject(new Error('wrangler dev did not become ready'));
      else setTimeout(probe, 500);
    };
    probe();
  });
}

async function stopServer(): Promise<void> {
  const processHandle = child;
  child = null;
  if (processHandle !== null) {
    processHandle.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => processHandle.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 20_000))
    ]);
  }
  // Wait until the port stops answering so the restart binds cleanly.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE + '/');
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch {
      return;
    }
  }
}

async function restartServer(): Promise<void> {
  await stopServer();
  await startServer();
}

async function hook(boardId: string, action: string, query = ''): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/__test/boards/${boardId}/${action}${query}`, { method: 'POST' });
  if (!response.ok) throw new Error(`hook ${action} failed: ${String(response.status)}`);
  return (await response.json()) as Record<string, unknown>;
}

interface NoteView {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  background: string;
  text: string;
}

async function readNotes(page: import('@playwright/test').Page): Promise<NoteView[]> {
  return page.evaluate(() => {
    const roots = [
      ...document.querySelectorAll<HTMLElement>('[data-testid^="sticky-"]')
    ].filter((el) => {
      const id = el.getAttribute('data-testid') ?? '';
      return id.startsWith('sticky-') && !id.startsWith('sticky-text-') && id.length > 'sticky-'.length;
    });
    return roots.map((el) => {
      const box = el.getBoundingClientRect();
      const textEl = el.querySelector<HTMLElement>(`[data-testid="sticky-text-${el.getAttribute('data-testid')!.slice(7)}"]`);
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        z: Number(el.style.zIndex),
        background: getComputedStyle(el).backgroundColor,
        text: textEl?.textContent ?? ''
      };
    });
  });
}

test.beforeAll(() => {
  execSync('npm run build:test', { stdio: 'ignore' });
  return startServer();
});

test.afterAll(async () => {
  await stopServer();
  rmSync(persistDir, { recursive: true, force: true });
});

test('TC-19 notes survive a kill and restart of the persisted dev process', async ({ browser }) => {
  const boardId = newBoardId();
  const page = await browser.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();

  for (let i = 0; i < 25; i += 1) {
    const gx = 250 + (i % 5) * 200;
    const gy = 100 + Math.floor(i / 5) * 180;
    // Park each note's world position under a fixed screen point so the
    // double-click always lands on fresh grid.
    await setCamera(page, { x: gx - 400, y: gy - 360, zoom: 1 });
    await page.mouse.dblclick(400, 360);
    await page.getByTestId('sticky-editor').waitFor();
    await page.keyboard.type(`note ${String(i)}`);
    await page.keyboard.press('Escape');
    await settle(page);
    if (i === 2) await page.getByRole('button', { name: 'Violet colour' }).click();
    if (i === 11) await page.getByRole('button', { name: 'Blue colour' }).click();
  }
  // Restore the exact default camera so captured screen geometry depends
  // only on world state (a restarted process comes back to this camera).
  await setCamera(page, { x: -640, y: -400, zoom: 1 });
  const before = await readNotes(page);
  expect(before).toHaveLength(25);

  await page.context().close();
  await restartServer();

  const page2 = await browser.newPage();
  await page2.goto(`/b/${boardId}`);
  await expect.poll(() => readNotes(page2), { timeout: 30_000 }).toEqual(before);
  await page2.context().close();
});

test('TC-20 a note visible to a second viewer survives an immediate kill', async ({ browser }) => {
  const boardId = newBoardId();
  const alex = await browser.newPage();
  const sam = await browser.newPage();
  await alex.goto(`/b/${boardId}`);
  await sam.goto(`/b/${boardId}`);
  await alex.mouse.dblclick(640, 400);
  await alex.getByTestId('sticky-editor').waitFor();
  await alex.keyboard.type('durable note');
  await alex.keyboard.press('Escape');
  await expect(sam.getByText('durable note')).toBeVisible({ timeout: 5_000 });

  // Within one second of the change being live: close both viewers and kill
  // the process; the append already completed before the broadcast did.
  await alex.context().close();
  await sam.context().close();
  await stopServer();
  await startServer();

  const page2 = await browser.newPage();
  await page2.goto(`/b/${boardId}`);
  await expect(page2.getByText('durable note')).toBeVisible({ timeout: 30_000 });
  await page2.context().close();
});

test('TC-21 a seeded 2000-note board renders fully; load time is logged against the budget', async ({ browser }) => {
  const boardId = newBoardId();
  await hook(boardId, 'seed', `?count=${String(PERSIST_TESTED_NOTES)}`);
  await hook(boardId, 'compact');

  const started = Date.now();
  const page = await browser.newPage();
  await page.goto(`/b/${boardId}`);
  await expect
    .poll(async () => (await readNotes(page)).length, { timeout: 120_000, intervals: [250] })
    .toBe(PERSIST_TESTED_NOTES);
  const elapsed = Date.now() - started;
  console.log(
    `[persistence] ${String(PERSIST_TESTED_NOTES)} notes navigated-to-rendered in ${String(elapsed)} ms ` +
      `(budget ${String(BOARD_LOAD_BUDGET_MS)} ms)`
  );
  await page.context().close();
});

test('TC-24 a damaged snapshot shows the red message and the board recovers after repair without a reload', async ({ browser }) => {
  const boardId = newBoardId();
  await hook(boardId, 'seed', '?count=25');
  await hook(boardId, 'compact');

  const page = await browser.newPage();
  await page.goto(`/b/${boardId}`);
  await expect.poll(() => readNotes(page), { timeout: 30_000 }).toHaveLength(25);

  await hook(boardId, 'corrupt-snapshot');
  await restartServer();

  // The room wakes, cannot read the snapshot, and every socket attempt is
  // closed 4500; the provider retries and the badge appears without a reload.
  const badge = page.getByTestId('connection-status');
  await expect
    .poll(() => badge.getAttribute('data-state'), { timeout: 60_000, intervals: [500] })
    .toBe('load_failed');
  await expect(badge).toContainText("This board couldn't be loaded");

  // Not editable: the Sticky note button is disabled and a double-click adds
  // nothing (the already-rendered notes stay visible but frozen).
  expect((await page.getByRole('button', { name: 'Sticky note' }).isDisabled())).toBe(true);
  await page.mouse.dblclick(640, 400);
  expect(await readNotes(page)).toHaveLength(25);

  await hook(boardId, 'repair-snapshot');
  // The provider retries by itself; once the room reloads the repaired
  // snapshot the badge disappears — without a page reload.
  await expect(badge).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => readNotes(page), { timeout: 30_000 }).toHaveLength(25);
  await page.context().close();
});
