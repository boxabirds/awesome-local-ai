import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { settled } from './board';
import { createBoardVia } from './create';

export interface Participant { name: string; context: BrowserContext; page: Page; errors: string[] }

export const latencies: number[] = [];

/** The connection badge (role=status; the zoom readout is also an output, so filter by text). */
export const badge = (page: Page): Locator => page.getByRole('status').filter({ hasText: /^(Connecting…|Reconnecting…|Connected)$/ });

export const notesOf = (page: Page): Locator => page.getByRole('group', { name: 'Sticky note' });

/** Opens N isolated contexts on the same board and waits until each is connected and synced. */
export async function openParticipants(
  browser: Browser, names: string[], boardId?: string,
): Promise<Participant[]> {
  let id = boardId;
  if (!id) {
    const creator = await browser.newContext();
    id = await createBoardVia(creator.request);
    await creator.close();
  }
  return Promise.all(names.map(async (name) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await settled(page);
    await expect(badge(page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    return { name, context, page, errors };
  }));
}

/**
 * Polls until `read` returns the expected value (functional assertion with a generous timeout).
 * The time it took is logged against LIVE_UPDATE_LATENCY_BUDGET_MS but never asserted.
 */
export async function expectEventually<T>(label: string, read: () => Promise<T>, expected: T): Promise<number> {
  const start = Date.now();
  await expect.poll(read, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: label }).toEqual(expected);
  const took = Date.now() - start;
  latencies.push(took);
  const verdict = took <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER';
  console.log(`[latency] ${label}: ${took}ms (${verdict} ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`);
  return took;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function logLatencyReport(title: string, values: number[] = latencies): void {
  console.log(
    `[latency report] ${title}: n=${values.length} p50=${percentile(values, 50)}ms p95=${percentile(values, 95)}ms `
    + `max=${percentile(values, 100)}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted)`,
  );
}

/** Board state read from the DOM, comparable across participants. */
export async function boardSnapshot(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('[data-sticky]')]
    .map((el) => {
      const e = el as HTMLElement;
      return [
        e.dataset.id, e.getAttribute('data-x'), e.getAttribute('data-y'),
        getComputedStyle(e).backgroundColor, e.textContent ?? '',
      ].join('|');
    })
    .sort());
}

export async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
