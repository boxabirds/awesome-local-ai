/**
 * Story 4 persistence e2e helpers: seeding through the real client path,
 * reading the live board, and calling the server-side test hooks.
 */
import { expect, type Page } from '@playwright/test';
import type { NoteSnapshot } from '../helpers/board';

/** Applies base64 Yjs updates to the board doc via the client test hook. */
export async function seedBoard(page: Page, updates: string[]): Promise<void> {
  await page.evaluate((u) => (window as any).__vidi6?.applyUpdates(u), updates);
}

export async function getBoardNotes(page: Page): Promise<NoteSnapshot[]> {
  return page.evaluate(() => (window as any).__vidi6?.getNotes?.() ?? []);
}

/** Waits until the board shows exactly `n` notes. */
export async function waitForNoteCount(page: Page, n: number, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(
      async () => (await getBoardNotes(page)).length,
      { timeout: timeoutMs, message: `waiting for ${n} notes` },
    )
    .toBe(n);
}

/** A server test hook: GET/POST /__test/boards/:id/:op. */
export async function hook(
  baseURL: string,
  boardId: string,
  op: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const method = body === undefined ? 'GET' : 'POST';
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/${op}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Waits until the room has stored at least `minUpdates` update rows (the
 * write-before-broadcast guarantee made observable).
 */
export async function waitStored(baseURL: string, boardId: string, minUpdates: number, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(
      async () => (await hook(baseURL, boardId, 'storage-info')).json?.updates ?? 0,
      { timeout: timeoutMs, message: `waiting for >= ${minUpdates} stored updates` },
    )
    .toBeGreaterThanOrEqual(minUpdates);
}
