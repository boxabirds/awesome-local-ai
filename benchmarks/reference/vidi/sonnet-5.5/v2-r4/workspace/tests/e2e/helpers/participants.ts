import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
}

export const latencies: { label: string; ms: number }[] = [];

/** Opens n isolated browser contexts on the same board and waits until each is connected and synced. */
export async function openParticipants(
  browser: Browser,
  n: number,
  boardId = newBoardId(),
  names = ['Alex', 'Sam', 'Robin', 'Kim', 'Dana', 'Eli', 'Fran'],
): Promise<{ boardId: string; people: Participant[] }> {
  const people: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(`/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor();
    people.push({ name: names[i] ?? `P${i}`, context, page, consoleErrors });
  }
  await Promise.all(people.map((p) => waitConnected(p.page)));
  return { boardId, people };
}

export async function waitConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

export async function closeAll(people: Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.context.close()));
}

/**
 * expect.poll with the generous functional timeout. Also records how long the change took to appear
 * and logs it against LIVE_UPDATE_LATENCY_BUDGET_MS; the budget is reported, never asserted.
 */
export async function expectEventually<T>(label: string, read: () => Promise<T>, expected: T): Promise<number> {
  const start = Date.now();
  await expect.poll(read, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: label }).toEqual(expected);
  const ms = Date.now() - start;
  latencies.push({ label, ms });
  const flag = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ' (over budget, not asserted)' : '';
  console.log(`[latency] ${label}: ${ms} ms vs budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms${flag}`);
  return ms;
}

export function report(samples: number[]): string {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} p50=${q(0.5)}ms p95=${q(0.95)}ms max=${s[s.length - 1]}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`;
}

export interface NoteView {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

/** DOM snapshot of every note on the page, sorted by id. */
export async function noteViews(page: Page): Promise<NoteView[]> {
  const views = await page.getByRole('group', { name: 'Sticky note' }).evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-note-id') ?? '',
      x: Math.round(parseFloat((el as HTMLElement).style.left)),
      y: Math.round(parseFloat((el as HTMLElement).style.top)),
      color: getComputedStyle(el).backgroundColor,
      text: el.querySelector('[data-testid="note-text"]')?.textContent ?? '',
    })),
  );
  return views.sort((a, b) => (a.id < b.id ? -1 : 1));
}
