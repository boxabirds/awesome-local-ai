/**
 * Live collaboration helpers (story 3, design task 3.8).
 *
 * A "session" is several isolated browser contexts on the same `/b/<boardId>`:
 * separate storage, separate page, separate `Y.Doc`, one room between them.
 *
 * `deliver` is the measuring wrapper every live assertion uses: stamp, make the
 * change on one page, poll the other pages until it is in their DOM, and log how
 * long that took against `LIVE_UPDATE_LATENCY_BUDGET_MS`. The budget is
 * **reported, never asserted** — the model, the browsers and the server all
 * share this machine, so wall-clock timing there is not a pass/fail signal.
 * Functional assertions keep their own timeout (`E2E_EVENTUAL_TIMEOUT_MS`),
 * which is what makes a missing change fail.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../../src/shared/config';
import { settle } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** `console.error` output and uncaught exceptions this page produced. */
  errors: string[];
}

export interface BoardSession {
  boardId: string;
  participants: Participant[];
}

export interface NoteRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  z: number;
  text: string;
  selected: boolean;
  editing: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ConnectionAttempt {
  url: string;
  at: number;
}

/** localStorage key holding the connection attempts a page has made. */
const ATTEMPTS_KEY = 'vidi6-test-websocket-attempts';

/** The story 3 part of the test-only window hook (story 1 adds the camera). */
interface LiveTestApi {
  connectionState?: string;
  connectionLog?: { state: string; at: number }[];
}

type WindowWithLiveHook = Window & { __vidi6?: LiveTestApi };

function installConnectionLog(): void {
  // Runs before the app, so the provider picks up the instrumented constructor.
  // Attempts are kept in localStorage: they survive a navigation, which is how
  // a teardown can be checked for reconnect attempts afterwards. Playwright
  // serialises this function on its own, so it must not close over anything.
  const attemptsKey = 'vidi6-test-websocket-attempts';
  const RealWebSocket = window.WebSocket;
  (window as unknown as { WebSocket: unknown }).WebSocket = function InstrumentedWebSocket(
    url: string,
    protocols?: string | string[],
  ) {
    if (url.includes('/api/rooms/')) {
      const attempts: { url: string; at: number }[] = JSON.parse(
        localStorage.getItem(attemptsKey) ?? '[]',
      );
      attempts.push({ url, at: Date.now() });
      localStorage.setItem(attemptsKey, JSON.stringify(attempts));
    }
    return new RealWebSocket(url, protocols);
  } as unknown as typeof WebSocket;
}

export async function openParticipant(
  browser: Browser,
  name: string,
  path: string,
): Promise<Participant> {
  const context = await browser.newContext();
  await context.addInitScript(installConnectionLog);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (process.env.VIDI6_E2E_DEBUG) {
      console.log(`[${name}] ${message.type()}: ${message.text()}`);
    }
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (process.env.VIDI6_E2E_DEBUG) {
      console.log(`[${name}] pageerror: ${String(error)}`);
    }
    errors.push(String(error));
  });
  page.on('crash', () => {
    errors.push('page crashed');
  });
  await page.goto(path);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  return { name, context, page, errors };
}

function boardIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  if (!pathname.startsWith('/b/')) {
    throw new Error(`expected the page to be on a board address, got ${pathname}`);
  }
  return pathname.slice('/b/'.length);
}

/**
 * Open one board in several isolated contexts. The first page arrives at `/` and
 * keeps the board the app created for it; the others are sent to that address.
 */
export async function openBoardTogether(
  browser: Browser,
  names: readonly string[],
): Promise<BoardSession> {
  if (names.length < 2) {
    throw new Error('a live session needs at least two participants');
  }
  const leaderName = names[0];
  if (leaderName === undefined) {
    throw new Error('a live session needs a first participant');
  }
  const leader = await openParticipant(browser, leaderName, '/');
  const boardId = boardIdFromUrl(leader.page.url());
  const participants = [leader];
  for (const name of names.slice(1)) {
    participants.push(await openParticipant(browser, name, `/b/${boardId}`));
  }
  await Promise.all(participants.map((participant) => waitForConnected(participant)));
  return { boardId, participants };
}

/** A participant by position, for tests that name their participants. */
export function person(session: BoardSession, index: number): Participant {
  const participant = session.participants[index];
  if (participant === undefined) {
    throw new Error(`this session has no participant at index ${index}`);
  }
  return participant;
}

export async function closeSession(session: BoardSession): Promise<void> {
  for (const participant of session.participants) {
    await participant.context.close();
  }
}

// -- connection state ---------------------------------------------------------

export async function waitForConnected(participant: Participant): Promise<void> {
  await expect
    .poll(
      async () => await connectionState(participant.page),
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `${participant.name} never reached the connected state`,
      },
    )
    .toBe('connected');
}

export function connectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as WindowWithLiveHook).__vidi6?.connectionState);
}

/** Every state this page's connection has been through, oldest first. */
export function connectionLog(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as WindowWithLiveHook).__vidi6?.connectionLog?.map((entry) => entry.state) ?? [],
  );
}

/** The badge text, or null when the badge is not on the screen. */
export async function badgeText(page: Page): Promise<string | null> {
  const badge = page.getByTestId('connection-status');
  if ((await badge.count()) === 0) {
    return null;
  }
  return (await badge.textContent()) ?? '';
}

/** Room connections this page attempted; survives a navigation in the same context. */
export function connectionAttempts(page: Page): Promise<ConnectionAttempt[]> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as ConnectionAttempt[],
    ATTEMPTS_KEY,
  );
}

// -- latency ------------------------------------------------------------------

const latencyLog: { label: string; ms: number; overBudget: boolean }[] = [];

function report(label: string, ms: number): void {
  const overBudget = ms > LIVE_UPDATE_LATENCY_BUDGET_MS;
  latencyLog.push({ label, ms, overBudget });
  console.log(
    `[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms` +
      `${overBudget ? ', over budget — reported not asserted' : ''})`,
  );
}

/**
 * Make a change on one page and wait for it to appear where it should.
 * Returns the measured sender-to-receiver time, which is logged, not asserted.
 */
export async function deliver(
  label: string,
  edit: () => Promise<void>,
  appears: () => Promise<boolean>,
): Promise<number> {
  const startedAt = Date.now();
  await edit();
  await expect
    .poll(appears, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `${label}: the change never appeared` })
    .toBe(true);
  const ms = Date.now() - startedAt;
  report(label, ms);
  return ms;
}

/**
 * Wait for a change that has already been made, and log how long it took to
 * arrive. This is `deliver` without the edit, for changes made in parallel
 * (TC-24) or over several pages.
 */
export async function measureUntil(
  label: string,
  startedAt: number,
  appears: () => Promise<boolean>,
): Promise<number> {
  await expect
    .poll(appears, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `${label}: it never happened` })
    .toBe(true);
  const ms = Date.now() - startedAt;
  report(label, ms);
  return ms;
}

/** Print p50/p95/max for everything measured so far, and clear the log. */
export function printLatencySummary(title: string): void {
  if (latencyLog.length === 0) {
    console.log(`[latency] ${title}: no changes measured`);
    return;
  }
  const durations = latencyLog.map((entry) => entry.ms).sort((a, b) => a - b);
  const quantile = (q: number): number =>
    durations[Math.min(durations.length - 1, Math.floor(q * durations.length))] ?? 0;
  const over = latencyLog.filter((entry) => entry.overBudget).length;
  console.log(
    `[latency] ${title}: ${durations.length} changes, p50=${quantile(0.5)}ms ` +
      `p95=${quantile(0.95)}ms max=${durations[durations.length - 1]}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ${over} over — reported not asserted)`,
  );
  latencyLog.length = 0;
}

export function expectNoConsoleErrors(...participants: Participant[]): void {
  for (const participant of participants) {
    expect(
      participant.errors,
      `${participant.name} logged console errors: ${participant.errors.join('\n')}`,
    ).toEqual([]);
  }
}

// -- the board as a browser sees it ------------------------------------------

export function boardSnapshot(page: Page): Promise<NoteRecord[]> {
  return page.evaluate(() => {
    const notes = [...document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')];
    return notes.map((note) => {
      const rect = note.getBoundingClientRect();
      const text = note.querySelector<HTMLElement>('[data-testid="sticky-text"]');
      return {
        id: note.getAttribute('data-note-id') ?? '',
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        color: note.getAttribute('data-color') ?? '',
        z: Number(note.getAttribute('data-z') ?? '0'),
        text: text?.textContent ?? '',
        selected: note.getAttribute('data-selected') === 'true',
        editing: note.getAttribute('data-editing') === 'true',
      };
    });
  });
}

/**
 * The board as shared data, ready to compare between pages. Selection and
 * editing are each page's own business (TC-28), so they are left out: two
 * people on one board hold the same notes in the same places, while which note
 * each of them has clicked is nobody else's screen.
 */
export async function snapshotJson(page: Page): Promise<string> {
  const notes = await boardSnapshot(page);
  return JSON.stringify(
    notes.map(({ id, x, y, width, height, color, z, text }) => ({ id, x, y, width, height, color, z, text })),
  );
}

export async function noteCount(page: Page): Promise<number> {
  return page.getByTestId('sticky-note').count();
}

export function noteLocator(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note"][data-note-id=${JSON.stringify(id)}]`);
}

export async function hasNote(page: Page, id: string): Promise<boolean> {
  return (await noteLocator(page, id).count()) > 0;
}

export async function noteText(page: Page, id: string): Promise<string | null> {
  const locator = noteLocator(page, id).locator('[data-testid="sticky-text"]');
  if ((await locator.count()) === 0) {
    return null;
  }
  return (await locator.first().textContent()) ?? '';
}

export async function notePosition(page: Page, id: string): Promise<ScreenPoint | null> {
  const box = await noteLocator(page, id).boundingBox();
  return box === null ? null : { x: box.x, y: box.y };
}

export async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')].map(
      (note) => note.getAttribute('data-note-id') ?? '',
    ),
  );
}

/** All participants hold the same board, as far as their DOMs are concerned. */
export async function boardsAgree(...participants: Participant[]): Promise<boolean> {
  const snapshots = await Promise.all(participants.map((participant) => snapshotJson(participant.page)));
  return snapshots.every((snapshot) => snapshot === snapshots[0]);
}

// -- editing through the real UI ---------------------------------------------

/** Create a note where the pointer double-clicks; returns its id, editor closed. */
export async function createNote(page: Page, at: ScreenPoint): Promise<string> {
  // The board's DOM is in paint order, which drags and selections rearrange,
  // so the new note is found by what appeared, not by where it sits.
  const before = new Set(await noteIds(page));
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
  const added = (await noteIds(page)).filter((id) => !before.has(id));
  const created = added[added.length - 1];
  if (created === undefined) {
    throw new Error('the new note never appeared');
  }
  await page.keyboard.press('Escape');
  await settle(page);
  return created;
}

/** Click a note without dragging it, so it becomes selected. */
export async function selectNote(page: Page, id: string): Promise<void> {
  const centre = await noteCentre(page, id);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
}

async function noteCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await noteLocator(page, id).boundingBox();
  if (box === null) {
    throw new Error(`note ${id} is not on the screen`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function dragNoteTo(page: Page, id: string, to: ScreenPoint): Promise<void> {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await settle(page);
  await page.mouse.up();
  await settle(page);
}

/**
 * Drag a note by a screen offset. The pointer grabs the note's centre, and the
 * centre is what moves by (dx, dy), so the note ends up exactly that far from
 * where it was.
 */
export async function moveNoteBy(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const centre = await noteCentre(page, id);
  await dragNoteTo(page, id, { x: centre.x + dx, y: centre.y + dy });
}

/** Open a note's editor (double click) and return its textarea. */
export async function openEditor(page: Page, id: string): Promise<Locator> {
  const centre = await noteCentre(page, id);
  await page.mouse.dblclick(centre.x, centre.y);
  await settle(page);
  const editor = page.getByTestId('sticky-textarea');
  try {
    await expect(editor).toBeVisible();
  } catch (error) {
    // Say what the page actually looked like at the moment the editor did not open.
    console.log(`[openEditor] ${await describeNoteAt(page, id, centre)}`);
    throw error;
  }
  return editor;
}

/** The state of a note and what is on top of it, for a failing interaction. */
export function describeNoteAt(page: Page, id: string, at: ScreenPoint): Promise<string> {
  return page.evaluate(
    ([noteId, x, y]) => {
      const el = document.querySelector<HTMLElement>(`[data-note-id=${JSON.stringify(noteId)}]`);
      if (el === null) {
        return `note ${noteId} is not on the page`;
      }
      const rect = el.getBoundingClientRect();
      const chain: string[] = [];
      let node: Element | null = document.elementFromPoint(x, y);
      for (let depth = 0; node !== null && depth < 5; depth += 1) {
        chain.push(
          `${node.tagName.toLowerCase()}${node.getAttribute('data-testid') ? `[${node.getAttribute('data-testid')}]` : ''}`,
        );
        node = node.parentElement;
      }
      return (
        `note ${noteId} box ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)} ` +
        `selected=${el.getAttribute('data-selected')} editing=${el.getAttribute('data-editing')} ` +
        `clickable=${el.getAttribute('aria-disabled') ?? '-'} at ${Math.round(x)},${Math.round(y)} chain=${chain.join('<')}`
      );
    },
    [id, at.x, at.y] as const,
  );
}

export async function editorCount(page: Page): Promise<number> {
  return page.getByTestId('sticky-textarea').count();
}

/** Type into a note through its editor, then close the editor. */
export async function typeIntoNote(page: Page, id: string, text: string): Promise<void> {
  const editor = await openEditor(page, id);
  await editor.pressSequentially(text);
  await page.keyboard.press('Escape');
  await settle(page);
}

export async function recolourNote(page: Page, id: string, color: string): Promise<void> {
  await selectNote(page, id);
  await page.getByTestId(`swatch-${color}`).click();
  await settle(page);
}

export async function deleteNote(page: Page, id: string): Promise<void> {
  await selectNote(page, id);
  await page.getByTestId('delete-note').click();
  await settle(page);
}

// -- outage simulation --------------------------------------------------------

/**
 * Cut a participant's network. The wait for "Reconnecting…" is itself the
 * proof that the connection really dropped, so an outage that silently kept the
 * socket alive fails here instead of quietly testing nothing.
 */
/**
 * Cut a participant's network and wait until the page itself admits the loss.
 *
 * A page only notices a silent connection after y-websocket's message timeout,
 * so the outage is held open until it does — never for less than
 * CATCH_UP_TEST_OUTAGE_MS. The time the cut started is returned so the test can
 * say how long the outage really was.
 */
export async function goOffline(participant: Participant): Promise<number> {
  const startedAt = Date.now();
  await participant.context.setOffline(true);
  await expect
    .poll(
      async () => (await connectionLog(participant.page)).includes('reconnecting'),
      {
        timeout: CATCH_UP_TEST_OUTAGE_MS + 45_000,
        message: `${participant.name} never reported a lost connection`,
      },
    )
    .toBe(true);
  return startedAt;
}

export async function goOnline(participant: Participant): Promise<void> {
  await participant.context.setOffline(false);
}

/** How long an outage is held open in the catch-up test (`CATCH_UP_TEST_OUTAGE_MS`). */
export const OUTAGE_MS = CATCH_UP_TEST_OUTAGE_MS;

/**
 * Leave the board without leaving the origin, then check that nothing reconnects.
 *
 * Closing the editor and the page is where `connectBoard`'s `destroy()` runs.
 * `/api/rooms/teardown` is answered by the Worker with a plain 400 and never
 * loads the app, so the page stops being a board while keeping its origin — and
 * with it the localStorage record of connection attempts. A page that keeps
 * dialing the room after that has a provider that was never shut down.
 */
export async function assertQuietAfterLeavingBoard(participant: Participant): Promise<void> {
  const before = await connectionAttempts(participant.page);
  expect(before.length, `${participant.name} never opened a room connection`).toBeGreaterThan(0);
  await participant.page.goto(new URL('/api/rooms/teardown', participant.page.url()).href);
  // Longer than the reconnect backoff can be, so a surviving provider would
  // have had time to dial again.
  await participant.page.waitForTimeout(RECONNECT_MAX_BACKOFF_MS + 2_000);
  const after = await connectionAttempts(participant.page);
  expect(
    after.map((attempt) => attempt.url),
    `${participant.name} kept reconnecting after leaving the board`,
  ).toEqual(before.map((attempt) => attempt.url));
}
