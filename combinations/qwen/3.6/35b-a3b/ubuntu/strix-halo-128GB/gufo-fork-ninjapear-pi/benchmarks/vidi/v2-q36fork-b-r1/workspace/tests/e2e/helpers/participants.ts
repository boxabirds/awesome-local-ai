/**
 * E2E helpers for multi-participant testing.
 */
import type { Page, Locator } from '@playwright/test';
import { newBoardId } from '@/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS } from '@/shared/config';

const DEFAULT_TIMEOUT = 30_000;

export async function openTwoParticipants(
  contextA: import('@playwright/test').BrowserContext,
  contextB: import('@playwright/test').BrowserContext,
): Promise<{ pageA: Page; pageB: Page; boardId: string }> {
  const boardId = newBoardId();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await Promise.all([
    pageA.goto(`/b/${boardId}`),
    pageB.goto(`/b/${boardId}`),
  ]);

  const settleTimeout = Math.min(DEFAULT_TIMEOUT, E2E_EVENTUAL_TIMEOUT_MS);
  await Promise.race([
    pageA.waitForLoadState('networkidle', { timeout: settleTimeout }),
    pageA.waitForTimeout(settleTimeout / 2),
  ]).catch(() => {});
  await Promise.race([
    pageB.waitForLoadState('networkidle', { timeout: settleTimeout }),
    pageB.waitForTimeout(settleTimeout / 2),
  ]).catch(() => {});

  return { pageA, pageB, boardId };
}

export async function waitForFirstNote(page: Page, timeout?: number): Promise<void> {
  await page.waitForSelector('[data-testid^="sticky-"]', { timeout: timeout ?? E2E_EVENTUAL_TIMEOUT_MS });
}

export async function waitForNNotes(page: Page, n: number, timeout?: number): Promise<void> {
  await page.waitForFunction(
    (expectedCount: number) => document.querySelectorAll('[data-testid^="sticky-"]').length >= expectedCount,
    n,
    { timeout: timeout ?? E2E_EVENTUAL_TIMEOUT_MS },
  );
}

export async function dblClickEmptySpace(page: Page, offsetX?: number, offsetY?: number): Promise<void> {
  const x = offsetX ?? page.viewportSize()!.width / 2;
  const y = offsetY ?? page.viewportSize()!.height / 2;
  await page.mouse.dblclick(x, y);
  await waitForFirstNote(page);
}
