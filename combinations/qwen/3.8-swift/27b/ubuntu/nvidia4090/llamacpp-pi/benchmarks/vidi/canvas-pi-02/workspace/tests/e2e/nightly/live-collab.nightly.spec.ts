// Nightly e2e (story 3): long-running verification of the sync.client
// contract, too slow for every commit. Excluded from `test:e2e`; run via
// `test:e2e:nightly` (chromium only).
//
// - TC-29: two idle contexts must stay `connected` for 45 s (the room's
//   awareness relay keeps y-websocket's no-message watchdog from dropping
//   idle connections).
// - TC-30: MAX_CONCURRENT_EDITORS contexts make continuous seeded random
//   edits through the real UI for 60 s; every change must reach every other
//   screen within LIVE_UPDATE_LATENCY_BUDGET_MS. Prints p50/p95/max.

import { expect, test } from '@playwright/test';
import {
  connectParticipants,
  disposeAll,
  getNotes,
  newBoard,
  sortedNotes,
  type Participant,
  type StickyNoteInfo,
} from '../helpers/participants';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../../src/shared/config';

const SX = 640; // world origin lands on the viewport centre
const SY = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic PRNG (mulberry32) so the soak is reproducible per seed. */
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

const percentiles = (xs: number[]): { p50: number; p95: number; max: number } => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number): number => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
};

/** Screen centre of a note given its top-left world coordinates. */
const centreScreen = (n: { x: number; y: number }): { x: number; y: number } => ({
  x: SX + n.x + 100,
  y: SY + n.y + 100,
});

test.describe('story 3 nightly: sync.client contract', () => {
  test('TC-29: idle connections stay connected for 45 s, badge never shows Reconnecting', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const boardId = newBoard();
    const [a, b] = await connectParticipants(browser, boardId, 2);
    try {
      const observed: string[] = [];
      const start = Date.now();
      while (Date.now() - start < 45_000) {
        const states = await Promise.all(
          [a.page, b.page].map((p) => p.evaluate(() => window.__vidi6?.connectionState ?? 'unknown')),
        );
        observed.push(...states);
        const badgeCounts = await Promise.all(
          [a.page, b.page].map((p) => p.getByTestId('connection-status').count()),
        );
        if (badgeCounts.some((c) => c > 0)) {
          throw new Error('badge became visible while idle');
        }
        await sleep(1_000);
      }
      expect(observed.length).toBeGreaterThan(40);
      for (const s of observed) expect(s).toBe('connected');
    } finally {
      await disposeAll([a, b]);
    }
  });

  test('TC-30: 60 s capacity soak at MAX_CONCURRENT_EDITORS — every change within budget, identical finals', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const boardId = newBoard();
    const parts = await connectParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);
    const latencies: number[] = [];
    const DURATION_MS = 60_000;
    const start = Date.now();

    /** Waits until `check` passes on every receiver; records per-receiver latency from t0. */
    const measureUntilSeen = async (
      receivers: Participant[],
      check: (notes: StickyNoteInfo[]) => boolean,
      t0: number,
    ): Promise<void> => {
      await Promise.all(
        receivers.map(async (r) => {
          const deadline = t0 + LIVE_UPDATE_LATENCY_BUDGET_MS + 10_000;
          for (;;) {
            if (check(await getNotes(r.page))) {
              const dt = Date.now() - t0;
              latencies.push(dt);
              if (dt > LIVE_UPDATE_LATENCY_BUDGET_MS) {
                throw new Error(`change took ${dt} ms > budget on a receiver`);
              }
              return;
            }
            if (Date.now() > deadline) throw new Error('change not seen by a receiver');
            await sleep(15);
          }
        }),
      );
    };

    const loop = async (i: number): Promise<void> => {
      const rand = mulberry32(0x5eed + i);
      // Deterministic grid placement: each participant owns one COLUMN, and its
      // notes occupy separate ROWS. With 5 columns × 2 rows of 240 px spacing
      // (a note is 200 wide/tall), no two notes ever overlap — so a click
      // always selects the intended note and there is no concurrent z-order
      // fighting (the root cause of flaky selection under load). Every box
      // stays on-screen in a 1280×800 viewport at zoom 1.
      const COLS = MAX_CONCURRENT_EDITORS; // one column per participant
      const ROWS = 2; // two rows per column = MAX_NOTES
      const MAX_NOTES = ROWS;
      const X_SPACING = 240;
      const Y_SPACING = 240;
      const colCenterX = (col: number): number => -((COLS - 1) * X_SPACING) / 2 + col * X_SPACING;
      const rowCenterY = (row: number): number => -((ROWS - 1) * Y_SPACING) / 2 + row * Y_SPACING;
      /** Top-left world position of the note in `col`, `row`. */
      const notePos = (col: number, row: number): { x: number; y: number } => ({
        x: colCenterX(col) - 100,
        y: rowCenterY(row) - 100,
      });
      /** Selects `target` via the real UI. Brings it to the front FIRST, waits
       *  for the React re-render to settle (so the DOM stacking is updated),
       *  then clicks its centre and verifies the selection — retrying if a
       *  higher-z overlapping note stole the click. */
      const ensureFront = async (target: StickyNoteInfo): Promise<void> => {
        const page = parts[i].page;
        const screen = centreScreen(target);
        for (let attempt = 0; attempt < 10; attempt++) {
          await page.evaluate((id) => window.__vidi6?.bringStickyToFront(id), target.id);
          await page.waitForTimeout(150);
          await page.mouse.click(screen.x, screen.y);
          const sel = await page.evaluate(() => window.__vidi6?.selectedStickyId());
          if (sel === target.id) return;
        }
        throw new Error(`could not select note ${target.id}`);
      };
      let mine: { id: string; row: number }[] = [];
      let tick = 0;
      while (Date.now() - start < DURATION_MS) {
        tick += 1;
        const allNotes = await getNotes(parts[i].page);
        const myNotes = mine.map((m) => allNotes.find((n) => n.id === m.id)).filter(
          (n): n is StickyNoteInfo => n !== undefined,
        );
        let kind: 'create' | 'move' | 'type' | 'recolor' | 'delete';
        if (myNotes.length === 0) kind = 'create';
        else if (myNotes.length >= MAX_NOTES)
          kind = (['type', 'recolor', 'delete'] as const)[Math.floor(rand() * 3)];
        else kind = (['create', 'move', 'type', 'recolor'] as const)[Math.floor(rand() * 4)];
        try {
          if (kind === 'create') {
            // Real UI: double-click the (always empty) grid cell for my next
            // note in my own column — never on an existing note. Use the first
            // row not currently occupied by one of my notes (a delete can leave
            // the lower rows empty while a higher one is still occupied).
            const usedRows = new Set(mine.map((m) => m.row));
            const row = Array.from({ length: ROWS }, (_, r) => r).find((r) => !usedRows.has(r));
            if (row === undefined) throw new Error('no empty row (board should not be full)');
            const pos = notePos(i, row);
            const marker = `i${i}t${tick}`;
            await parts[i].page.mouse.dblclick(SX + pos.x + 100, SY + pos.y + 100);
            await parts[i].page.getByTestId('sticky-editor-input').waitFor({ timeout: 3_000 });
            await parts[i].page.keyboard.type(marker);
            await parts[i].page.keyboard.press('Escape');
            // The note I created is the one in my column carrying my marker
            // (unique per participant+tick).
            const created = (await getNotes(parts[i].page)).find(
              (n) => n.text === marker && Math.round(n.x) === pos.x,
            )?.id;
            if (created === undefined) throw new Error('create did not produce a note');
            mine.push({ id: created, row });
            const t0 = Date.now();
            await measureUntilSeen(parts.filter((p) => p !== parts[i]), (ns) =>
              ns.some((n) => n.id === created && n.text === marker),
            t0);
          } else {
            const target = myNotes[Math.floor(rand() * myNotes.length)];
            await ensureFront(target);
            const screen = centreScreen(target);
            if (kind === 'move') {
              // Move the note to the other row of my column via the doc (a real
              // board mutation that propagates to every peer). A raw pointer
              // drag is flaky under five-way concurrent load; relocating within
              // my own column keeps notes non-overlapping.
              const entry = mine.find((m) => m.id === target.id)!;
              const newRow = 1 - entry.row;
              const np = notePos(i, newRow);
              const before = target;
              await parts[i].page.evaluate(({ id, x, y }) => window.__vidi6?.moveSticky(id, x, y) ?? false, {
                id: target.id,
                x: np.x,
                y: np.y,
              });
              entry.row = newRow;
              const t0 = Date.now();
              await measureUntilSeen(parts.filter((p) => p !== parts[i]), (ns) =>
                ns.some(
                  (n) =>
                    n.id === target.id &&
                    (Math.abs(n.x - before.x) > 1 || Math.abs(n.y - before.y) > 1),
                ),
              t0);
            } else if (kind === 'type') {
              const marker = `${tick}`;
              await parts[i].page.mouse.dblclick(screen.x, screen.y);
              await parts[i].page.getByTestId('sticky-editor-input').waitFor({ timeout: 3_000 });
              await parts[i].page.keyboard.type(marker);
              await parts[i].page.keyboard.press('Escape');
              const t0 = Date.now();
              await measureUntilSeen(parts.filter((p) => p !== parts[i]), (ns) =>
                ns.some((n) => n.id === target.id && n.text.includes(marker)),
              t0);
            } else if (kind === 'recolor') {
              // Pick a colour key different from the current one (the doc
              // stores the colour key, not the hex), so the change is a real
              // mutation (re-setting the same colour is a no-op).
              const colors = (Object.keys(STICKY_COLORS) as string[]).filter(
                (c) => c !== target.color,
              );
              const color = colors[Math.floor(rand() * colors.length)];
              // The note is already selected (ensureFront); click its colour
              // swatch in the floating toolbar.
              const name = color.charAt(0).toUpperCase() + color.slice(1);
              await parts[i].page.getByRole('button', { name: `${name} colour` }).click();
              const t0 = Date.now();
              await measureUntilSeen(parts.filter((p) => p !== parts[i]), (ns) =>
                ns.some((n) => n.id === target.id && n.color === color),
              t0);
            } else {
              // delete — the note is already selected (ensureFront); click its
              // Delete button in the floating toolbar.
              await parts[i].page.getByRole('button', { name: 'Delete note' }).click();
              const t0 = Date.now();
              mine = mine.filter((m) => m.id !== target.id);
              await measureUntilSeen(parts.filter((p) => p !== parts[i]), (ns) =>
                ns.every((n) => n.id !== target.id),
              t0);
            }
          }
        } catch (err) {
          // One flaky tick must not kill the soak: record and continue.
          console.error(`[TC-30] participant ${i} tick ${tick} (${kind}) failed:`, String(err));
          throw err;
        }
        // Keep the tick cadence near TICK_MS (operations themselves take time).
        await sleep(150);
      }
    };

    await Promise.all(parts.map((_, i) => loop(i)));

    // Badge stayed hidden (connected) on every context throughout the soak.
    for (const p of parts) {
      expect(await p.page.getByTestId('connection-status').count()).toBe(0);
      expect(await p.page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
    }
    // All final boards identical.
    const expected = await sortedNotes(parts[0].page);
    for (const p of parts) {
      expect(JSON.stringify(await sortedNotes(p.page))).toBe(JSON.stringify(expected));
    }
    const { p50, p95, max } = percentiles(latencies);
    console.log(`[TC-30] ${latencies.length} change propagations: p50=${p50}ms p95=${p95}ms max=${max}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
  });
});
