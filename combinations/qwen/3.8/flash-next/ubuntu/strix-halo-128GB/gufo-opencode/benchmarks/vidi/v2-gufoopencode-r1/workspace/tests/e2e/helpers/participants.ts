import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
}

export async function openParticipant(browser: Browser, name: string, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await page.goto(`/b/${boardId}`);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
  return { name, context, page, consoleErrors };
}

// A DOM-level board snapshot: every sticky's id, screen position and text.
// Independent of camera (all participants use the default camera).
export function boardSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const notes = [...document.querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => id.startsWith('sticky-') && !id.startsWith('sticky-text-') && !id.startsWith('sticky-fade-'))
      .map((testId) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
        const style = getComputedStyle(el);
        const text = document.querySelector(`[data-testid="sticky-text-${testId.slice('sticky-'.length)}"]`)?.textContent ?? '';
        return `${testId} @ ${style.left},${style.top} bg=${style.backgroundColor} "${text}"`;
      });
    notes.sort();
    return notes.join('\n');
  });
}

export function snapshotOf(...participants: Participant[]): Promise<string[]> {
  return Promise.all(participants.map((p) => boardSnapshot(p.page)));
}

// expectEventually wraps an expect.poll-style assertion and records how long
// the change took to become visible. The latency budget is reported, never
// asserted: model, browsers and server share one machine.
export async function expectEventually(label: string, assert: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await assert();
  const elapsed = Date.now() - started;
  const verdict = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER';
  console.log(`[latency] ${label}: ${elapsed}ms ${verdict} budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
}

export function eventually<T>(fn: () => Promise<T>, message: string) {
  return expect.poll(fn, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message });
}
