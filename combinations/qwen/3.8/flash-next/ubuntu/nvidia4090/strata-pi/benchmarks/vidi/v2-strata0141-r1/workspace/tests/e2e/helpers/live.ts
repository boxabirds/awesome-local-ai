import { expect, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { boardIdOfPage, ensureBoard } from './board';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { getNotes } from './sticky';

/**
 * Live-collaboration helpers: several browser pages on one board.
 *
 * Convergence is always waited for with `E2E_EVENTUAL_TIMEOUT_MS` as a functional
 * bound ("it did arrive"), while the measured wall-clock latency is logged
 * against LIVE_UPDATE_LATENCY_BUDGET_MS instead of asserted - the browsers, the
 * model and the server all share this machine.
 */

/** A board address that nothing else uses. */
export const newLiveBoardId = (): string => newBoardId();

/** The board a page is on, read from its address. */
export { boardIdOfPage };

/** A page joined to `boardId`, with its board rendered. */
export async function joinBoard(
  context: BrowserContext,
  boardId: string,
): Promise<Page> {
  const page = await context.newPage();
  // A board only serves a board that exists (`share.not_found`), so a test that
  // invented an address has to make it real before anyone can join it.
  await ensureBoard(page, boardId);
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board"]');
  await page.waitForSelector('[data-testid="world-layer"]');
  await waitForBoardConnection(page);
  return page;
}

/** The connection state the page's status badge is rendering. */
export async function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: { connectionState(): string } }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.connectionState();
  });
}

/** Wait until the room has answered this page (the badge stops saying "Connecting…"). */
export async function waitForBoardConnection(page: Page): Promise<void> {
  await expect
    .poll(async () => await connectionState(page), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: 'the board never reached the room',
    })
    .toBe('connected');
}

/** The badge text a page shows. */
export async function badgeText(page: Page): Promise<string> {
  return (await page.locator('[data-testid="connection-status"]').textContent()) ?? '';
}

/** Every console error and page error a page reported. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

/** Compare notes as a canonical list: id, text, position, colour. */
export function noteList(notes: readonly StickySnapshot[]): string[] {
  return notes
    .map((note) => `${note.id}|${note.text}|${note.x}|${note.y}|${note.color}|${note.z}`)
    .sort();
}

/** Wait until every page's board holds the same notes. */
export async function waitForSameBoard(pages: readonly Page[]): Promise<readonly StickySnapshot[]> {
  let last: string[] = [];
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(async (page) => noteList(await getNotes(page))));
        last = all[0] ?? [];
        return all.every((list) => JSON.stringify(list) === JSON.stringify(last));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the boards never became identical' },
    )
    .toBe(true);
  return getNotes(pages[0] as Page);
}

/** Wait until one page's board holds exactly `count` notes. */
export async function waitForNoteCount(page: Page, count: number): Promise<readonly StickySnapshot[]> {
  await expect
    .poll(async () => (await getNotes(page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never showed ${count} notes`,
    })
    .toBe(count);
  return getNotes(page);
}

/** Wait until a note with this id exists on the page (true) or is gone (false). */
export async function waitForNote(page: Page, id: string, present = true): Promise<void> {
  await expect
    .poll(
      async () => (await getNotes(page)).some((note) => note.id === id) === present,
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `note ${id} never became ${present ? 'visible' : 'gone'}` },
    )
    .toBe(true);
}

/**
 * Measure how long a change takes to appear on another page.
 *
 * The clock is the test runner's own, so one clock times both sides. Latency is
 * reported, not asserted: `assert` only checks that the change arrived at all.
 */
export async function measureConvergence(
  from: Page,
  to: Page,
  change: () => Promise<void>,
): Promise<{ ms: number; notes: readonly StickySnapshot[] }> {
  const marker = await getNotes(from);
  const before = new Set(marker.map((note) => note.id));
  const started = Date.now();
  await change();
  await expect
    .poll(
      async () => {
        const notes = await getNotes(to);
        return notes.some((note) => !before.has(note.id));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the change never reached the other board' },
    )
    .toBe(true);
  return { ms: Date.now() - started, notes: await getNotes(to) };
}

/**
 * A DOM view of the board that is the same on every page: each note's own text
 * and paint, by id.
 *
 * Deliberately left out: selection and editing (one person's screen only), and
 * screen position, which depends on that person's camera. Positions are compared
 * separately through the board model, which is camera independent.
 */
export async function boardDomSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="sticky-note-"]'),
    );
    return cards
      .map((card) => {
        const id = card.getAttribute('data-testid') ?? '';
        const text = card.querySelector('[data-testid^="sticky-text-"]')?.textContent ?? '';
        const style = getComputedStyle(card);
        return `${id}|${text}|${style.backgroundColor}`;
      })
      .sort()
      .join('\n');
  });
}
