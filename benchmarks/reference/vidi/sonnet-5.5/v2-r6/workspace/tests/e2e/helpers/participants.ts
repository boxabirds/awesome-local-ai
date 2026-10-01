import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createBoardId } from './create';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { setCamera } from './board';

export interface Participant { context: BrowserContext; page: Page; errors: string[] }

export const notesOf = (page: Page): Locator => page.getByRole('group', { name: 'Sticky note' });

/** Opens N isolated browser contexts on the same board and waits until each is synced. */
export async function openParticipants(
  browser: Browser, n: number, boardId?: string,
): Promise<Participant[]> {
  const id = boardId ?? (await createBoardId());
  return Promise.all(Array.from({ length: n }, async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/b/${id}`);
    await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe('connected');
    await setCamera(page, 0, 0, 1);
    return { context, page, errors };
  }));
}

export const latencies: number[] = [];

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) for a functional outcome and logs how long it took
 * relative to LIVE_UPDATE_LATENCY_BUDGET_MS. The budget is reported, never asserted.
 */
export async function expectEventually<T>(
  label: string, read: () => Promise<T>, expected: T | ((v: T) => boolean), sentAt = Date.now(),
): Promise<number> {
  const ok = (v: T) => (typeof expected === 'function' ? (expected as (v: T) => boolean)(v) : JSON.stringify(v) === JSON.stringify(expected));
  await expect.poll(async () => ok(await read()), {
    timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [25, 50, 100],
  }, ).toBe(true);
  const ms = Date.now() - sentAt;
  latencies.push(ms);
  console.log(`[latency] ${label}: ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms${ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ', OVER' : ''})`);
  return ms;
}

export interface NoteView { text: string; left: number; top: number; bg: string }

/** DOM snapshot of all notes, order-independent. */
export async function boardSnapshot(page: Page): Promise<NoteView[]> {
  const notes = await notesOf(page).evaluateAll((els) => els.map((el) => {
    const e = el as HTMLElement;
    const text = e.querySelector('textarea') ? (e.querySelector('textarea') as HTMLTextAreaElement).value
      : (e.querySelector('[data-testid="sticky-text"]') as HTMLElement | null)?.textContent ?? '';
    return { text, left: parseFloat(e.style.left), top: parseFloat(e.style.top), bg: getComputedStyle(e).backgroundColor };
  }));
  return notes.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function pos(note: Locator): Promise<[number, number]> {
  return note.evaluate((el) => [parseFloat((el as HTMLElement).style.left), parseFloat((el as HTMLElement).style.top)] as [number, number]);
}

export async function dragNote(page: Page, note: Locator, dx: number, dy: number): Promise<void> {
  const b = (await note.boundingBox())!;
  const from = { x: b.x + 20, y: b.y + 20 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}
