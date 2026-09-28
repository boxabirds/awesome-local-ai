// Story 4, nightly: a board big enough to matter - PERSIST_TESTED_NOTES notes -
// is written, the process that wrote it is stopped, and the board is read back
// from disk inside the budget the design allows for it (BOARD_LOAD_BUDGET_MS),
// then a person arriving finds every note in the page.
//
// The budget is applied to the room's cold read of storage, which is what this
// story adds and what the number is about: after a restart, the first request
// that touches a Durable Object instantiates it, and its constructor does not
// answer until the board has been read. Rendering 2000 DOM nodes is the page's
// own work, unchanged by this story, so it is asserted to complete rather than
// gated by that number.
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config.ts';
import { buildSizedBoard } from '../fixtures/boards.ts';
import { connectionBadge } from './helpers/room.ts';
import { readNotes, roomStats, seedRoom } from './helpers/persistence.ts';
import { startWorker, type ManagedWorker } from './helpers/wrangler-process.ts';

const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 4198);

test('TC-21 a sized board is read back from storage inside the load budget', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const board = buildSizedBoard(PERSIST_TESTED_NOTES);
  const worker: ManagedWorker = await startWorker(WORKER_PORT);
  try {
    const boardId = newBoardId();
    // One call, one Yjs update, whatever it takes to write: the room applies it,
    // appends it and folds it into a chunked snapshot.
    const seeded = await seedRoom(boardId, board.update, worker.origin);
    expect(seeded.state).toBe('ready');
    expect(seeded.logRows).toBe(0);
    expect(seeded.chunks).toBeGreaterThanOrEqual(1);

    // The process that wrote the board goes away, so what follows is a cold read
    // of the file rather than a lookup in a warm cache.
    await worker.stop();
    await worker.restart();
    // Warm the worker on an unrelated board first: the timing below must be this
    // board's storage read, not the worker process's own start-up.
    await roomStats(newBoardId(), worker.origin);

    const started = Date.now();
    const cold = await roomStats(boardId, worker.origin);
    const coldMs = Date.now() - started;
    expect(cold.state).toBe('ready');
    expect(cold.serving).toBe(true);
    expect(cold.logRows).toBe(0);
    expect(coldMs, `${PERSIST_TESTED_NOTES} notes read back in ${coldMs}ms`).toBeLessThan(
      BOARD_LOAD_BUDGET_MS,
    );

    // A person who arrives now gets the whole board.
    const page = await browser.newPage();
    await page.goto(`${worker.origin}/b/${boardId}`);
    await page.waitForSelector('[data-testid="viewport"]');
    await page.waitForFunction(
      (n: number) =>
        document.querySelectorAll('[role="group"][aria-label="Sticky note"]').length === n,
      PERSIST_TESTED_NOTES,
      { timeout: 120_000 },
    );
    const onScreen = await readNotes(page);
    expect(onScreen.length).toBe(PERSIST_TESTED_NOTES);
    expect(onScreen.every((n) => n.editable)).toBe(true);
    // The badge renders nothing once the board is steady.
    await expect(connectionBadge(page)).toHaveCount(0);
    await page.close();
  } finally {
    await worker.dispose();
  }
});
