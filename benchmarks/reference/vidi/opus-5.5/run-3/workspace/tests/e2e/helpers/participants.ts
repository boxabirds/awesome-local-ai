import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught page errors seen so far. */
  errors: string[];
}

/** Opens `names.length` isolated browser contexts on the same board and waits until each is connected. */
export async function openParticipants(
  browser: Browser,
  names: string[],
  boardId: string = newBoardId(),
  /** Optional script run in every page before the app loads. */
  initScript?: () => void,
): Promise<{ boardId: string; people: Participant[] }> {
  const people = await Promise.all(
    names.map(async (name) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      if (initScript) await context.addInitScript(initScript);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => {
        errors.push(`dialog: ${d.message()}`);
        void d.dismiss();
      });
      await page.goto(`/b/${boardId}`);
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      await waitConnected(page);
      return { name, context, page, errors };
    }),
  );
  return { boardId, people };
}

export async function waitConnected(page: Page, timeout = 15_000) {
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout }).toBe('connected');
}

export async function closeAll(people: Participant[]) {
  await Promise.all(people.map((p) => p.context.close()));
}

/** `expect.poll` with the live-update latency budget as its timeout, polling fast. */
export function expectWithin<T>(fn: () => Promise<T> | T, message?: string) {
  return expect.poll(fn, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, intervals: [10], message });
}

export function connectionBadge(page: Page) {
  return page.getByRole('status', { name: 'Connection status' });
}

/** Everything a person sees of each note: id, position, colour and text, in DOM order. */
export async function domSnapshot(page: Page) {
  return page.locator('[data-note-id]').evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.noteId,
        left: h.style.left,
        top: h.style.top,
        color: h.dataset.color,
        text: h.querySelector('.sticky-note__content')?.textContent ?? '',
      };
    }),
  );
}
