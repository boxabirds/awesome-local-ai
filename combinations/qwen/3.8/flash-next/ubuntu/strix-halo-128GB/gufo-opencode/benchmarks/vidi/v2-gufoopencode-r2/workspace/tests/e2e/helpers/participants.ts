// Multi-participant helpers for live-collaboration e2e tests: isolated
// browser contexts on the same /b/<boardId> (separate contexts = separate
// storage, exactly like separate machines) and a latency-logging eventual
// assertion wrapper.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';
import { getNotes, type NoteInfo } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
}

export async function openParticipants(
  browser: Browser,
  names: string[],
  boardId: string = newBoardId(),
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (const name of names) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(name, page);
    participants.push({ name, context, page });
  }
  return participants;
}

export async function waitForConnected(name: string, page: Page): Promise<void> {
  await expect
    .poll(() => connectionState(page), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `${name} should reach connected state`,
    })
    .toBe('connected');
}

export function connectionState(page: Page): Promise<string> {
  return page.evaluate(
    () => window.__vidi6?.connectionState?.() ?? 'missing-hook',
  );
}

export async function waitForSync(
  parties: Participant[],
  expectedNoteCount: number,
): Promise<void> {
  for (const p of parties) {
    await expect
      .poll(() => getNotes(p.page).then((n) => n.length), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `${p.name} to see ${expectedNoteCount} notes`,
      })
      .toBe(expectedNoteCount);
  }
}

/**
 * Eventually-true assertion that also records the time until the change
 * arrived. Latency is reported against the PRD budget, never asserted: model,
 * browsers and server share one machine (see tasks.md task 8).
 */
export async function eventually<T>(
  what: string,
  getter: () => Promise<T>,
  expected: T,
): Promise<void> {
  const started = Date.now();
  await expect
    .poll(getter, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: what })
    .toEqual(expected);
  const elapsed = Date.now() - started;
  const verdict = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER';
  console.log(
    `[latency] ${what}: ${elapsed}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ${verdict}; reported, not asserted)`,
  );
}

export async function waitForNoteCount(page: Page, count: number): Promise<NoteInfo[]> {
  await expect
    .poll(() => getNotes(page).then((n) => n.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return getNotes(page);
}

export function signature(notes: readonly { id: string; x: number; y: number; color: string; text: string }[]): string {
  return JSON.stringify(notes.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) })));
}

export async function noteCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function dragFromTo(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2), {
    steps: 4,
  });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) await p.context.close();
}

/**
 * In-page recorder: every distinct connectionState and badge text over the
 * page lifetime. Sampling is in-page so short badge windows (Connected shows
 * for CONNECTED_CONFIRMATION_MS then hides) cannot be missed by polling.
 */
export function installRecorder(page: Page): Promise<void> {
  return page.evaluate(() => {
    const store = { states: [] as string[], badges: [] as string[] };
    (window as unknown as { __recorder?: typeof store }).__recorder = store;
    const sample = () => {
      const s = window.__vidi6?.connectionState?.() ?? 'missing';
      if (store.states[store.states.length - 1] !== s) store.states.push(s);
      const b = document.querySelector('[role="status"]')?.textContent ?? '';
      if (store.badges[store.badges.length - 1] !== b) store.badges.push(b);
    };
    new MutationObserver(sample).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    setInterval(sample, 500);
    sample();
  });
}

export function readRecorder(
  page: Page,
): Promise<{ states: string[]; badges: string[] }> {
  return page.evaluate(
    () =>
      (window as unknown as {
        __recorder?: { states: string[]; badges: string[] };
      }).__recorder ?? { states: [], badges: [] },
  );
}
