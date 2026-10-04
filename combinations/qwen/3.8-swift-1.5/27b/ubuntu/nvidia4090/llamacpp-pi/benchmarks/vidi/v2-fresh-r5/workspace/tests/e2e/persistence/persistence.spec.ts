/**
 * E2E persistence across REAL process restarts (TC-19 to TC-21).
 *
 * Each test owns its own `wrangler dev --persist-to <dir>` process (started
 * and stopped here, no shared webServer) so it can kill and restart the server
 * mid-test. The cases prove the persist.room guarantees end-to-end: the room
 * reloads from SQLite after the process forgets memory, stores before
 * broadcast, and opens a large board completely.
 */
import { test, expect, type Page } from '@playwright/test';
import { startWranglerProcess, type WranglerProcess } from '../helpers/wrangler-process';
import { seedBoard } from '../helpers/seed-board';
import { Participant } from '../helpers/participants';
import { setCamera } from '../helpers/board';
import { newBoardId } from '../../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
} from '../../../src/shared/config';

const PORT = 20615;

/** Hex (#RRGGBB) → the computed-style "rgb(r, g, b)" form. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Full board snapshot: `text@x,y@rgb@stackIndex` per note, in DOM order (which
 * is z-order, since the client sorts notes by (z, id)). Captures text, colour,
 * position and stacking for the "identical after restart" assertion.
 */
async function fullSnapshot(page: Page): Promise<string[]> {
  return page.locator('[data-testid="sticky-note"]').evaluateAll((els) =>
    els.map((el, i) => {
      const style = el.getAttribute('style') ?? '';
      const left = /left:\s*([-\d.]+)px/.exec(style)?.[1] ?? '0';
      const top = /top:\s*([-\d.]+)px/.exec(style)?.[1] ?? '0';
      const bg =
        getComputedStyle(el).backgroundColor ||
        (el as HTMLElement).style.background ||
        '';
      const text = el.querySelector('[data-testid="sticky-text-display"]')?.textContent ?? '';
      return `${text}@${left},${top}@${bg}@${i}`;
    }),
  );
}

/** Open a board and wait until the client is connected and synced. */
async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');
}

test.describe('persistence across process restarts', () => {
  test('TC-19: overnight return — 25 varied notes survive a real restart', async ({ browser }) => {
    let wrangler: WranglerProcess | null = null;
    try {
      wrangler = await startWranglerProcess(PORT);
      const boardId = newBoardId();

      // Phase 1: create 25 varied notes in the browser.
      const context = await browser.newContext();
      const page = await context.newPage();
      await openBoard(page, boardId);
      const p = new Participant('A', context, page);
      // Zoom out so the 5x5 grid fits the viewport (world positions are
      // camera-independent, so the snapshot comparison is unaffected).
      await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
      for (let i = 0; i < 25; i++) {
        const x = 120 + (i % 5) * 150;
        const y = 120 + Math.floor(i / 5) * 150;
        await p.createNote(`note ${i}`, x, y);
      }
      // Vary the colour of a few notes (the rest stay the default yellow).
      const recolors: Array<[string, string]> = [
        ['note 0', 'orange'],
        ['note 7', 'green'],
        ['note 13', 'blue'],
        ['note 21', 'violet'],
      ];
      for (const [text, color] of recolors) {
        await p.selectNote(text);
        await p.recolorSelected(color, hexToRgb(STICKY_COLORS[color as keyof typeof STICKY_COLORS]));
      }
      const before = await fullSnapshot(page);
      expect(before).toHaveLength(25);
      await context.close();

      // Phase 2: kill the process and restart it over the same persist dir.
      const persistDir = wrangler.persistDir;
      await wrangler.stop();
      wrangler = await startWranglerProcess(PORT, persistDir);

      // Phase 3: reopen the board — all 25 notes identical.
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();
      await openBoard(page2, boardId);
      await expect
        .poll(async () => page2.locator('[data-testid="sticky-note"]').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(25);
      const after = await fullSnapshot(page2);
      expect(after).toEqual(before);
      await context2.close();
    } finally {
      await wrangler?.stop();
    }
  });

  test('TC-20: leave immediately — note present after a fast kill+restart', async ({ browser }) => {
    let wrangler: WranglerProcess | null = null;
    try {
      wrangler = await startWranglerProcess(PORT);
      const boardId = newBoardId();

      // Alex and Sam on the same board.
      const alexCtx = await browser.newContext();
      const alex = await alexCtx.newPage();
      await openBoard(alex, boardId);
      const samCtx = await browser.newContext();
      const sam = await samCtx.newPage();
      await openBoard(sam, boardId);

      // Alex creates a note; poll until Sam sees it (broadcast delivered).
      const alexP = new Participant('Alex', alexCtx, alex);
      await alexP.createNote('ephemeral', 300, 300);
      await expect
        .poll(async () => sam.locator('[data-testid="sticky-note"]:has-text("ephemeral")').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(1);

      // Immediately close both contexts and kill the process (well under 1 s):
      // the note was appended before it was broadcast, so it is on disk.
      const persistDir = wrangler.persistDir;
      await Promise.all([alexCtx.close(), samCtx.close()]);
      await wrangler.stop();
      wrangler = await startWranglerProcess(PORT, persistDir);

      // Reopen: the note is present.
      const context = await browser.newContext();
      const page = await context.newPage();
      await openBoard(page, boardId);
      await expect
        .poll(async () => page.locator('[data-testid="sticky-note"]:has-text("ephemeral")').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(1);
      await context.close();
    } finally {
      await wrangler?.stop();
    }
  });

  test('TC-21: big board open — PERSIST_TESTED_NOTES notes all render', async ({ browser }) => {
    let wrangler: WranglerProcess | null = null;
    try {
      wrangler = await startWranglerProcess(PORT);
      const boardId = newBoardId();

      // Seed the board's persisted state directly (no browser).
      await seedBoard(PORT, boardId, PERSIST_TESTED_NOTES);

      // Open a fresh context and wait until every note element is rendered.
      const context = await browser.newContext();
      const page = await context.newPage();
      const navStart = Date.now();
      await openBoard(page, boardId);
      await expect
        .poll(async () => page.locator('[data-testid="sticky-note"]').count(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
          intervals: [200, 500, 1000],
        })
        .toBe(PERSIST_TESTED_NOTES);
      const renderedMs = Date.now() - navStart;
      // Reported, not asserted: model, browser and server share one machine.
      console.log(
        `[big-board] ${PERSIST_TESTED_NOTES} notes rendered in ${renderedMs}ms` +
          `${renderedMs > BOARD_LOAD_BUDGET_MS ? ` (over ${BOARD_LOAD_BUDGET_MS}ms budget — reported, not asserted)` : ''}`,
      );
      await context.close();
    } finally {
      await wrangler?.stop();
    }
  });
});
