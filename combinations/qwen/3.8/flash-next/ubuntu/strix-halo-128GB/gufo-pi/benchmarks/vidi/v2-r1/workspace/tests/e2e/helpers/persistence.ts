/**
 * Extended board helpers for persistence E2E tests.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Opens the app at /b/:boardId or creates a new board. */
export async function openBoard(page: Page, boardId?: string): Promise<string> {
  const url = boardId ? `/b/${boardId}` : '/';
  await page.goto(url);
  await expect(page.getByTestId('viewport')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => typeof window.__vidi6?.getCamera === 'function'),
    )
    .toBe(true);
  // Wait for connection
  await waitForConnected(page);
  // Extract the board ID from the URL
  const id = new URL(page.url()).pathname.match(/\/b\/([A-Za-z0-9_-]{22})/)?.[1];
  if (!id) throw new Error('board id missing from url');
  return id;
}

/** Waits for the client to reach 'connected' state. */
export async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as unknown as Record<string, unknown>).__vidi6_connectionState;
    return state === 'connected' || state === 'confirmed';
  }, undefined, { timeout: 10_000 });
}

/** Waits for the client to reach 'load_failed' state. */
export async function waitForLoadFailed(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return (window as unknown as Record<string, unknown>).__vidi6_connectionState === 'load_failed';
  }, undefined, { timeout: 10_000 });
}

/** Waits for the connection status badge to appear with the given text. */
export async function waitForStatusBadge(page: Page, text: string): Promise<void> {
  const badge = page.locator('.connection-status');
  await badge.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(badge).toHaveText(text);
}

/** Gets the note count via the test hook. */
export async function getNoteCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__vidi6?.getNoteCount?.() ?? 0);
}

/** Gets storage stats via the test hook API (HTTP). */
export async function getStorageStats(boardId: string): Promise<{
  updateCount: number;
  updateBytes: number;
  snapshotChunkCount: number;
  snapshotBytes: number;
  quarantineCount: number;
}> {
  const port = process.env.E2E_PORT ?? '4173';
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/storage-stats`);
  if (!res.ok) throw new Error(`storage-stats failed: ${res.status}`);
  return res.json();
}

/** Simulates DO eviction: clears the in-memory state. */
export async function resetState(boardId: string): Promise<void> {
  const port = process.env.E2E_PORT ?? '4173';
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/reset-state`, { method: 'POST' });
  if (!res.ok) throw new Error(`reset-state failed: ${res.status}`);
}

/** Force compaction so the snapshot exists. */
export async function forceCompaction(boardId: string): Promise<void> {
  const port = process.env.E2E_PORT ?? '4173';
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/force-compaction`, { method: 'POST' });
  if (!res.ok) throw new Error(`force-compaction failed: ${res.status}`);
}

/** Corrupts the snapshot for a board. */
export async function corruptSnapshot(boardId: string): Promise<void> {
  const port = process.env.E2E_PORT ?? '4173';
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/corrupt-snapshot`, { method: 'POST' });
  if (!res.ok) throw new Error(`corrupt-snapshot failed: ${res.status}`);
}

/** Repairs the snapshot for a board. */
export async function repairSnapshot(boardId: string): Promise<void> {
  const port = process.env.E2E_PORT ?? '4173';
  const res = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/repair-snapshot`, { method: 'POST' });
  if (!res.ok) throw new Error(`repair-snapshot failed: ${res.status}`);
}
