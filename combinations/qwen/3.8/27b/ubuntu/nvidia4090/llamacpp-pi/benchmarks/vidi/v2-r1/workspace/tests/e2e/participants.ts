// E2E test helper: opens multiple browser contexts on the same board and
// provides utilities for testing live collaboration.

import { Page, BrowserContext, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';

export interface Participant {
  context: BrowserContext;
  page: Page;
  /** Get the number of sticky notes visible on the board. */
  noteCount(): Promise<number>;
  /** Get all note texts visible on the board. */
  noteTexts(): Promise<string[]>;
  /** Create a sticky note via the toolbar. */
  createNote(): Promise<void>;
  /** Get the connection status badge text (if visible). */
  connectionStatus(): Promise<string | null>;
}

const E2E_EVENTUAL_TIMEOUT_MS = 15000;

/**
 * Open N participants on the same board.
 */
export async function createParticipants(
  browser: any,
  count: number,
  boardId?: string,
): Promise<{ participants: Participant[]; boardId: string }> {
  const id = boardId || newBoardId();
  const participants: Participant[] = [];

  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${id}`);

    // Wait for the board to be ready
    await page.waitForSelector('[data-testid="board-canvas"], .board-canvas, canvas, [class*="board"]', { timeout: 15000 });

    participants.push({
      context,
      page,
      noteCount: async () => {
        return page.locator('[data-note-id]').count();
      },
      noteTexts: async () => {
        const texts = await page.locator('[data-note-id]').allTextContents();
        return texts.filter((t: string) => t.trim().length > 0);
      },
      createNote: async () => {
        // Click the "add note" button or use the test hook
        await page.evaluate(() => {
          const hook = (window as any).__vidi6;
          if (hook?.createNote) {
            hook.createNote();
            return;
          }
          // Fallback: click the toolbar add button
        });
        // Try clicking a visible "add" button
        const addBtn = page.locator('button:has-text("Add"), button[aria-label*="add" i], button[aria-label*="note" i]');
        if (await addBtn.count() > 0) {
          await addBtn.first().click();
        } else {
          // Use test hook
          await page.evaluate(() => {
            const h = (window as any).__vidi6;
            if (h?.createNote) h.createNote();
          });
        }
      },
      connectionStatus: async () => {
        const badge = page.locator('[role="status"]');
        if (await badge.count() === 0) return null;
        return badge.first().textContent();
      },
    });
  }

  return { participants, boardId: id };
}

/**
 * Poll a condition until it passes or timeout.
 */
export async function expectEventually(
  fn: () => Promise<any>,
  options?: { timeout?: number; message?: string },
): Promise<void> {
  const timeout = options?.timeout || E2E_EVENTUAL_TIMEOUT_MS;
  const start = Date.now();

  for (;;) {
    try {
      await fn();
      return;
    } catch (e) {
      if (Date.now() - start > timeout) {
        throw new Error(
          `expectEventually timed out after ${timeout}ms: ${options?.message || e}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Close all participants.
 */
export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) {
    await p.context.close();
  }
}
