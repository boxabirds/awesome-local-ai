import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  type StickyColor,
} from '../../../src/shared/config';
import {
  apiCreateBoard,
  createNoteAt,
  moveNote,
  noteCount,
  openBoard,
  recolorNote,
  setCamera,
  snapshotNotes,
  typeText,
} from '../helpers';

/**
 * Nightly, long-running collaboration tests. These run only in the `nightly`
 * project (see playwright.config.ts) and are intentionally slow: TC-29 holds
 * the board idle for 45s and TC-30 soaks the room with continuous edits for
 * 60s. Latency is measured and logged against the budget, never asserted.
 */

const COLORS = Object.keys({
  yellow: 0,
  orange: 0,
  green: 0,
  blue: 0,
  pink: 0,
  violet: 0,
}) as StickyColor[];

interface Participant {
  context: BrowserContext;
  page: Page;
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  return { context, page };
}

async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

/** True if any note on the page has text containing `marker`. */
async function anyNoteHasText(page: Page, marker: string): Promise<boolean> {
  const snap = await snapshotNotes(page);
  return snap.some((n) => n.text.includes(marker));
}

/** A deterministic PRNG so the soak is reproducible per run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** percentile of a sorted array */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

test.describe('nightly soak (chromium)', () => {
  test('TC-29: an idle board never drops — badge stays connected for 45s', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const a = await join(browser, board);
    const b = await join(browser, board);
    try {
      // put a little content on the board so it is a "real" session
      await createNoteAt(a.page, 400, 300);

      const IDLE_MS = 45_000;
      const POLL_MS = 2_000;
      const sawReconnecting: string[] = [];
      const deadline = Date.now() + IDLE_MS;
      while (Date.now() < deadline) {
        const [sa, sb] = await Promise.all([
          a.page.evaluate(() => window.__vidi6?.connectionState),
          b.page.evaluate(() => window.__vidi6?.connectionState),
        ]);
        if (sa === 'reconnecting') sawReconnecting.push(`alex@${Date.now() - (deadline - IDLE_MS)}ms`);
        if (sb === 'reconnecting') sawReconnecting.push(`sam@${Date.now() - (deadline - IDLE_MS)}ms`);
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      // the awareness relay keeps the connection alive: never "reconnecting"
      expect(sawReconnecting).toEqual([]);
      const endA = await a.page.evaluate(() => window.__vidi6?.connectionState);
      const endB = await b.page.evaluate(() => window.__vidi6?.connectionState);
      expect(endA).toBe('connected');
      expect(endB).toBe('connected');
    } finally {
      await closeAll(a, b);
    }
  }, 120_000);

  test('TC-30: capacity soak — 5 editors, 60s of continuous edits, converge identically', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const ps: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) ps.push(await join(browser, board));
    try {
      const SOAK_MS = 60_000;
      const oracle = ps[0].page;
      const latencies: number[] = [];
      const seed = 0x50a7_2024;

      // Zoom out so each note (200 world units) is 80px on screen; a 6-column
      // x 5-row grid at 110/100px spacing then has no overlapping notes, and
      // each editor owns one row so editors never collide.
      for (const p of ps) await setCamera(p.page, -640, -400, 0.4);
      const COLS = 6;
      const colX = (c: number) => 100 + c * 110;
      const rowY = (i: number) => 110 + i * 100;

      const runEditor = async (i: number) => {
        const page = ps[i].page;
        const rnd = mulberry32(seed + i * 101);
        const deadline = Date.now() + SOAK_MS;
        const slots: { c: number; x: number; y: number }[] = [];
        const freeCols = () =>
          Array.from({ length: COLS }, (_, c) => c).filter((c) => !slots.some((s) => s.c === c));
        let n = 0;
        while (Date.now() < deadline) {
          n++;
          const free = freeCols();
          const roll = rnd();
          if (slots.length === 0 || (free.length > 0 && roll < 0.45)) {
            // create a marker note in a free column and measure its arrival at the oracle
            if (free.length === 0) continue;
            const c = free[Math.floor(rnd() * free.length)];
            const x = colX(c);
            const y = rowY(i);
            const marker = `E${i}-${n}`;
            const t0 = Date.now();
            await createNoteAt(page, x, y);
            await typeText(page, x, y, marker);
            slots.push({ c, x, y });
            if (i !== 0) {
              const start = Date.now();
              let ok = false;
              for (;;) {
                if (await anyNoteHasText(oracle, marker)) {
                  ok = true;
                  break;
                }
                if (Date.now() - start > 5000) break;
                await new Promise((r) => setTimeout(r, 80));
              }
              if (ok) latencies.push(Date.now() - t0);
            }
          } else {
            // operate on one of this editor's existing notes
            const s = slots[Math.floor(rnd() * slots.length)];
            const op = rnd();
            if (op < 0.4) {
              await typeText(page, s.x, s.y, `E${i}-${n}`);
            } else if (op < 0.7) {
              const free2 = freeCols();
              if (free2.length > 0) {
                const c2 = free2[Math.floor(rnd() * free2.length)];
                const nx = colX(c2);
                await moveNote(page, { x: s.x, y: s.y }, { x: nx, y: s.y });
                s.c = c2;
                s.x = nx;
              }
            } else {
              await recolorNote(page, s.x, s.y, COLORS[Math.floor(rnd() * COLORS.length)]);
            }
          }
        }
      };

      await Promise.all(ps.map((_, i) => runEditor(i)));

      // stop editing; let the room settle and all contexts converge
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        await expect
          .poll(
            async () =>
              JSON.stringify(await snapshotNotes(oracle)) ===
              JSON.stringify(await snapshotNotes(ps[i].page)),
            { timeout: 30_000 },
          )
          .toBe(true);
      }
      const total = await noteCount(oracle);
      const sorted = [...latencies].sort((x, y) => x - y);
      console.log(
        `[soak] editors=${MAX_CONCURRENT_EDITORS} duration=${SOAK_MS}ms finalNotes=${total} ` +
          `latencySamples=${sorted.length} p50=${pct(sorted, 50)}ms p95=${pct(sorted, 95)}ms max=${sorted[sorted.length - 1] ?? 0}ms`,
      );
    } finally {
      await closeAll(...ps);
    }
  }, 180_000);
});
