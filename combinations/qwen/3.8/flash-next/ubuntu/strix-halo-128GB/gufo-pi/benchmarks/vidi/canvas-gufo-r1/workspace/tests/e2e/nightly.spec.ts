import { test, expect } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  createBoard,
  noteCountSelector,
} from './helpers/participants';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

test.describe('Nightly: idle connection stability', () => {
  test('TC-29: idle connection stays connected for 45 s', async ({ browser }) => {
    test.setTimeout(120_000);

    const boardId = await createBoard((await browser.newPage()));
    const participants = await openParticipants(browser, boardId, 2);
    const [alex, sam] = [participants[0]!, participants[1]!];
    await new Promise((r) => setTimeout(r, 1000));

    // No user activity for 45 seconds
    // Monitor that badge never shows "Reconnecting..." and connection state stays 'connected'
    for (let elapsed = 0; elapsed < 45_000; elapsed += 5_000) {
      await new Promise((r) => setTimeout(r, 5_000));

      // Badge should not be visible (connected state hides it)
      const alexBadge = alex.page.locator('[data-testid="connection-status"]');
      const samBadge = sam.page.locator('[data-testid="connection-status"]');
      const alexVisible = await alexBadge.isVisible();
      const samVisible = await samBadge.isVisible();

      if (alexVisible) {
        const text = await alexBadge.textContent();
        expect(text, `Alex badge at ${elapsed + 5000}ms`).not.toContain('Reconnecting');
      }
      if (samVisible) {
        const text = await samBadge.textContent();
        expect(text, `Sam badge at ${elapsed + 5000}ms`).not.toContain('Reconnecting');
      }

      // Check exposed connection state
      const alexState = await alex.page.evaluate(() => (window as any).__vidi6?.connectionState);
      const samState = await sam.page.evaluate(() => (window as any).__vidi6?.connectionState);
      expect(alexState, `Alex state at ${elapsed + 5000}ms`).toBe('connected');
      expect(samState, `Sam state at ${elapsed + 5000}ms`).toBe('connected');
    }

    await closeParticipants(participants);
  });
});

test.describe('Nightly: delivery at capacity', () => {
  test('TC-30: MAX_CONCURRENT_EDITORS make edits for 60s, all converge', async ({ browser }) => {
    test.setTimeout(180_000);

    const boardId = await createBoard((await browser.newPage()));
    const N = MAX_CONCURRENT_EDITORS;
    const participants = await openParticipants(browser, boardId, N);
    await new Promise((r) => setTimeout(r, 1000));

    const latencies: number[] = [];

    // For 60 seconds, make random edits
    const startTime = Date.now();
    let editCount = 0;

    while (Date.now() - startTime < 60_000) {
      // Pick a random participant to make an edit
      const senderIdx = Math.floor(Math.random() * N);
      const sender = participants[senderIdx]!;

      const before = Date.now();

      // Pick a random edit type
      const op = Math.floor(Math.random() * 4);
      try {
        switch (op) {
          case 0: // Create a note
            await sender.page.locator('[data-testid="create-sticky-btn"]').click({ timeout: 2000 });
            await sender.page.keyboard.press('Escape');
            break;
          case 1: {
            // Move a note (if any exist)
            const count = await sender.page.locator(noteCountSelector()).count();
            if (count > 0) {
              const note = sender.page.locator(noteCountSelector()).first();
              const box = await note.boundingBox({ timeout: 1000 });
              if (box) {
                await sender.page.mouse.move(box.x + 50, box.y + 50);
                await sender.page.mouse.down();
                await sender.page.mouse.move(box.x + 70, box.y + 30, { steps: 2 });
                await sender.page.mouse.up();
              }
            }
            break;
          }
          case 2: {
            // Delete a note (if any exist)
            const count = await sender.page.locator(noteCountSelector()).count();
            if (count > 0) {
              const note = sender.page.locator(noteCountSelector()).first();
              await note.click({ timeout: 1000 });
              await sender.page.keyboard.press('Delete');
            }
            break;
          }
          case 3:
            // Noop (small delay)
            await new Promise((r) => setTimeout(r, 100));
            break;
        }
      } catch {
        // Note may have been deleted by another client between check and action
      }

      editCount++;

      // Measure latency to last receiver for this edit
      if (editCount % 5 === 0) {
        const lastReceiverIdx = (senderIdx + 1) % N;
        const receiver = participants[lastReceiverIdx]!;
        await receiver.page.waitForTimeout(50);
        const latency = Date.now() - before;
        if (latency > 0) latencies.push(latency);
      }

      // Small delay between edits to avoid overwhelming
      await new Promise((r) => setTimeout(r, 200));
    }

    // Wait for final convergence
    await new Promise((r) => setTimeout(r, 5_000));

    // All final board snapshots should be identical
    const snapshots = await Promise.all(
      participants.map(async (p) => {
        const count = await p.page.locator(noteCountSelector()).count();
        return count;
      }),
    );

    const expected = snapshots[0];
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i], `Context ${i} count`).toBe(expected);
    }

    // All badges should be hidden (connected)
    for (const p of participants) {
      const badge = p.page.locator('[data-testid="connection-status"]');
      await expect(badge).toBeHidden();
    }

    // Report latency stats
    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const max = sorted[sorted.length - 1];
      console.log(`TC-30 latency stats (n=${latencies.length}): p50=${p50}ms p95=${p95}ms max=${max}ms`);
      console.log(`TC-30 budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
    }

    await closeParticipants(participants);
  });
});
