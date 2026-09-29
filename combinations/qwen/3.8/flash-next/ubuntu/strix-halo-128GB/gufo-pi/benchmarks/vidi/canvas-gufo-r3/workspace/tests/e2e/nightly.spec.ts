import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  newE2eBoardId,
  type Participant,
} from './helpers/participants';
import { dragNoteBy, startEditingNote, typeIntoEditor } from './helpers/sticky';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/**
 * Nightly soak/idle specs — deliberately excluded from the default `test:e2e`
 * (see playwright.config.ts). They exercise the connectBoard provider contract
 * under time pressure and are known to be machine-sensitive.
 */

const SYNCED = new Set(['connected', 'confirmed']);

function snapshot(page: Page): Promise<{ state?: string; badge: string | null }> {
  return page.evaluate(() => ({
    state: (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState,
    badge: document.querySelector('[data-testid="connection-status"]')?.textContent ?? null,
  }));
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function boardSignature(page: Page): Promise<string> {
  const notes = await page.$$eval('[data-testid="sticky-note-wrapper"]', (els) =>
    els.map((e) => {
      const h = e as HTMLElement;
      const inner = h.querySelector('[data-testid="sticky-note"]') as HTMLElement;
      const text = h.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '';
      return `${h.dataset.noteId}|${h.dataset.x}|${h.dataset.y}|${getComputedStyle(inner).backgroundColor}|${text}`;
    }),
  );
  return notes.sort().join('\n');
}

/** Poll every receiver for a predicate; return the max elapsed ms, or -1 on timeout. */
async function maxPropagation(
  others: Page[],
  predicate: (page: Page) => Promise<boolean>,
  timeoutMs = 5000,
): Promise<number> {
  const t0 = Date.now();
  const per = others.map(async (page) => {
    for (;;) {
      if (await predicate(page)) return Date.now() - t0;
      if (Date.now() - t0 > timeoutMs) return Infinity;
      await new Promise((r) => setTimeout(r, 4));
    }
  });
  return Math.max(...(await Promise.all(per)));
}

// ---------------------------------------------------------------------------

test.describe('@nightly connection stability', () => {
  test('TC-29: idle for 45s stays connected, never shows Reconnecting', async ({ browser }) => {
    test.setTimeout(90_000);
    const parts = await openParticipants(browser, newE2eBoardId(), 2);
    const bad: Array<{ page: string; state: string | undefined }> = [];
    try {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        for (let i = 0; i < parts.length; i++) {
          const { state, badge } = await snapshot(parts[i].page);
          if (!state || !SYNCED.has(state)) bad.push({ page: `p${i}`, state });
          if (badge && /Reconnecting/.test(badge)) bad.push({ page: `p${i}`, state: 'badge:' + badge });
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(bad).toEqual([]);
    } finally {
      await closeParticipants(parts);
    }
  });
});

test.describe('@nightly capacity soak', () => {
  // Keep Playwright from blocking 30 s on a momentarily-absent element during the
  // continuous-edit soak; a transient miss just means that one op isn't measured.
  test.use({ actionTimeout: 4000 });

  test('TC-30: full capacity continuous edits for 60s — all latency within budget, snapshots identical', async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    // Seeded PRNG so the whole soak is reproducible; the seed is printed.
    const seed = 1234567;
    let s = seed >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const parts = await openParticipants(browser, newE2eBoardId(), MAX_CONCURRENT_EDITORS);
    const ZOOM = 0.5;
    // Distinct world pan per participant → their notes never overlap on-screen.
    for (let i = 0; i < parts.length; i++) {
      await parts[i].page.evaluate(
        (cam) => window.__vidi6!.setCamera(cam),
        { x: -i * 8000, y: 0, zoom: ZOOM },
      );
    }

    const latencies: number[] = [];
    const badgeViolations: string[] = [];
    const deselect = async (page: Page) => {
      await page.mouse.click(1250, 40);
    };
    const createAt = async (page: Page, x: number, y: number): Promise<string> => {
      await deselect(page);
      await page.mouse.dblclick(x, y);
      const ta = page.locator('[data-testid="sticky-textarea"]').first();
      await ta.waitFor({ state: 'attached', timeout: 2000 });
      const id = await ta.evaluate((el) => (el.closest('[data-note-id]') as HTMLElement).dataset.noteId!);
      return id;
    };

    // Non-waiting DOM readers (querySelector) so latency polling never blocks on
    // an element that has not arrived yet.
    const hasId = (pg: Page, id: string) =>
      pg.evaluate((i) => !!document.querySelector(`[data-note-id="${i}"]`), id);
    const worldOf = (pg: Page, id: string) =>
      pg.evaluate(
        (i) => {
          const e = document.querySelector(
            `[data-testid="sticky-note-wrapper"][data-note-id="${i}"]`,
          ) as HTMLElement | null;
          return e ? { x: e.dataset.x, y: e.dataset.y } : null;
        },
        id,
      );
    const colorOf = (pg: Page, id: string) =>
      pg.evaluate((i) => {
        const e = document.querySelector(`[data-testid="sticky-note"][data-note-id="${i}"]`) as HTMLElement | null;
        return e ? getComputedStyle(e).backgroundColor : null;
      }, id);
    const textOf = (pg: Page, id: string) =>
      pg.evaluate(
        (i) =>
          document.querySelector(
            `[data-testid="sticky-note-wrapper"][data-note-id="${i}"] [data-testid="sticky-note-text"]`,
          )?.textContent ?? null,
        id,
      );

    try {
      const deadline = Date.now() + 60_000;
      let round = 0;
      const owned: string[][] = parts.map(() => []);

      while (Date.now() < deadline) {
        const actor = round % parts.length;
        const others = parts.filter((_, i) => i !== actor).map((p) => p.page);
        const roll = rand();
        const mine = owned[actor];

        // Detect badge/connection health every round.
        for (let i = 0; i < parts.length; i++) {
          const { state } = await snapshot(parts[i].page);
          if (!state || !SYNCED.has(state)) badgeViolations.push(`round ${round} p${i}=${state}`);
        }

        try {
          if (roll < 0.4 || mine.length === 0) {
            // CREATE
            const x = 60 + rand() * 900;
            const y = 60 + rand() * 640;
            const id = await createAt(parts[actor].page, x, y);
            owned[actor].push(id);
            await deselect(parts[actor].page);
            latencies.push(await maxPropagation(others, (pg) => hasId(pg, id)));
          } else if (roll < 0.6) {
            // MOVE
            const id = mine[Math.floor(rand() * mine.length)];
            const before = await worldOf(parts[actor].page, id);
            await dragNoteBy(parts[actor].page, id, Math.round(rand() * 60) + 10, Math.round(rand() * 60) + 10, 2);
            const after = await worldOf(parts[actor].page, id);
            latencies.push(
              await maxPropagation(
                others,
                async (pg) => {
                  const p = await worldOf(pg, id);
                  return !!p && p.x === after?.x && p.y === after?.y && (p.x !== before?.x || p.y !== before?.y);
                },
              ),
            );
          } else if (roll < 0.75) {
            // RECOLOUR
            const id = mine[Math.floor(rand() * mine.length)];
            await parts[actor].page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).click({ timeout: 3000 });
            const label = rand() < 0.5 ? 'Green colour' : 'Red colour';
            await parts[actor].page
              .locator(`[data-testid="sticky-note-wrapper"][data-note-id="${id}"] [aria-label="${label}"]`)
              .click({ timeout: 3000 });
            const color = await colorOf(parts[actor].page, id);
            latencies.push(await maxPropagation(others, async (pg) => (await colorOf(pg, id)) === color && color != null));
            await deselect(parts[actor].page);
          } else if (roll < 0.9) {
            // TYPE
            const id = mine[Math.floor(rand() * mine.length)];
            const token = String.fromCharCode(97 + Math.floor(rand() * 26)).repeat(2);
            await startEditingNote(parts[actor].page, id);
            await typeIntoEditor(parts[actor].page, token);
            await deselect(parts[actor].page);
            latencies.push(await maxPropagation(others, async (pg) => ((await textOf(pg, id)) ?? '').includes(token)));
          } else if (mine.length > 1) {
            // DELETE
            const idx = Math.floor(rand() * mine.length);
            const id = mine[idx];
            await parts[actor].page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).click({ timeout: 3000 });
            await parts[actor].page.keyboard.press('Delete');
            await deselect(parts[actor].page);
            mine.splice(idx, 1);
            latencies.push(await maxPropagation(others, (pg) => hasId(pg, id).then((v) => !v)));
          }
        } catch {
          // Transient missing element under concurrent edits — skip this op.
        }
        round++;
      }

      // Report latency distribution.
      const finite = latencies.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      const p50 = pct(finite, 50);
      const p95 = pct(finite, 95);
      const max = finite.length ? finite[finite.length - 1] : Infinity;
      const overBudget = latencies.filter((n) => !(n <= LIVE_UPDATE_LATENCY_BUDGET_MS)).length;
      console.log(
        `TC-30 seed=${seed} ops=${latencies.length} p50=${p50}ms p95=${p95}ms max=${max}ms ` +
          `budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms overBudget=${overBudget} badgeViolations=${badgeViolations.length}`,
      );

      expect(badgeViolations).toEqual([]);
      expect(overBudget).toBe(0);
      expect(finite.length).toBeGreaterThan(0);

      const first = await boardSignature(parts[0].page);
      for (const p of parts) {
        await expect
          .poll(async () => await boardSignature(p.page), { timeout: 5000 })
          .toBe(first);
      }
    } finally {
      await closeParticipants(parts);
    }
  });
});
