/**
 * Nightly e2e tests (TC-29, TC-30) - excluded from quick test:e2e runs.
 * Tagged @nightly. Run with: npx playwright test tests/e2e/nightly/
 */
import { expect, test } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  createNote,
  noteCount,
  endEditing,
} from '../helpers/participants';
import { newBoardId } from '../../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

// ─── TC-29: Idle connection stays connected for 45 seconds ─────────────────────────────────────────

test.describe('Idle stability (TC-29) @nightly', () => {
  test.setTimeout(60_000);

  test('two contexts on same board, no activity for 45s, badge never renders Reconnecting', async ({
    browser,
  }) => {
    const boardId = newBoardId();
    const participants = await openParticipants(browser, 2, boardId);
    const [alex] = participants;

    // Record console errors
    const errors: string[] = [];
    for (const p of participants) {
      p.page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      p.page.on('pageerror', (err) => errors.push(err.message));
    }

    // Poll for 45 seconds checking state
    const IDLE_MS = 45_000;
    const pollInterval = 5_000;
    const start = Date.now();

    while (Date.now() - start < IDLE_MS) {
      await alex.page.waitForTimeout(pollInterval);

      for (const p of participants) {
        const state = await p.page.evaluate(() => window.__vidi6?.connectionState);
        // State must never leave 'connected' (also accept 'confirmed' right after first sync)
        expect(['connected', 'confirmed']).toContain(state);
      }
    }

    // Badge should not show Reconnecting text at any point
    for (const p of participants) {
      const status = p.page.locator('[role="status"]');
      await expect(status).not.toContainText('Reconnecting');
    }

    // No console errors during idle
    expect(errors).toHaveLength(0);

    // Cursor pan still works
    const before = await alex.page.evaluate(() => ({ ...window.__vidi6!.getCamera!() }));
    await alex.page.mouse.move(640, 400);
    await alex.page.mouse.down();
    await alex.page.mouse.move(740, 500, { steps: 5 });
    await alex.page.mouse.up();
    const after = await alex.page.evaluate(() => ({ ...window.__vidi6!.getCamera!() }));
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);

    await closeParticipants(participants);
  });
});

// ─── TC-30: Capacity soak at MAX_CONCURRENT_EDITORS, 60 seconds ───────────────────────────────────

test.describe('Capacity soak (TC-30) @nightly', () => {
  test.setTimeout(120_000);

  test(`${MAX_CONCURRENT_EDITORS} contexts sustain mixed workload for 60s with no drops`, async ({
    browser,
  }) => {
    const boardId = newBoardId();
    const participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS, boardId);

    // Track connection drops
    const drops: Array<{ index: number; time: number; state: string }> = [];
    const errors: string[] = [];

    for (let i = 0; i < participants.length; i++) {
      const idx = i;
      participants[i].page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`[${idx}] ${msg.text()}`);
      });
      participants[i].page.on('pageerror', (err) => errors.push(`[${idx}] ${err.message}`));
    }

    // Seeded random
    let seed = 12345;
    function random(): number {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    }

    // 60 seconds of mixed workload
    const SOAK_MS = 60_000;
    const start = Date.now();
    const latencySamples: number[] = [];
    let changeCount = 0;

    while (Date.now() - start < SOAK_MS) {
      // Pick a random participant to make a change
      const editorIdx = Math.floor(random() * participants.length);
      const editor = participants[editorIdx];
      const changeStart = Date.now();

      // Mix: create, recolour, or delete
      const action = random();
      if (action < 0.4) {
        // Create a note at a non-overlapping position
        const x = 100 + Math.floor(random() * 5) * 230;
        const y = 100 + Math.floor(random() * 2) * 230;
        await createNote(editor.page, x, y);
        await endEditing(editor.page);
        changeCount++;
      } else if (action < 0.7) {
        // Recolour the first available note (skip if toolbar doesn't appear)
        const count = await noteCount(editor.page);
        if (count > 0) {
          await editor.page.locator('[data-note-id]').first().click();
          const swatchVisible = await editor.page
            .waitForSelector('[data-testid="swatch"]', { timeout: 1000 })
            .then(() => true)
            .catch(() => false);
          if (swatchVisible) {
            const swatches = editor.page.locator('[data-testid="swatch"]');
            const n = await swatches.count();
            if (n > 0) await swatches.nth(Math.floor(random() * n)).click();
            changeCount++;
          }
        }
      } else {
        // Delete a note if there are enough
        const count = await noteCount(editor.page);
        if (count > 1) {
          await editor.page.locator('[data-note-id]').last().click();
          await editor.page.keyboard.press('Delete');
          changeCount++;
        }
      }

      if (changeCount > 0) {
        // Check one other participant received the change within budget
        const viewerIdx = (editorIdx + 1) % participants.length;
        const viewer = participants[viewerIdx];
        const expectedNotes = await noteCount(editor.page);
        try {
          await expect
            .poll(async () => noteCount(viewer.page), {
              timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
            })
            .toBe(expectedNotes);
          latencySamples.push(Date.now() - changeStart);
        } catch {
          latencySamples.push(9999);
        }
      }

      // Verify all participants still have "connected" or "confirmed" state
      for (let i = 0; i < participants.length; i++) {
        const state = await participants[i].page.evaluate(() => window.__vidi6?.connectionState);
        if (state === 'reconnecting' || state === 'connecting') {
          drops.push({ index: i, time: Date.now() - start, state });
        }
      }
    }

    // Print latency stats
    latencySamples.sort((a, b) => a - b);
    const p50 = latencySamples[Math.floor(latencySamples.length * 0.5)] ?? 0;
    const p95 = latencySamples[Math.floor(latencySamples.length * 0.95)] ?? 0;
    const max = latencySamples[latencySamples.length - 1] ?? 0;
    console.log(`TC-30 latency: p50=${p50}ms p95=${p95}ms max=${max}ms (n=${latencySamples.length})`);

    // No connection drops
    expect(drops).toHaveLength(0);

    // No console/page errors
    expect(errors).toHaveLength(0);

    // All participants see the same number of notes
    const finalCounts = await Promise.all(participants.map((p) => noteCount(p.page)));
    const expectedNotes = finalCounts[0];
    for (const c of finalCounts) {
      expect(c).toBe(expectedNotes);
    }

    // Latency: at least 70% of operations converged within budget
    // (spec: failures on single-machine don't block; we use 70% threshold to account
    // for the expect.poll overhead and same-machine contention)
    const withinBudget = latencySamples.filter((s) => s <= LIVE_UPDATE_LATENCY_BUDGET_MS);
    const successRate = withinBudget.length / Math.max(latencySamples.length, 1);
    expect(successRate).toBeGreaterThanOrEqual(0.7);

    await closeParticipants(participants);
  });
});
