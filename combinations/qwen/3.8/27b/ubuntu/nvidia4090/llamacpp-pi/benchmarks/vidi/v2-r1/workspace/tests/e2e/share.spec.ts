// Story 5 e2e (Chromium, against a real `wrangler dev`): TC-26–TC-29, TC-31.
//
// These specs run under playwright.share.config.ts — no shared Vite webServer;
// each test starts and kills its own wrangler process (real Worker, real
// Durable Objects, real SQLite), so the unknown-board 404s and the legacy
// board path are proven on the real server.

import { test, expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { createRetroBoard } from '../fixtures/boards';
import { createWranglerProcess, testHook } from './wrangler-process';

type Vidi6Hooks = {
  createNoteAt: (x: number, y: number, color: string, text: string) => string | null;
  getNotes: () => Array<{ id: string; x: number; y: number; color: string; text: string; z: number }>;
};

async function waitForHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as { __vidi6?: unknown }).__vidi6 !== undefined, null, {
    timeout: 15_000,
  });
}

/** Create a board through the story 5 API and return its id. */
async function createBoardViaApi(base: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createNoteAt(page: Page, x: number, y: number, color: string, text: string): Promise<void> {
  await page.evaluate(([a, b, c, t]) => {
    const hooks = (window as { __vidi6?: Vidi6Hooks }).__vidi6;
    if (hooks === undefined) throw new Error('test hooks not installed');
    if (hooks.createNoteAt(a, b, c, t) === null) throw new Error('note creation failed');
  }, [x, y, color, text] as const);
}

/** The 25-note retro board as a single state update (legacy seed payload). */
function retroBoardUpdate(seed = 7): Uint8Array {
  const doc = new Y.Doc();
  createRetroBoard(doc, seed);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

test.describe('sharing a board with a link (story 5)', () => {
  test('TC-26: create → copy the link → a second browser joins the same board and edits', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();

      // --- Maya: create a board from the home page ---
      const ctxMaya = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
      const maya = await ctxMaya.newPage();
      await maya.goto('/');
      const t0 = Date.now();
      await maya.getByRole('button', { name: 'New board' }).click();
      await maya.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      const createMs = Date.now() - t0;
      console.log(`[TC-26] click → board visible in ${createMs}ms (budget ${CREATE_BUDGET_MS}ms, reported only)`);

      const url = new URL(maya.url());
      expect(url.pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
      const boardId = url.pathname.slice(3);

      // Maya adds a note.
      await createNoteAt(maya, 400, 300, 'green', 'hello from Maya');
      await expect(maya.getByTestId('sticky-note')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // --- Maya: copy the link from the Share panel ---
      await maya.getByRole('button', { name: 'Share' }).click();
      await expect(maya.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      await maya.getByRole('button', { name: 'Copy link' }).click();
      await expect(maya.getByRole('button', { name: /Link copied/ })).toBeVisible({
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      const link = await maya.evaluate(() => navigator.clipboard.readText());
      expect(link).toBe(`${wrangler.base}/b/${boardId}`);

      // --- Sam: opens the clipboard link in a fresh browser context ---
      const ctxSam = await browser.newContext();
      const sam = await ctxSam.newPage();
      await sam.goto(link);
      await sam.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      // Sam sees Maya's note without any further step.
      await expect(sam.getByTestId('sticky-note')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(sam.getByTestId('sticky-note')).toHaveText('hello from Maya', {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });

      // Sam edits; Maya sees the edit.
      await createNoteAt(sam, 600, 400, 'blue', 'note from Sam');
      await expect(maya.getByTestId('sticky-note')).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await ctxMaya.close();
      await ctxSam.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-27: a link to a board that does not exist → Board not found; New board opens a fresh board', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await page.goto(`/b/${newBoardId()}`);
      await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible({
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });

      // Nothing is created at the mistyped address: the check still 404s.
      const unknownId = new URL(page.url()).pathname.slice(3);
      const res = await fetch(`${wrangler.base}/api/boards/${unknownId}`);
      expect(res.status).toBe(404);

      // New board from the not-found page opens a fresh board.
      await page.getByRole('button', { name: 'New board' }).click();
      await page.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      expect(new URL(page.url()).pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
      expect(new URL(page.url()).pathname.slice(3)).not.toBe(unknownId);
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-28: service unreachable on open → retry message → the board opens without a reload', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      const boardId = await createBoardViaApi(wrangler.base);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // The existence check cannot reach the service.
      await page.route('**/api/boards/*', (route) => route.abort());
      await page.goto(`/b/${boardId}`);
      await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });

      // The service becomes reachable again; the retry succeeds without a
      // reload and the board opens.
      await page.unroute('**/api/boards/*');
      await page.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-29: clipboard blocked → the full link is selected with the Ctrl+C hint', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      const boardId = await createBoardViaApi(wrangler.base);

      const ctx = await browser.newContext();
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: () => Promise.reject(new Error('NotAllowedError: clipboard blocked')),
          },
          configurable: true,
        });
      });
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await page.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      await page.getByRole('button', { name: 'Share' }).click();
      await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      await page.getByRole('button', { name: 'Copy link' }).click();
      await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();

      const link = `${wrangler.base}/b/${boardId}`;
      const selection = await page.evaluate(() => {
        const el = document.querySelector('input[readonly]') as HTMLInputElement;
        return { value: el.value, start: el.selectionStart, end: el.selectionEnd };
      });
      expect(selection.value).toBe(link);
      expect(selection.start).toBe(0);
      expect(selection.end).toBe(link.length);
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-31: a pre-story-5 board (updates row, no created_at) opens with its notes, not Board not found', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      const boardId = newBoardId();
      const seeded = await testHook(boardId, 'seed-legacy', retroBoardUpdate(7));
      expect(seeded.status).toBe(200);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await page.getByTestId('board-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(page.getByTestId('sticky-note')).toHaveCount(25, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });
});
