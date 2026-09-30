import { test, expect } from '@playwright/test';
import { newBoardId } from '@shared/board-id';
import { getNoteCount } from './helpers/board';
import { waitForConnected } from './helpers/participants';
import { startWrangler, cleanupDir, type WranglerProc } from './helpers/wrangler-process';

test.describe.configure({ mode: 'serial' });

async function waitUntil(
  fn: () => Promise<number>,
  target: (n: number) => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (target(await fn())) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`waitUntil not met after ${timeoutMs}ms (last=${await fn()})`);
}

const POST = { method: 'POST' };

// TC-24: a corrupted snapshot shows the red load-failure banner and blocks editing;
// repairing the storage and reloading recovers the board.
test('TC-24: corrupted snapshot -> banner + no edits; repair -> recovers', async ({ browser }) => {
  test.setTimeout(150_000);
  const port = 8793;
  const id = newBoardId();
  let proc: WranglerProc | null = null;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    proc = await startWrangler({ port, testHooks: true });

    // Seed a small board (below the compaction threshold, so the full log survives
    // a snapshot repair).
    const seed = (await (
      await fetch(`${proc.url}/__test/seed?room=${id}&count=5&seed=3`, POST)
    ).json()) as { notes: number };
    expect(seed.notes).toBe(5);

    await page.goto(`${proc.url}/b/${id}`);
    await waitForConnected(page);
    await waitUntil(() => getNoteCount(page), (n) => n === 5);

    // Corrupt the persisted snapshot and force the DO to reload from storage.
    await fetch(`${proc.url}/__test/corrupt-snapshot?room=${id}`, POST);
    await fetch(`${proc.url}/__test/reload?room=${id}`, POST);
    const st = (await (await fetch(`${proc.url}/__test/state?room=${id}`)).json()) as {
      state: string;
      notes: number;
    };
    expect(st.state).toBe('load-failed');
    expect(st.notes).toBe(0);

    // Reconnect from the browser: refused with the load-failure banner, no notes,
    // editing disabled.
    await page.reload();
    await expect(page.getByText(/board couldn.t be loaded/)).toBeVisible({ timeout: 20_000 });
    expect(await getNoteCount(page)).toBe(0);
    expect(
      await page.$eval('[data-testid="sticky-note-btn"]', (el) => (el as HTMLButtonElement).disabled),
    ).toBe(true);

    // Repair the snapshot and reload; the board comes back.
    await fetch(`${proc.url}/__test/repair-snapshot?room=${id}`, POST);
    await fetch(`${proc.url}/__test/reload?room=${id}`, POST);
    const repaired = (await (await fetch(`${proc.url}/__test/state?room=${id}`)).json()) as {
      state: string;
      notes: number;
    };
    expect(repaired.state).toBe('ready');
    expect(repaired.notes).toBe(5);

    await page.reload();
    await waitForConnected(page);
    await waitUntil(() => getNoteCount(page), (n) => n === 5);
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="group"][aria-label="Sticky note"] .sticky-note-text')]
        .map((e) => e.textContent ?? '')
        .sort(),
    );
    expect(texts).toEqual(['Note 0', 'Note 1', 'Note 2', 'Note 3', 'Note 4']);
  } finally {
    await ctx.close();
    if (proc) await proc.kill();
    if (proc) cleanupDir(proc.persistDir);
  }
});
