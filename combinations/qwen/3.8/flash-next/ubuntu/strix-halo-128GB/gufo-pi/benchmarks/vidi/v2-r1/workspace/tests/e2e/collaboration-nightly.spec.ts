/**
 * Nightly e2e tests: idle connection stability and capacity soak.
 *
 * These are too slow for every commit and should run via `npm run test:e2e:nightly`
 * or a separate Playwright project. They verify:
 * - TC-29: idle connection stability (no spurious reconnects)
 * - TC-30: convergence at full capacity with latency reporting
 *
 * Set E2E_NIGHTLY=1 to run these tests.
 */
import { expect, test } from '@playwright/test';

import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  closeParticipants,
  createNoteAndGetId,
  expectEventually,
  getDocSnapshot,
  noteIds,
  openParticipants,
} from './helpers/participants';
import {
  dragPointer,
  noteRects,
  selectNoteAt,
  settle,
  typeText,
} from './helpers/stickies';

const IDLE_STABILITY_MS = 45_000;
const SOAK_DURATION_MS = 60_000;
const NIGHTLY = process.env.E2E_NIGHTLY === '1';

test.skip(!NIGHTLY, 'Nightly tests: set E2E_NIGHTLY=1 to run');

test.describe('Nightly: idle connection stability', () => {
  test('TC-29: two contexts idle for 45s, badge never shows "Reconnecting…"', async ({ browser }) => {
    test.setTimeout(120_000);

    const participants = await openParticipants(browser, 2);

    try {
      const [p0] = participants;

      // Collect any badge text changes over the idle period

      await p0.page.evaluate(() => {
        const el = document.querySelector('[role="status"]');
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'childList' || m.type === 'characterData') {
              const text = document.querySelector('[role="status"]')?.textContent;
              if (text) {
                (window as unknown as Record<string, unknown[]>).__vidi6_badgeChanges ??= [];
                ((window as unknown as Record<string, unknown[]>).__vidi6_badgeChanges as string[]).push(text);
              }
            }
          }
        });
        if (el) {
          observer.observe(el, { childList: true, characterData: true, subtree: true });
        }
        // Also observe the body for badge appearing/disappearing
        const bodyObserver = new MutationObserver(() => {
          const badge = document.querySelector('[role="status"]');
          if (badge) {
            (window as unknown as Record<string, unknown[]>).__vidi6_badgeChanges ??= [];
            ((window as unknown as Record<string, unknown[]>).__vidi6_badgeChanges as string[]).push(badge.textContent ?? '');
          }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      });

      // Idle for 45 seconds
      await new Promise((r) => setTimeout(r, IDLE_STABILITY_MS));

      // Badge should not have shown "Reconnecting…" during idle
      const badgeChanges = await p0.page.evaluate(
        () => ((window as unknown as Record<string, unknown[]>).__vidi6_badgeChanges ?? []) as string[],
      );
      const reconnectAppeared = badgeChanges.some((t) => t.includes('Reconnecting'));
      expect(reconnectAppeared).toBe(false);

      // Both should still be connected (badge hidden)
      for (const p of participants) {
        const badge = await p.page.evaluate(
          () => document.querySelector('[role="status"]')?.textContent ?? null,
        );
        expect(badge).toBeNull();
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('Nightly: capacity soak with latency report', () => {
  test('TC-30: full capacity continuous edits for 60s, all converge, latency reported', async ({ browser }) => {
    test.setTimeout(180_000);

    const participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

    const latencies: number[] = [];

    try {
      // Each participant makes a series of operations over 60 seconds
      const startTime = Date.now();
      let opCount = 0;

      while (Date.now() - startTime < SOAK_DURATION_MS) {
        // Pick a participant to act
        const actor = participants[opCount % MAX_CONCURRENT_EDITORS];
        const others = participants.filter((p) => p !== actor);

        const action = opCount % 4;
        let noteId = '';

        switch (action) {
          case 0: {
            // Create a note
            noteId = await createNoteAndGetId(actor);
            // Wait for it to appear on all others
            const syncStart = Date.now();
            await Promise.all(
              others.map((other) =>
                expectEventually(
                  `TC-30 create sync`,
                  participants,
                  async () => (await noteIds(other.page)).includes(noteId),
                  10_000,
                ),
              ),
            );
            latencies.push(Date.now() - syncStart);
            break;
          }
          case 1: {
            // Move a note (pick first available)
            const ids = await noteIds(actor.page);
            if (ids.length === 0) break;
            const moveId = ids[opCount % ids.length];
            const rects = await noteRects(actor.page);
            const r = rects.find((n) => n.id === moveId);
            if (!r) break;
            const syncStart = Date.now();
            await dragPointer(actor.page, { x: r.centreX, y: r.centreY }, {
              x: (opCount % 40) - 20,
              y: (opCount % 30) - 15,
            });
            await settle(actor.page);
            await Promise.all(
              others.map((other) =>
                expectEventually(
                  `TC-30 move sync`,
                  participants,
                  async () => {
                    const snap = await getDocSnapshot(other.page);
                    const entry = snap[moveId] as Record<string, unknown> | undefined;
                    const snapA = await getDocSnapshot(actor.page);
                    const entryA = snapA[moveId] as Record<string, unknown> | undefined;
                    return entry !== undefined && entryA !== undefined &&
                      entry.x === entryA.x && entry.y === entryA.y;
                  },
                  10_000,
                ),
              ),
            );
            latencies.push(Date.now() - syncStart);
            break;
          }
          case 2: {
            // Type into a note
            const ids = await noteIds(actor.page);
            if (ids.length === 0) break;
            const typeId = ids[opCount % ids.length];
            const rects = await noteRects(actor.page);
            const r = rects.find((n) => n.id === typeId);
            if (!r) break;
            const syncStart = Date.now();
            await selectNoteAt(actor.page, { x: r.centreX, y: r.centreY });
            await actor.page.keyboard.press('Enter');
            await typeText(actor.page, String.fromCharCode(65 + (opCount % 26)));
            await actor.page.keyboard.press('Escape');
            await settle(actor.page);
            await Promise.all(
              others.map((other) =>
                expectEventually(
                  `TC-30 type sync`,
                  participants,
                  async () => {
                    const snap = await getDocSnapshot(other.page);
                    const entry = snap[typeId] as Record<string, unknown> | undefined;
                    return entry !== undefined && (entry.text as string)?.length > 0;
                  },
                  10_000,
                ),
              ),
            );
            latencies.push(Date.now() - syncStart);
            break;
          }
          case 3: {
            // Delete a note (keep at least 1 per participant)
            const ids = await noteIds(actor.page);
            if (ids.length <= 1) break;
            const delId = ids[opCount % ids.length];
            const syncStart = Date.now();
            const rects = await noteRects(actor.page);
            const r = rects.find((n) => n.id === delId);
            if (!r) break;
            await selectNoteAt(actor.page, { x: r.centreX, y: r.centreY });
            await settle(actor.page);
            const delBtn = actor.page.getByRole('button', { name: 'Delete note' });
            if (await delBtn.isVisible()) {
              await delBtn.click();
            } else {
              await actor.page.keyboard.press('Delete');
            }
            await settle(actor.page);
            await Promise.all(
              others.map((other) =>
                expectEventually(
                  `TC-30 delete sync`,
                  participants,
                  async () => (await noteIds(other.page)).includes(delId) === false,
                  10_000,
                ),
              ),
            );
            latencies.push(Date.now() - syncStart);
            break;
          }
        }

        opCount++;
      }

      // Final convergence: all participants should have identical note sets
      const finalSnapshots: string[] = [];
      for (const p of participants) {
        const ids = await noteIds(p.page);
        finalSnapshots.push(JSON.stringify(ids.sort()));
      }
      for (let i = 1; i < finalSnapshots.length; i++) {
        expect(finalSnapshots[i]).toBe(finalSnapshots[0]);
      }

      // Print latency report
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.5)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        const max = latencies[latencies.length - 1];
        console.log(
          `\n[TC-30 Latency Report]\n` +
          `  Operations: ${opCount}\n` +
          `  Sync measurements: ${latencies.length}\n` +
          `  p50: ${p50}ms, p95: ${p95}ms, max: ${max}ms\n` +
          `  Budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms\n` +
          `  Over budget: ${latencies.filter((l) => l > LIVE_UPDATE_LATENCY_BUDGET_MS).length}/${latencies.length}\n`,
        );
        // Latency is reported, NOT asserted (model, browsers, and server share one machine)
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});
