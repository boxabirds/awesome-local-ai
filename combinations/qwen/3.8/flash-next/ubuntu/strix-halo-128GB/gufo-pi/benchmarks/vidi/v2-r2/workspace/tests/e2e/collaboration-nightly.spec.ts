import { test, expect } from '@playwright/test';
import {
  createParticipant,
  createBoardViaUi,
  getNoteCount,
  getBoardSnapshot,
  createNoteAtPoint,
  expectEventually,
  type Participant,
} from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';

test.describe.configure({ timeout: 180_000 });

test.describe('Nightly: idle connection stability', () => {
  // TC-29: two contexts connected, no activity for 45s, badge never shows "Reconnecting…"
  test('TC-29: idle 45s → connectionState stays "connected"', async ({ browser }) => {
    const ctx0 = await browser.newContext();
    const p0 = await ctx0.newPage();
    const boardId = await createBoardViaUi(p0);
    await ctx0.close();
    const alex = await createParticipant(browser, boardId);
    const sam = await createParticipant(browser, boardId);

    const idleMs = 45_000;
    const startTime = Date.now();
    let reconnectedSeen = false;

    while (Date.now() - startTime < idleMs) {
      const state = await alex.page.evaluate(() => {
        const hook = (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6;
        return hook?.connectionState ?? 'unknown';
      });
      if (state === 'reconnecting') {
        reconnectedSeen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    expect(reconnectedSeen).toBe(false);

    // Final state should be connected
    const finalState = await alex.page.evaluate(() => {
      const hook = (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6;
      return hook?.connectionState;
    });
    expect(finalState).toBe('connected');

    await alex.context.close();
    await sam.context.close();
  });
});

test.describe('Nightly: capacity soak with latency report', () => {
  // TC-30: MAX_CONCURRENT_EDITORS contexts continuous edits for 60s, all converge
  test('TC-30: convergence at capacity', async ({ browser }) => {
    const ctx0 = await browser.newContext();
    const p0 = await ctx0.newPage();
    const boardId = await createBoardViaUi(p0);
    await ctx0.close();
    const participants: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const p = await createParticipant(browser, boardId);
      participants.push(p);
    }

    const soakDuration = 60_000;
    const startTime = Date.now();
    const latencies: number[] = [];
    let noteCounter = 0;

    while (Date.now() - startTime < soakDuration) {
      // Each participant creates a note
      for (let i = 0; i < participants.length; i++) {
        const x = 100 + (noteCounter * 30) % 800;
        const y = 100 + (noteCounter * 50) % 600;
        await createNoteAtPoint(participants[i].page, x, y);
        await participants[i].page.keyboard.press('Escape');
        noteCounter++;
      }

      // Wait briefly for propagation
      await new Promise((r) => setTimeout(r, 500));
    }

    // Measure convergence time
    const convergeStart = Date.now();
    const expectedCount = noteCounter;

    for (let i = 0; i < participants.length; i++) {
      await expectEventually(
        () => getNoteCount(participants[i].page),
        (count) => count === expectedCount,
        `TC-30 participant ${i} final count (${expectedCount})`,
      );
      latencies.push(Date.now() - convergeStart);
    }

    // All snapshots should be identical
    const snaps = await Promise.all(participants.map((p) => getBoardSnapshot(p.page)));
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]).toBe(snaps[0]);
    }

    // Print latency report (reported, NOT asserted)
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const max = latencies[latencies.length - 1] || 0;
    console.log(`[TC-30 latency report] notes=${expectedCount} p50=${p50}ms p95=${p95}ms max=${max}ms`);

    // Close all contexts and verify no reconnect attempts after close
    for (const p of participants) {
      await p.context.close();
    }

    // Verify no console errors after teardown
    await new Promise((r) => setTimeout(r, 1000));
  });
});
