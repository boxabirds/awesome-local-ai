// Story 3 Nightly E2E: idle connection stability and capacity soak.
// TC-29: idle connection stays connected for 45s
// TC-30: continuous random edits at capacity converge; latency reported

import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { TestSyncClient } from './sync-client';

test.describe('Nightly: connection stability and capacity soak', () => {
  test.describe.configure({ timeout: 180_000 });

  test('TC-29: idle connection stays connected for 45s', async () => {
    const boardId = newBoardId();
    const client = new TestSyncClient(boardId).connect();
    await client.waitForConnected();

    // Stay idle for 45 seconds — the connection should remain alive
    const IDLE_DURATION_MS = 45_000;
    const start = Date.now();
    let disconnected = false;

    while (Date.now() - start < IDLE_DURATION_MS) {
      // Check that the WebSocket is still open
      if (!client.isConnected()) {
        disconnected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    expect(disconnected).toBe(false);
    client.close();
  });

  test('TC-30: capacity soak — continuous random edits converge with latency report', async () => {
    const boardId = newBoardId();
    const numClients = MAX_CONCURRENT_EDITORS;
    const clients: TestSyncClient[] = [];

    for (let i = 0; i < numClients; i++) {
      const c = new TestSyncClient(boardId).connect();
      await c.waitForConnected();
      clients.push(c);
    }

    // Seeded random for reproducibility
    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const words = ['alpha', 'beta', 'gamma', 'delta'];

    // Run continuous random edits for a duration (reduced for CI)
    const DURATION_MS = 15_000;
    const start = Date.now();
    const latencies: number[] = [];
    let opCount = 0;

    while (Date.now() - start < DURATION_MS) {
      const clientIdx = opCount % numClients;
      const client = clients[clientIdx];
      const action = rand();
      const t0 = Date.now();

      if (action < 0.5) {
        // Create a note
        const id = client.createSticky();
        client.setText(id, words[Math.floor(rand() * words.length)]);
      } else if (action < 0.8) {
        // Edit existing note
        const count = client.getNoteCount();
        if (count > 0) {
          const ids = getNoteIds(client);
          const id = ids[Math.floor(rand() * ids.length)];
          client.setText(id, words[Math.floor(rand() * words.length)] + ' ' + Date.now() % 10000);
        }
      } else {
        // Delete a note
        const count = client.getNoteCount();
        if (count > 1) {
          const ids = getNoteIds(client);
          client.deleteNote(ids[Math.floor(rand() * ids.length)]);
        }
      }

      opCount++;

      // Check convergence every 10 ops
      if (opCount % 10 === 0) {
        const otherIdx = (clientIdx + 1) % numClients;
        const other = clients[otherIdx];
        const timeout = Date.now() + 5000;
        while (Date.now() < timeout) {
          if (other.getNoteCount() === client.getNoteCount()) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        latencies.push(Date.now() - t0);
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    // Final convergence check
    await new Promise((r) => setTimeout(r, 3000));
    const refCount = clients[0].getNoteCount();
    for (let i = 1; i < numClients; i++) {
      const c = clients[i].getNoteCount();
      expect(c).toBe(refCount);
    }

    // Print latency report
    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const max = sorted[sorted.length - 1];
      console.log(`\n[Latency Report] ops=${opCount}, measurements=${latencies.length}`);
      console.log(`  p50: ${p50}ms`);
      console.log(`  p95: ${p95}ms`);
      console.log(`  max: ${max}ms`);
      console.log(`  budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
      console.log(`  (reported, not asserted)\n`);
    }

    for (const c of clients) c.close();
  });
});

function getNoteIds(client: TestSyncClient): string[] {
  return client.getNoteIds();
}
