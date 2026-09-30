import { type Browser, type BrowserContext, type Page } from '@playwright/test';

export const E2E_EVENTUAL_TIMEOUT_MS = 10_000;

export interface Participant {
  context: BrowserContext;
  page: Page;
  boardUrl: string;
}

export async function createParticipant(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const boardUrl = `/b/${boardId}`;
  await page.goto(boardUrl);
  await page.waitForSelector('[data-testid="board-viewport"]');
  // Wait for initial sync to complete (connectionState should become 'connected')
  await waitForConnected(page);
  return { context, page, boardUrl };
}

export async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6;
    return hook?.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

export async function getNoteCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll('[role="group"][aria-label="Sticky note"]').length,
  );
}

export async function getNoteText(page: Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const el = notes[i];
    if (!el) return '';
    const textEl = el.querySelector('.sticky-note-text') || el.querySelector('.sticky-textarea');
    if (textEl && 'value' in textEl) return (textEl as HTMLTextAreaElement).value;
    return textEl?.textContent ?? '';
  }, index);
}

export async function getNoteWorldPos(
  page: Page,
  index: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const el = notes[i] as HTMLElement | undefined;
    if (!el) throw new Error(`note at index ${i} not found`);
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  }, index);
}

export async function getNoteScreenPos(
  page: Page,
  index: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const el = notes[i] as HTMLElement | undefined;
    if (!el) throw new Error(`note at index ${i} not found`);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  }, index);
}

export async function getBoardSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const result: Array<{ x: number; y: number; text: string }> = [];
    notes.forEach((n) => {
      const el = n as HTMLElement;
      const textEl = el.querySelector('.sticky-note-text') || el.querySelector('.sticky-textarea');
      const text = textEl && 'value' in textEl ? (textEl as HTMLTextAreaElement).value : textEl?.textContent ?? '';
      result.push({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), text });
    });
    // Sort by x then y for deterministic comparison
    result.sort((a, b) => a.x - b.x || a.y - b.y);
    return JSON.stringify(result);
  });
}

export async function createNoteAtPoint(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid="sticky-textarea"]');
}

export async function expectEventually<T>(
  fn: () => Promise<T>,
  check: (val: T) => boolean | Promise<boolean>,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < E2E_EVENTUAL_TIMEOUT_MS) {
    const val = await fn();
    if (await check(val)) {
      const elapsed = Date.now() - start;
      console.log(`[latency] ${label}: ${elapsed}ms`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`[timeout] ${label} not met after ${E2E_EVENTUAL_TIMEOUT_MS}ms`);
}
