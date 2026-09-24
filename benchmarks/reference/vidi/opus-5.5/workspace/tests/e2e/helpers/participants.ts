import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { initializeBoard } from './seed';

/** Poll often: the latency budget is what is under test, not the polling interval. */
const POLL_INTERVALS_MS = [10];
/** Joining (page load + first sync) is not a live update; it gets a generous budget. */
const JOIN_TIMEOUT_MS = 15_000;

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught page errors seen so far. */
  errors: string[];
  /** Dialogs (alert/confirm) the page tried to open. */
  dialogs: string[];
}

export function boardUrl(boardId: string): string {
  return `/b/${boardId}`;
}

export function connectionBadge(page: Page) {
  return page.getByRole('status', { name: 'Connection status' });
}

export async function connectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__vidi6?.connectionState);
}

/** Waits until the page has synced with its room (badge hidden). */
export async function waitConnected(page: Page, timeout = JOIN_TIMEOUT_MS): Promise<void> {
  await expect.poll(() => connectionState(page), { timeout }).toBe('connected');
  await expect(connectionBadge(page)).toHaveCount(0);
}

/**
 * Opens `names.length` isolated browser contexts (separate people) on the same board and
 * waits for each to be connected.
 */
export async function openParticipants(
  browser: Browser,
  names: readonly string[],
  boardId: string = newBoardId(),
): Promise<Participant[]> {
  const { baseURL, viewport } = test.info().project.use;
  if (!baseURL) throw new Error('baseURL is not configured');
  await initializeBoard(baseURL, boardId);
  return Promise.all(
    names.map(async (name) => {
      const context = await browser.newContext({ baseURL, viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      const dialogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await page.goto(boardUrl(boardId));
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      await waitConnected(page);
      return { name, context, page, errors, dialogs };
    }),
  );
}

export async function closeParticipants(participants: readonly Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

/** Asserts that `read()` reaches `expected` within LIVE_UPDATE_LATENCY_BUDGET_MS. */
export function expectWithin<T>(read: () => Promise<T>, message?: string) {
  return expect.poll(read, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, intervals: POLL_INTERVALS_MS, message });
}

export interface RenderedNote {
  id: string;
  transform: string;
  color: string;
  text: string;
}

/** Every note as drawn on this screen (DOM), sorted by id. */
export async function renderedNotes(page: Page): Promise<RenderedNote[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="group"][aria-label="Sticky note"]'))
      .map((el) => ({
        id: el.dataset.id ?? '',
        transform: el.style.transform,
        color: el.dataset.color ?? '',
        text: el.querySelector('[data-testid="sticky-text"]')?.textContent ?? '',
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** One note as drawn on this screen, or undefined when it is not there. */
export async function renderedNote(page: Page, id: string): Promise<RenderedNote | undefined> {
  return (await renderedNotes(page)).find((n) => n.id === id);
}

/** The id of the note being edited on this page (a new note opens in edit mode). */
export async function editingNoteId(page: Page): Promise<string> {
  const id = await page.locator('[role="group"][data-editing="true"]').getAttribute('data-id');
  if (!id) throw new Error('no note is being edited');
  return id;
}
