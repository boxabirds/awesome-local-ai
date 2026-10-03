// Nightly e2e: long-running live collaboration checks.
// TC-29 (idle keeps the connection alive) and TC-30 (capacity soak).

import { expect, test, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../../src/shared/config';
import {
  badgeState,
  closeParticipant,
  createNoteWithText,
  joinBoard,
  notesSnapshot,
  openParticipant,
  type Participant,
} from '../helpers/participants';

test.describe('story 3 nightly: idle keep-alive and capacity soak', () => {
  test('TC-29 idle participants never drop to Reconnecting for 45s', async ({ browser }) => {
    test.setTimeout(120_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await joinBoard(sam.page, alex.boardId);

      // Both pages settle to a live connection first.
      for (const p of [alex, sam]) {
        const start = Date.now();
        while (Date.now() - start < 15_000) {
          if ((await badgeState(p.page)) === 'connected') break;
          await p.page.waitForTimeout(250);
        }
        expect(await badgeState(p.page)).toBe('connected');
      }

      // 45 seconds of idle; sample the badge state throughout.
      const observed = new Set<string>();
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        observed.add(await badgeState(alex.page));
        observed.add(await badgeState(sam.page));
        await alex.page.waitForTimeout(500);
      }
      expect(observed.has('reconnecting')).toBe(false);
      expect(await badgeState(alex.page)).toBe('connected');
      expect(await badgeState(sam.page)).toBe('connected');
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-30 capacity soak: 60s of continuous edits, identical end state, latency logged', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const participants: Participant[] = [];
    try {
      const host = await openParticipant(browser);
      participants.push(host);
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = await openParticipant(browser);
        await joinBoard(p.page, host.boardId);
        participants.push(p);
      }

      // Latency sampling: the host watches for notes created by everyone
      // (same-machine clock) and records delivery times.
      const createdAt = new Map<string, number>();
      const latencies: number[] = [];
      const seen = new Set<string>();
      let stopWatching = false;
      const watcher = (async () => {
        while (!stopWatching) {
          const texts = await host
            .page.locator('.sticky-note__text')
            .allTextContents()
            .catch(() => [] as string[]);
          for (const t of texts) {
            const trimmed = t.trim();
            if (!trimmed || seen.has(trimmed) || !createdAt.has(trimmed)) continue;
            seen.add(trimmed);
            latencies.push(Date.now() - (createdAt.get(trimmed) as number));
          }
          await host.page.waitForTimeout(200).catch(() => undefined);
        }
      })();

      // No single op may stall the soak: bound every op from the outside.
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('soak op timeout')), ms),
          ),
        ]);

      // Seeded PRNG per participant: reproducible, independent edit streams.
      function mulberry32(seed: number) {
        let a = seed >>> 0;
        return () => {
          a |= 0;
          a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      const POOL_SIZE = 2; // notes kept alive per participant (bounded DOM)
      const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
      // Home slot for pool note j of participant i (unique, on-screen,
      // spaced so ±20px drags never overlap a neighbour's slot).
      const slotXY = (i: number, j: number) => ({ x: 40 + i * 248 + 20, y: 100 + j * 300 + 20 });

      const noteByText = (page: Page, text: string) =>
        page.getByTestId('sticky-note').filter({ hasText: text }).first();

      // 60 seconds of continuous seeded-random edits from every
      // participant: create, move, type, recolour, delete.
      const SOAK_MS = 60_000;
      const started = Date.now();
      const edits = (page: Page, i: number) =>
        (async () => {
          const rand = mulberry32(0xc0ffee + i * 7919);
          const who = `p${i}`;
          let createRound = 0;
          // Pool bookkeeping: label → home slot (slots are never reused while
          // occupied, so a create never double-clicks onto an existing note).
          const slots = new Map<string, number>();
          const freeSlot = () => {
            for (let j = 0; j < POOL_SIZE; j++) {
              if (![...slots.values()].includes(j)) return j;
            }
            return -1;
          };
          // Drop bookkeeping entries whose notes no longer exist (ghosts
          // after merged creates / missed deletes) so creates stay valid.
          const resyncSlots = async () => {
            const texts = await page
              .locator('.sticky-note__text')
              .allTextContents()
              .catch(() => [] as string[]);
            for (const label of [...slots.keys()]) {
              if (!texts.some((t) => t.includes(label))) slots.delete(label);
            }
          };
          while (Date.now() - started < SOAK_MS) {
            try {
              await withTimeout(
                (async () => {
                  const pool = [...slots.keys()];
                  const op = rand();
                  if (op < 0.25 || pool.length === 0) {
                    // Create in the first free home slot.
                    const j = freeSlot();
                    if (j < 0) return;
                    const label = `${who}n${String(createRound++).padStart(3, '0')}`;
                    const t0 = Date.now();
                    const { x, y } = slotXY(i, j);
                    createdAt.set(label, t0);
                    await createNoteWithText(page, label, x, y);
                    slots.set(label, j);
                  } else if (op < 0.55) {
                    // Move a random pool note by a small random delta.
                    const text = pool[Math.floor(rand() * pool.length)];
                    const box = await noteByText(page, text).boundingBox().catch(() => null);
                    if (!box) return;
                    const dx = (rand() - 0.5) * 40;
                    const dy = (rand() - 0.5) * 40;
                    const cx = box.x + box.width / 2;
                    const cy = box.y + box.height / 2;
                    await page.mouse.move(cx, cy);
                    await page.mouse.down();
                    await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
                    await page.mouse.up();
                  } else if (op < 0.75) {
                    // Type a character into a random pool note.
                    const text = pool[Math.floor(rand() * pool.length)];
                    const note = noteByText(page, text);
                    const box = await note.boundingBox().catch(() => null);
                    if (!box) return;
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    await page.keyboard.press('Enter');
                    await page.locator('.sticky-text-editor__textarea').waitFor({ timeout: 3000 });
                    await page.keyboard.type(String.fromCharCode(65 + Math.floor(rand() * 26)));
                    await page.keyboard.press('Escape');
                  } else if (op < 0.9) {
                    // Recolour a random pool note via the toolbar swatch.
                    const text = pool[Math.floor(rand() * pool.length)];
                    const note = noteByText(page, text);
                    const box = await note.boundingBox().catch(() => null);
                    if (!box) return;
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    const swatch = page.getByTestId(`swatch-${COLORS[Math.floor(rand() * COLORS.length)]}`);
                    await swatch.waitFor({ timeout: 3000 }).catch(() => undefined);
                    await swatch.click().catch(() => undefined);
                  } else {
                    // Delete a pool note (keep at least one).
                    if (pool.length <= 1) return;
                    const text = pool[Math.floor(rand() * pool.length)];
                    const note = noteByText(page, text);
                    const box = await note.boundingBox().catch(() => null);
                    if (!box) return;
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    await page.getByTestId('delete-note-btn').click({ timeout: 3000 }).catch(() => undefined);
                    slots.delete(text);
                  }
                })(),
                15_000,
              );
            } catch {
              // A transient UI race (or a stale slot after a merged create)
              // should never kill the soak: resync bookkeeping and skip.
              await resyncSlots().catch(() => undefined);
            }
          }
        })();
      console.log('[soak] starting edit loops');
      await Promise.all(participants.map((p, i) => edits(p.page, i)));
      console.log('[soak] edit loops done');

      stopWatching = true;
      await watcher;
      console.log('[soak] watcher done, starting convergence poll');

      // Everyone converges on the identical board (pairwise re-read). Each
      // sample is bounded so a stuck page cannot stall the poll forever.
      await expect
        .poll(async () => {
          const snaps = await Promise.all(
            participants.map((p) =>
              withTimeout(notesSnapshot(p.page), 5000).catch(() => null),
            ),
          );
          if (snaps.some((s) => s === null)) return false;
          return snaps.length > 0 && snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
        }, { timeout: 60_000 })
        .toBe(true);

      // Latency stats: logged against the budget, never asserted.
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
      const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
      const max = latencies[latencies.length - 1] ?? 0;
      console.log(
        `[latency] soak: n=${latencies.length} p50=${p50}ms p95=${p95}ms max=${max}ms ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, logged not asserted)`,
      );
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});
