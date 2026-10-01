import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';

export interface Participant {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

export function notesOf(page: Page): Locator {
  return page.getByRole('group', { name: 'Sticky note' });
}

/** Opens `n` isolated browser contexts on one board and waits until each has connected. */
export async function openParticipants(
  browser: Browser,
  n: number,
  boardId: string = newBoardId(),
): Promise<Participant[]> {
  const out: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('origin-marker')).toBeVisible();
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    out.push({ context, page, errors });
  }
  return out;
}

export async function closeAll(participants: Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

export const latencies: number[] = [];

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) for `check` to hold and logs how long it took
 * against LIVE_UPDATE_LATENCY_BUDGET_MS. The budget is reported, never asserted.
 */
export async function expectEventually(label: string, check: () => Promise<boolean>): Promise<number> {
  const start = Date.now();
  await expect.poll(check, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: label }).toBe(true);
  const ms = Date.now() - start;
  latencies.push(ms);
  const flag = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? 'OVER budget' : 'within budget';
  console.log(`[latency] ${label}: ${ms} ms (${flag} of ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`);
  return ms;
}

export interface NoteView { id: string; x: number; y: number; bg: string; text: string }

/** DOM snapshot of all notes, ordered by id so it can be compared across pages. */
export async function boardSnapshot(page: Page): Promise<NoteView[]> {
  const views = await page.locator('[data-note-id]').evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        id: e.getAttribute('data-note-id') ?? '',
        x: parseFloat(e.style.left),
        y: parseFloat(e.style.top),
        bg: e.style.background,
        text: e.querySelector('[data-testid="note-text"]')?.textContent?.replace(/​/g, '') ?? '',
      };
    }),
  );
  return views.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function allSnapshotsEqual(pages: Page[]): Promise<boolean> {
  const snaps = await Promise.all(pages.map(boardSnapshot));
  return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
}

export async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  const before = new Set(await page.locator('[data-note-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-note-id'))));
  await page.mouse.dblclick(x, y);
  // Others may add notes meanwhile, so wait for the note being edited rather than counting.
  const editor = page.locator('[data-note-id] textarea');
  await expect(editor).toHaveCount(1);
  const id = await editor.evaluate((el) => el.closest('[data-note-id]')?.getAttribute('data-note-id') as string);
  expect(before.has(id)).toBe(false);
  return id;
}

export async function dragNote(page: Page, note: Locator, dx: number, dy: number): Promise<void> {
  const box = (await note.boundingBox())!;
  const from = { x: box.x + 30, y: box.y + 30 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

export async function notePos(note: Locator): Promise<{ x: number; y: number }> {
  return note.evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
}
