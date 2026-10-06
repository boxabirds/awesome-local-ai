/**
 * People on the same board, in browsers of their own.
 *
 * Each participant gets a browser *context* — its own cookies, storage and identity —
 * because that is what "two people" means to a browser: two tabs in one context share a
 * BroadcastChannel and would cheat past the room under test.
 *
 * The other thing that lives here is the measurement. Every wait for a change to show up
 * is timed, and the timing is written out (`writeLatencyReport`) rather than asserted:
 * the model, the browsers and the server all share one machine here, so a wall-clock
 * number is a thing to look at, not a thing to fail a build on. What *is* asserted is
 * that the change arrives at all, and that it arrives inside the generous functional
 * timeout.
 */

import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  CONNECTED_CONFIRMATION_MS,
  RECONNECT_MAX_BACKOFF_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  ROOM_SILENCE_LIMIT_MS,
} from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';
import { ensureBoard } from './boards';

export { LIVE_UPDATE_LATENCY_BUDGET_MS };

/** How long a change is given to show up in another person's browser. */
export const EVENTUAL_TIMEOUT_MS = E2E_EVENTUAL_TIMEOUT_MS;
/** How often a wait is checked, in milliseconds. Kept small so latency is honest. */
export const POLLING_MS = 25;
/** Where measured latencies are written, for `helpers/latency-report.ts` to print. */
export const LATENCY_DIR = 'test-results/latency';

/** One person, in a browser, on a board. */
export interface Participant {
  /** The name the test speaks of them by: 'Alex', 'Sam', … */
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Everything the browser complained about, in the order it complained. */
  readonly consoleErrors: string[];
}

/** The board's address in the test build's own words. */
export function boardAddress(boardId: string): string {
  return `/b/${boardId}`;
}

/** A board id for a test to open a room with. */
export function newBoard(): string {
  return newBoardId();
}

/** The connection badge, or nothing when the board is connected. */
export const badge = (page: Page): Locator => page.getByTestId('connection-status');

/**
 * What the badge says, or null when it is not on screen.
 *
 * This reads the DOM directly rather than through a locator. A locator waits for the element
 * to appear, and this function is called in a loop that expects the badge to *disappear* —
 * each round then leaves a call waiting for an element that is gone, and enough of those
 * hold up the calls that follow. Story 3 spent a long time chasing a "page that stops
 * reporting its own reconnection" that was only ever this.
 */
export function badgeText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="connection-status"]');
    return element?.textContent ?? null;
  });
}

/** The connection state the app itself is acting on, from the test hook. */
export function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = window.__vidi6?.connectionState;
    if (state === undefined)
      throw new Error('window.__vidi6.connectionState is missing from this build');
    return state;
  });
}

/**
 * Every connection state a page has been through, oldest first (story 3). Asked for after
 * the fact, because "it never said it was reconnecting" is a claim about the moments in
 * between two looks.
 */
export function connectionStates(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const states = window.__vidi6?.connectionStates;
    if (states === undefined)
      throw new Error('window.__vidi6.connectionStates is missing from this build');
    return states;
  });
}

/**
 * Opens a board and waits for it to be live: badge gone, board on screen, room reached.
 *
 * The board is made to exist first (see `helpers/boards.ts`): since story 5 an address the service
 * has never issued is a board it will not open, and every test here is a test about a board that a
 * person has a link to.
 *
 * The milliseconds are printed under `VIDI6_TRACE=1`, because FR-4 is a promise about how long this
 * takes and this is the one place every person in every test passes. What is timed is the page
 * arriving: the fetch that makes the board exist is a test's doing and is left out. What is printed
 * is a measurement, not an assertion — the assertion is that the board opened at all, and the place
 * a duration is asserted is TC-26, which makes its own board through the interface.
 *
 * The page's own clock is read with `page.evaluate` rather than a locator, which is the idiom every
 * measurement here uses: a locator call waits for an element to *appear*, so a locator in a loop
 * that is watching for elements to disappear leaves calls piled up holding up the ones behind it.
 */
export async function openBoardAt(page: Page, boardId: string, origin?: string): Promise<void> {
  await ensureBoard(boardId, origin);
  const started = Date.now();
  await page.goto(boardAddress(boardId));
  await expect(page.getByTestId('app')).toBeVisible();
  const painted = Date.now() - started;
  await waitForConnected(page);
  const live = Date.now() - started;
  // The page's own wall clock, read the same way `waitForConnected` reads its state: a locator call
  // waits for the element to appear, and this function is called in loops that expect things to be
  // gone, so a locator here would hold up the calls that follow it.
  const since = await page.evaluate(() => Math.round(performance.now()));
  if (process.env.VIDI6_TRACE) {
    console.info(
      `   open /b/${boardId}: painted ${painted}ms, live ${live}ms (the page says ${since}ms)`,
    );
  }
}

/**
 * Waits for the badge to go away, which is the board saying it is in the room, and then for the
 * board itself to say so: the badge can be gone because it was never painted.
 */
export async function waitForConnected(page: Page): Promise<void> {
  await expect(badge(page), 'waiting for the board to reach the room').toHaveCount(0, {
    timeout: EVENTUAL_TIMEOUT_MS,
  });
  expect(await connectionState(page)).toBe('connected');
}

/**
 * One person: a browser context of their own, with everything the browser complains about
 * collected on the way. Nothing is opened and nothing is waited for, which is what a test that
 * breaks the network before the page loads needs.
 *
 * `permissions` is there for the one case that needs the browser's permission asked for before the
 * page exists rather than after: a test that reads back what the board put on the clipboard. It
 * reaches only the browsers that have such a thing, and an empty list changes nothing.
 */
export async function openPersonPage(
  browser: Browser,
  name: string,
  permissions: readonly string[] = [],
): Promise<Participant> {
  const context = await browser.newContext(
    permissions.length > 0 ? { permissions: [...permissions] } : {},
  );
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  // `VIDI6_TRACE=1 npx playwright test …` puts what the board itself said into the test output.
  // The board logs every time it decides a connection attempt went nowhere or that a line has
  // stopped answering, which is most of what there is to know about a stubborn test.
  if (process.env.VIDI6_TRACE) {
    const born = Date.now();
    const line = (label: string, text: string) =>
      console.info(
        `   ${label} +${((Date.now() - born) / 1000).toFixed(1)}s ${text.slice(0, 300)}`,
      );
    page.on('console', (message) => line(name, message.text()));
    page.on('pageerror', (error) => line(`${name} pageerror`, error.message));
  }
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    consoleErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  return { name, context, page, consoleErrors };
}

/** One person, on a board, in the room. */
export async function openParticipant(
  browser: Browser,
  name: string,
  boardId: string,
): Promise<Participant> {
  const participant = await openPersonPage(browser, name);
  await openBoardAt(participant.page, boardId);
  return participant;
}

/** Several people on one board, all of them in the room before the test starts. */
export async function openParticipants(
  browser: Browser,
  names: readonly [string],
  boardId: string,
): Promise<[Participant]>;
export async function openParticipants(
  browser: Browser,
  names: readonly [string, string],
  boardId: string,
): Promise<[Participant, Participant]>;
export async function openParticipants(
  browser: Browser,
  names: readonly [string, string, string],
  boardId: string,
): Promise<[Participant, Participant, Participant]>;
export async function openParticipants(
  browser: Browser,
  names: readonly [string, string, string, string],
  boardId: string,
): Promise<[Participant, Participant, Participant, Participant]>;
export async function openParticipants(
  browser: Browser,
  names: readonly [string, string, string, string, string],
  boardId: string,
): Promise<[Participant, Participant, Participant, Participant, Participant]>;
export async function openParticipants(
  browser: Browser,
  names: readonly string[],
  boardId: string,
): Promise<Participant[]>;
export async function openParticipants(
  browser: Browser,
  names: readonly string[],
  boardId: string,
): Promise<Participant[]> {
  const people: Participant[] = [];
  for (const name of names) people.push(await openParticipant(browser, name, boardId));
  // Everyone in the same room, so everyone's board is the same board.
  await expectSameBoard(people, 'everyone agrees before anything happens');
  return people;
}

/** Closes every browser and checks nothing was left complaining. */
export async function closeParticipants(people: readonly Participant[]): Promise<void> {
  for (const person of people) await person.context.close();
}

/**
 * The board as one string: every note's id, place, stacking order, colour and text.
 * Two people looking at the same board must produce the same string.
 */
export function boardSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const notes = Array.from(document.querySelectorAll<HTMLElement>('.sticky-note')).map((el) => {
      // The text of a note somebody is typing into is in their text box: it mirrors the
      // shared text plus what they have typed, so it is the board as that browser holds it.
      const shown = el.querySelector<HTMLElement>('.sticky-text')?.textContent;
      const typing = el.querySelector<HTMLTextAreaElement>('.sticky-editor')?.value ?? '';
      const text = shown ?? typing;
      return [
        el.dataset['noteId'] ?? '',
        el.dataset['x'] ?? '',
        el.dataset['y'] ?? '',
        el.dataset['z'] ?? '',
        el.dataset['color'] ?? '',
        text,
      ].join('~');
    });
    // Order is part of the board (stacking), so it is compared as it comes; ids keep it
    // stable when two people's notes were created in the same tick.
    return notes.sort().join('|');
  });
}

/** The number of notes on a board. */
export function noteCount(page: Page): Promise<number> {
  return page.locator('.sticky-note').count();
}

/** The samples taken so far, in the order they were measured. */
const samples: number[] = [];

/** Everything measured so far, newest last. */
export function latencySamples(): readonly number[] {
  return samples;
}

/** Clears the measured samples, e.g. between tests in a file. */
export function resetLatencySamples(): void {
  samples.length = 0;
}

/** The percentiles of a set of durations, and the worst of them. */
export function percentiles(values: readonly number[]): { p50: number; p95: number; max: number } {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

/** The sentence the tests print: percentiles against the budget, and what it means. */
export function latencyReport(
  values: readonly number[],
  budget = LIVE_UPDATE_LATENCY_BUDGET_MS,
): string {
  const { p50, p95, max } = percentiles(values);
  const worst = max <= budget ? 'inside' : 'over';
  return (
    `latency over ${values.length} change(s): p50=${p50}ms p95=${p95}ms max=${max}ms ` +
    `(budget ${budget}ms — ${worst})`
  );
}

/**
 * Waits for something to become true in somebody's browser, and says how long it took.
 *
 * The wait is generous (E2E_EVENTUAL_TIMEOUT_MS) because the machine running this is not
 * a machine we can promise timing to; the *assertion* is that it happens, and the duration
 * goes into the report.
 */
export async function expectEventually(
  person: Participant,
  label: string,
  check: () => Promise<boolean> | boolean,
  options: { timeoutMs?: number; record?: boolean } = {},
): Promise<number> {
  const started = Date.now();
  await expect
    .poll(check, {
      timeout: options.timeoutMs ?? EVENTUAL_TIMEOUT_MS,
      intervals: [POLLING_MS],
      message: `${label} — waiting on ${person.name}`,
    })
    .toBe(true);
  const elapsed = Date.now() - started;
  if (options.record !== false) samples.push(elapsed);
  return elapsed;
}

/** A change was made by somebody; waits for everybody else to show it. */
export async function expectChangeToArrive(
  receivers: readonly Participant[],
  label: string,
  check: (person: Participant) => Promise<boolean> | boolean,
): Promise<number> {
  let slowest = 0;
  for (const person of receivers) {
    slowest = Math.max(slowest, await expectEventually(person, label, () => check(person)));
  }
  return slowest;
}

/** Everybody's board is the same board. */
export async function expectSameBoard(
  people: readonly Participant[],
  label: string,
  timeoutMs = EVENTUAL_TIMEOUT_MS,
): Promise<string> {
  await expect
    .poll(
      async () => {
        const snapshots = await Promise.all(people.map((person) => boardSnapshot(person.page)));
        return snapshots.every((snapshot) => snapshot === snapshots[0]) ? 'same' : 'different';
      },
      { timeout: timeoutMs, intervals: [POLLING_MS], message: `waiting for ${label}` },
    )
    .toBe('same');
  return boardSnapshot(people[0]?.page as Page);
}

/**
 * What a browser says out loud when it has no network: failed socket dials and the errors
 * behind them. A test that takes a browser offline causes these, and they are the test
 * working, not the board misbehaving — so the test that does it says so.
 */
export const OFFLINE_CONSOLE_NOISE =
  /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION_|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|WebSocket connection to|Unable to load WebSocket|net::ERR_/i;

/**
 * How long a browser is given to notice it has lost the board — and, on the way back, to
 * notice it has found it again.
 *
 * A board cannot know a line is gone until it goes long enough without an answer, and it
 * cannot know a network is back until an attempt gets through: both are bounded by the
 * board's own silence limit (`ROOM_SILENCE_LIMIT_MS`, checked once a second) plus the
 * reconnect backoff, plus room for a slow machine and for the browser's own stack to notice.
 * Longer than that and it did not notice at all.
 */
export const OFFLINE_DETECTION_TIMEOUT_MS =
  ROOM_SILENCE_LIMIT_MS + RECONNECT_MAX_BACKOFF_MS + 20_000;

/** Nothing in any of these browsers complained. */
export function expectNoConsoleErrors(
  people: readonly Participant[],
  allow: readonly RegExp[] = [],
): void {
  for (const person of people) {
    const complaints = person.consoleErrors.filter(
      (message) => !allow.some((pattern) => pattern.test(message)),
    );
    expect(
      complaints,
      `${person.name}'s browser reported problems: ${complaints.join(' | ')}`,
    ).toEqual([]);
  }
}

/**
 * Can this browser reach the server at all? A test that pretends a network is down needs to
 * know its own premise is true, and a browser that is offline says so here long before the
 * board's own keepalive notices anything.
 */
export async function canReachServer(page: Page): Promise<boolean> {
  // The page itself, not a room address: `/api/rooms/...` answers 426 to a plain fetch, which
  // the browser logs as a failed load — a test that asks "can this browser reach the server"
  // should not go and make an error for the browser to complain about.
  return page
    .evaluate(() =>
      fetch(`/?reachability-check=${Date.now()}`, { cache: 'no-store' })
        .then((response) => response.status)
        .catch(() => 0),
    )
    .then((status) => status !== 0);
}

/** Writes what was measured, for the report printed at the end of the run. */
export async function writeLatencyReport(testInfo: TestInfo, title = 'latency'): Promise<void> {
  if (samples.length === 0) return;
  const file = join(LATENCY_DIR, `${safeName(testInfo.title)}-${title}.log`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${latencyReport(samples)}\n${samples.join('\n')}\n`, 'utf8');
  // Also on the test's own output, so a failure explains itself without opening a file.
  console.info(latencyReport(samples));
  // The next test in this worker measures its own changes, not this one's leftovers.
  samples.length = 0;
}

/** A file name a title can be turned into. */
function safeName(title: string): string {
  return title.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60);
}

/** Takes the report out of the test's own output and prints it for whoever is watching. */
export function logLatency(testInfo: TestInfo, values: readonly number[]): void {
  const report = latencyReport(values);
  testInfo.annotations.push({ type: 'latency', description: report });
  console.info(report);
}

/** Ends text editing in a browser, so the committed text is on screen to be compared. */
export async function stopEditing(page: Page): Promise<void> {
  const editor = page.locator('.sticky-editor');
  if ((await editor.count()) > 0) await page.keyboard.press('Escape');
  await expect(editor, 'waiting for the editor to close').toHaveCount(0, {
    timeout: EVENTUAL_TIMEOUT_MS,
  });
}

/** The confirmation window the badge uses, exported so a test can quote it. */
export const CONFIRMATION_MS = CONNECTED_CONFIRMATION_MS;
