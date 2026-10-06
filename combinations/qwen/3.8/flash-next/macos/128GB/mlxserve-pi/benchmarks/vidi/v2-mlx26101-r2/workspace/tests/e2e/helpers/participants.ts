import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { newBoardId } from '../../../src/shared/board-id.js';
import type { StickySnapshot } from '../../../src/shared/board-model.js';
import type { ConnectionState } from '../../../src/client/sync/connectBoard.js';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config.js';
import { waitForRender, zoomLabel } from './board.js';
import { docNotes, notes } from './sticky.js';

/**
 * Several participants on one board (design "E2E workflows"): one browser
 * *context* per person, each with its own cookies, its own storage and - what
 * matters here - its own WebSocket to the room. Two pages in one context would
 * share a browser process and could quietly help each other along; separate
 * contexts is what makes "Alex's change appears for Sam" a real test of the
 * room rather than of the browser.
 */
export interface Participant {
  /** What the test calls this person (the PRD uses Alex and Sam). */
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors that are not the transport itself failing. */
  consoleErrors: string[];
  /** `console.error`s about the WebSocket, kept apart: an outage test expects them. */
  transportErrors: string[];
  /** Any `alert`/`confirm` the page raised: the board must never raise one. */
  dialogs: string[];
}

/** The address of a brand-new board. Ids come from `newBoardId()`, never typed in. */
export const newBoardUrl = (): string => `/b/${newBoardId()}`;

/** A WebSocket failure message, as opposed to an application error. */
const isTransportNoise = (text: string): boolean =>
  /websocket|ws:\/\/|wss:\/\/|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_NETWORK_CHANGED|socket hang up|closed/iu.test(
    text,
  );

/** What a page must reach before the test is handed it. */
export interface OpenOptions {
  /**
   * `'connected'` is the usual: the page is in step with its room. `'load_failed'` is
   * for a page opened onto a board the room cannot open, which is the one case where
   * waiting for a connection is waiting for something that will never happen.
   *
   * The default is not a convenience. A test that opens a page onto a broken board and
   * waits for it to connect times out reporting a page that never connected, when what
   * it meant to establish is that the board could not be loaded; and a test that only
   * waits for *a* badge accepts any badge - "Connecting…" among them, which a page
   * shows on its way to every outcome, good and bad.
   */
  expect?: ConnectionState;
}

/** Open one context and page per name, all on the same board, all in step. */
export async function openParticipants(
  browser: Browser,
  names: string[],
  url = newBoardUrl(),
  options: OpenOptions = {},
): Promise<Participant[]> {
  const waitingFor = options.expect ?? 'connected';
  const people: Participant[] = [];
  for (const name of names) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const person: Participant = {
      name,
      context,
      page,
      consoleErrors: [],
      transportErrors: [],
      dialogs: [],
    };
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (isTransportNoise(text)) person.transportErrors.push(text);
      else person.consoleErrors.push(text);
    });
    page.on('pageerror', (error) => person.consoleErrors.push(String(error)));
    page.on('dialog', async (dialog) => {
      person.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
    await page.goto(url);
    // The board is up, drawn, and this person is in step with the room.
    await expect(zoomLabel(person.page)).toHaveText('100%');
    await waitForRender(person.page);
    if (waitingFor === 'load_failed') await waitForLoadFailure(person);
    else await waitForConnected(person);
    people.push(person);
  }
  return people;
}

/** Close every context a test opened. */
export async function closeParticipants(people: Participant[]): Promise<void> {
  for (const person of people) await person.context.close();
}

export const badge = (page: Page): Locator => page.getByTestId('connection-status');

/** The badge's text, or null when there is no badge (the usual healthy state). */
export async function badgeText(page: Page): Promise<string | null> {
  const element = badge(page);
  if ((await element.count()) === 0) return null;
  return await element.textContent();
}

/** The connection state the app reports (test build only). */
export async function connectionState(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__vidi6?.connectionState ?? null);
}

/**
 * Wait until this page has been told its board could not be loaded.
 *
 * This is a state the page cannot get to by itself: the room has to say so. Every
 * other bad connection is the page's own guess - it has a socket and then it does not
 * - whereas this one is an answer from the room, which is why the badge can be red
 * instead of amber and why the board is locked. A page that has never reached the room
 * and a page the room refused look the same in the DOM until this state arrives, and
 * only one of them is refusing edits.
 */
export async function waitForLoadFailure(person: Participant): Promise<void> {
  await expect
    .poll(() => connectionState(person.page), {
      message: `${person.name} was never told the board could not be loaded`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('load_failed');
  await expect(badge(person.page)).toBeVisible();
}

/** Wait until this person's page is in step with the room: no badge at all. */
export async function waitForConnected(person: Participant): Promise<void> {
  await expect
    .poll(() => connectionState(person.page), {
      message: `${person.name} never reached the room`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('connected');
  await expect(badge(person.page)).toHaveCount(0);
}

/**
 * The board as one canonical string: every note's content and place, sorted by
 * id so that the comparison is about the board and not about the order the
 * notes happen to be listed in.
 */
export async function boardSnapshot(page: Page): Promise<string> {
  const all: StickySnapshot[] = await docNotes(page);
  return JSON.stringify(
    [...all]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((note) => [
        note.id,
        Math.round(note.x * 1000) / 1000,
        Math.round(note.y * 1000) / 1000,
        note.z,
        note.color,
        note.text,
      ]),
  );
}

/** The notes as the DOM lists them, by id: the order they are actually in. */
export async function domNoteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="sticky-note"][data-note-id]', (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.noteId ?? ''),
  );
}

/** How many different boards these pages hold: 1 once they agree. */
const distinctBoards = async (people: Participant[]): Promise<number> =>
  new Set(await Promise.all(people.map((person) => boardSnapshot(person.page)))).size;

/**
 * Wait until every participant holds exactly the same board, and assert it:
 * the documents agree, the DOM has the same notes in the same order, and nobody
 * is left with an error dialog.
 */
export async function expectSameBoard(people: Participant[]): Promise<void> {
  await expect
    .poll(() => distinctBoards(people), {
      message: `boards did not converge: ${(await Promise.all(people.map((p) => boardSnapshot(p.page)))).join('\nvs\n')}`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(1);
  const domOrder = (page: Page): Promise<string> => domNoteIds(page).then((ids) => ids.join(','));
  const orders = await Promise.all(people.map((person) => domOrder(person.page)));
  const first = orders[0] ?? '';
  for (const person of people) {
    expect(await domOrder(person.page), `${person.name} DOM order`).toBe(first);
    expect(await badgeText(person.page), `${person.name} badge`).not.toBe('Reconnecting…');
  }
}

/** True once every participant's page is in step with the room again. */
export async function everyoneConnected(people: Participant[]): Promise<boolean> {
  for (const person of people) {
    if ((await connectionState(person.page)) !== 'connected') return false;
  }
  return true;
}

/**
 * Do `action`, then time how long the change takes to show up where it is
 * supposed to. The clock starts when the input is over - Playwright's own mouse
 * emulation is slow, and the thing worth knowing is how long the room took, not
 * how long the gesture took. Latency is printed, never asserted (design "Not
 * covered").
 */
export async function measureChange(
  label: string,
  action: () => Promise<void>,
  settled: () => Promise<boolean>,
): Promise<number> {
  await action();
  const started = Date.now();
  await expect
    .poll(settled, { message: `${label} did not arrive`, timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
  const elapsed = Date.now() - started;
  logLatency(label, elapsed);
  return elapsed;
}

/**
 * One line of the latency report. `update` measurements are compared with the
 * budget the design names; anything else (a reconnect, a two-person exchange) is
 * only reported, because the budget is about a change arriving, not about a
 * connection being rebuilt. Nothing here is ever asserted.
 */
export function logLatency(label: string, ms: number, kind: 'update' | 'other' = 'update'): void {
  if (kind === 'update') {
    const verdict = ms > LIVE_UPDATE_LATENCY_BUDGET_MS
      ? `over the ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms budget (reported, not asserted)`
      : `within the ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms budget`;
    console.log(`[latency] ${label}: ${ms} ms (${verdict})`);
    return;
  }
  console.log(`[latency] ${label}: ${ms} ms (not an update, no budget)`);
}

/** The percentile of a list of measured latencies (nearest-rank). */
export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

/** The whole latency report, printed at the end of a test. */
export function printLatencyReport(label: string, values: number[]): void {
  if (values.length === 0) {
    console.log(`[latency] ${label}: nothing measured`);
    return;
  }
  const max = Math.max(...values);
  console.log(
    `[latency] ${label}: n=${values.length} p50=${percentile(values, 0.5)}ms ` +
      `p95=${percentile(values, 0.95)}ms max=${max}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms; reported, not asserted)`,
  );
}

/** The note count on a page, from its document. */
export const noteCountOf = async (person: Participant): Promise<number> =>
  (await docNotes(person.page)).length;

/** Assert a page shows exactly this many notes, in its DOM and in its document. */
export async function expectNoteCount(page: Page, count: number): Promise<void> {
  await expect(notes(page)).toHaveCount(count, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect.poll(() => docNotes(page).then((n) => n.length)).toBe(count);
}

/** A person looked up by name, for tests that read better that way. */
export function person(people: Participant[], name: string): Participant {
  const found = people.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no participant called ${name}`);
  return found;
}

/**
 * Count the sockets this page opens against its room from now on. Playwright
 * reports a WebSocket connection separately from ordinary requests, so this is
 * the reliable signal: a reconnect is another socket to `/api/rooms/...`, and a
 * soak that never reconnects opens none.
 */
export function watchConnections(person: Participant): { since(): number } {
  let count = 0;
  person.page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname.startsWith('/api/rooms/')) count += 1;
  });
  return { since: () => count };
}
