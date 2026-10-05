/**
 * Helpers for the story 3 e2e tests: several people in the same board, in browsers
 * that share nothing.
 *
 * A "participant" is one isolated browser context — its own storage, its own sockets,
 * its own copy of the document — opened on the same board address. Isolation matters:
 * two tabs in one context could in principle talk to each other through
 * `BroadcastChannel` and look like a working server while the server does nothing, so
 * the connection under test is switched off across tabs (`disableBc`) and every
 * participant is a separate context.
 *
 * The second thing this file does is timing. A change is made on one page and has to
 * appear on another, and the honest measurement of that is wall-clock on a machine that
 * is running the browser, the model and the server at once. So the waits here are
 * functional — up to E2E_EVENTUAL_TIMEOUT_MS for the outcome to show — and the elapsed
 * time is written into a report next to LIVE_UPDATE_LATENCY_BUDGET_MS instead of being
 * used as a failure. See NOTES.md.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_WAIT_MS,
} from '../../../src/shared/config';

// Tests that wait for a board to come back after a cut ask this helper for its patience,
// so the number lives with the other settings and is said here once.
export { RECONNECT_WAIT_MS };
import type { StickySnapshot } from '../../../src/shared/board-model';
import { openBoard } from './board';
import type { Point } from './board';
import { setCamera, settled } from './board';
import { actualCentre, dragNote, editor, noteAt, noteBox, notes, stickies } from './sticky';

/** The people a test can put on a board. Five, which is MAX_CONCURRENT_EDITORS. */
const NAMES = ['Alex', 'Sam', 'Riley', 'Jamie', 'Quinn'];

/** How often `expectEventually` looks, in ms. It is also the resolution of a latency. */
const POLL_INTERVAL_MS = 25;

export interface Participant {
  /** What the test calls this person; also what the latency report says. */
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly boardId: string;
  /** Everything this page's console said that was an error, as text. */
  readonly errors: string[];
}

export interface BoardSnapshot {
  /** The notes as this page's document holds them, in stacking order. */
  readonly notes: readonly StickySnapshot[];
  /** The notes as this page paints them. */
  readonly painted: readonly PaintedNote[];
}

/** What a page paints for one note. Local-only state is deliberately absent. */
export interface PaintedNote {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  text: string;
}

/**
 * Opens `count` participants on one board nobody has used before, and waits until every
 * one of them is live. Called at the start of a test; the ids are fresh, so boards from
 * an earlier test — or an earlier run against the same server — cannot bleed into this
 * one, which is what makes an "isolation" assertion mean something.
 */
export async function openParticipants(browser: Browser, count: number): Promise<Participant[]> {
  const boardId = newBoardId();
  const opened = await Promise.all(
    Array.from({ length: count }, async (_unused, index) =>
      openParticipant(browser, boardId, nameFor(index)),
    ),
  );
  // Everybody has to have agreed with the room before anybody's change is timed,
  // otherwise the first measurement would include a board that was still loading.
  await Promise.all(opened.map((participant) => waitForLive(participant)));
  return opened;
}

export function nameFor(index: number): string {
  return NAMES[index] ?? `Guest ${index + 1}`;
}

/** One participant on a board of the caller's choosing. */
export async function openParticipant(
  browser: Browser,
  boardId: string,
  name = nameFor(0),
): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(String(error));
  });
  await openBoard(page, boardId);
  return { name, context, page, boardId, errors };
}

export async function closeParticipants(participants: readonly Participant[]): Promise<void> {
  await Promise.all(participants.map((participant) => participant.context.close()));
}

/** A board address nobody has opened: a room the server has never seen. */
export function newBoardAddress(): string {
  return newBoardId();
}

/** Cuts a participant's network off, or brings it back. */
/**
 * Cut a participant off from the board, or bring them back.
 *
 * `context.setOffline` on its own is not an outage: it stops a page making new network
 * connections and leaves a connection that is already open exactly as it was, so a board
 * with a live socket would carry on as though nothing had happened. The page is therefore
 * first told to stop answering the network, and then its own connection is closed — which
 * is what a socket dying on its own looks like to the board. From there everything is the
 * product's own behaviour: the badge says what it means, the document goes on accepting
 * edits, and while the page is offline every retry it makes is turned back.
 */
export async function goOffline(participant: Participant, offline = true): Promise<void> {
  await participant.context.setOffline(offline);
  if (!offline) return;

  const dropped = await participant.page.evaluate(() => window.__vidi6?.dropConnection() ?? false);
  if (!dropped) {
    throw new Error(`${participant.name} had no open connection to cut; the outage would go unnoticed`);
  }
}

/** The badge this page shows, or null when it shows nothing. */
export function badge(participant: Participant): Locator {
  return participant.page.getByTestId('connection-status');
}

/**
 * The badge this page shows, or null when it shows nothing.
 *
 * This reads the DOM directly rather than asking a locator for its text, because a
 * locator waits for the element to exist — which is exactly backwards for the question
 * "has the badge gone away?", where going away is the thing being waited for.
 */
export async function badgeText(participant: Participant): Promise<string | null> {
  return participant.page.evaluate(
    () => document.querySelector('[data-testid="connection-status"]')?.textContent ?? null,
  );
}

/** What this page's own code thinks its connection is, from the test hook. */
export async function connectionState(participant: Participant): Promise<string | undefined> {
  return participant.page.evaluate(() => window.__vidi6?.connectionState);
}

/** The document this page holds, in stacking order. */
export function documentOf(participant: Participant): Promise<readonly StickySnapshot[]> {
  return stickies(participant.page);
}

export async function noteCount(participant: Participant): Promise<number> {
  return (await documentOf(participant)).length;
}

/**
 * Everything one page shows of the board: what its document says and what it paints.
 * Two pages of the same board must agree on all of it — except on the parts that
 * belong to one person and nobody else, which are left out here and asserted about
 * separately in TC-28.
 */
export async function boardSnapshot(participant: Participant): Promise<BoardSnapshot> {
  const painted = await notes(participant.page).evaluateAll((elements) =>
    elements.map((element) => {
      const note = element as HTMLElement;
      const style = getComputedStyle(note);
      const text = note.querySelector<HTMLElement>('[data-testid="sticky-text"]');
      // While a note is being typed in, the page paints a text box instead of the text
      // (see StickyNote), so the text this page shows is what the box holds. Without
      // that, two people looking at the same words would not be said to agree.
      const box = note.querySelector<HTMLTextAreaElement>('textarea');
      return {
        id: note.dataset.noteId ?? '',
        left: Math.round(Number.parseFloat(style.left)),
        top: Math.round(Number.parseFloat(style.top)),
        width: Math.round(Number.parseFloat(style.width)),
        height: Math.round(Number.parseFloat(style.height)),
        color: style.backgroundColor,
        text: text?.textContent ?? box?.value ?? '',
      } satisfies PaintedNote;
    }),
  );
  return { notes: await documentOf(participant), painted };
}

/** The same snapshot as text, which is what "identical" is decided on. */
export async function snapshotKey(participant: Participant): Promise<string> {
  return JSON.stringify(await boardSnapshot(participant));
}

/** The selection outline this page paints on a note: this page's own business. */
export async function isSelectedOnPage(participant: Participant, index = 0): Promise<boolean> {
  const note = notes(participant.page).nth(index);
  const selected = await note.getAttribute('data-selected');
  return selected === 'true';
}

/** Whether this page has a text box open in a note. */
export async function isEditingOnPage(participant: Participant): Promise<boolean> {
  return (await participant.page.locator('[data-testid="sticky-textarea"]').count()) > 0;
}

// ---------------------------------------------------------------------------
// Waiting, and what it costs
// ---------------------------------------------------------------------------

/** One measured wait for a change to travel from one page to another. */
export interface LatencyRecord {
  what: string;
  ms: number;
  budgetMs: number;
  /** True when the change took longer than LIVE_UPDATE_LATENCY_BUDGET_MS. */
  over: boolean;
}

const measured: LatencyRecord[] = [];

/**
 * Waits for a functional outcome, and writes down how long it took.
 *
 * `since` is a timestamp taken as close to the change as a test can get — usually
 * `Date.now()` immediately before the action that makes it — so the number includes the
 * trip to the room, the merge and the trip back, plus up to one poll interval of looking
 * late. The outcome is asserted; the number is reported, because this machine is running
 * the browser, the model and the server at the same time and a slow test machine is not
 * a slow board.
 */
export function expectEventually(
  what: string,
  check: () => unknown | Promise<unknown>,
  options: { since?: number; timeoutMs?: number } = {},
): {
  toBe(expected: unknown): Promise<void>;
  toEqual(expected: unknown): Promise<void>;
  toBeGreaterThan(limit: number): Promise<void>;
  /** Succeeds when the check says there is nothing there. */
  toBeNull(): Promise<void>;
} {
  const started = options.since ?? Date.now();
  const timeout = options.timeoutMs ?? E2E_EVENTUAL_TIMEOUT_MS;
  const poll = expect.poll(check, {
    timeout,
    intervals: [POLL_INTERVAL_MS],
    message: `${what} (did not happen within ${timeout} ms)`,
  });

  const done = async (assert: () => Promise<void>): Promise<void> => {
    await assert();
    const ms = Date.now() - started;
    measured.push({ what, ms, budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS, over: ms > LIVE_UPDATE_LATENCY_BUDGET_MS });
    // Each change is printed as it is measured, so a run that never gets to the report
    // still tells you how far it got and how long the steps took.
    console.log(
      `  [latency] ${what}: ${ms} ms${ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ` (over the ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms budget)` : ''}`,
    );
  };

  return {
    toBe: (expected: unknown) => done(() => poll.toBe(expected)),
    toEqual: (expected: unknown) => done(() => poll.toEqual(expected as never)),
    toBeGreaterThan: (limit: number) => done(() => poll.toBeGreaterThan(limit)),
    toBeNull: () => done(() => poll.toBeNull()),
  };
}

/**
 * Waits until every participant holds the same board. This is the assertion the whole
 * story is for: not that a change arrived somewhere, but that everybody agrees.
 */
export async function expectConverged(
  what: string,
  participants: readonly Participant[],
  options: { since?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (participants.length < 2) throw new Error('a board needs two people to converge');
  let agreed: string[] = [];
  await expectEventually(
    what,
    async () => {
      const [mine, ...others] = await Promise.all(
        participants.map((participant) => snapshotKey(participant)),
      );
      const everyKey = mine !== undefined && others.every((key) => key === mine);
      if (everyKey && mine !== undefined) agreed = [mine];
      return everyKey;
    },
    options,
  ).toBe(true);
  return agreed[0] ?? '';
}

/** Prints what was measured, against the budget. Never fails a test. */
export function logLatencies(title = 'live update latency'): void {
  if (measured.length === 0) {
    console.log(`${title}: nothing was measured`);
    return;
  }
  const times = measured.map((record) => record.ms).sort((a, b) => a - b);
  const over = measured.filter((record) => record.over);
  console.log(
    `\n${title}\n` +
      `  ${measured.length} change(s) measured, budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms per change\n` +
      `  p50 ${percentile(times, 0.5)} ms · p95 ${percentile(times, 0.95)} ms · max ${times[times.length - 1]} ms\n` +
      `  ${over.length} change(s) over budget (reported, not asserted: the browser, the model and the server share this machine)\n`,
  );
  for (const record of over) console.log(`    over budget: ${record.what} — ${record.ms} ms`);
  measured.length = 0;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], rank: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1)] ?? 0;
}

/** Everything measured so far; tests that want the numbers themselves, not the report. */
export function measurements(): readonly LatencyRecord[] {
  return measured;
}

// ---------------------------------------------------------------------------
// Waiting for the connection itself
// ---------------------------------------------------------------------------

/** How long a board is allowed to take to reach the room at all. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Waits until this page's own state machine says the board is live, and the badge has
 * gone quiet. Both halves matter: the state is what the app believes, the badge is what
 * a person would see.
 */
export async function waitForLive(participant: Participant): Promise<void> {
  await expect
    .poll(() => connectionState(participant), {
      timeout: CONNECT_TIMEOUT_MS,
      message: `${participant.name}: the board never reported a live connection`,
    })
    .toBe('connected');
  await expect(badge(participant), `${participant.name}: a live board still shows a badge`).toBeHidden();
}

/** The badge says this, eventually. */
export async function expectBadge(
  participant: Participant,
  text: string | null,
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(() => badgeText(participant), {
      timeout: timeoutMs,
      message: `${participant.name}: the badge never said ${JSON.stringify(text)}`,
    })
    .toBe(text);
}

/** Notes this page paints, as locators. */
export function paintedNotes(participant: Participant): Locator {
  return notes(participant.page);
}

/** The participant's own name in a message, so a failure says who. */
export function who(participant: Participant): string {
  return participant.name;
}

/** The number of people the design says a board is designed for. */
export const CAPACITY = MAX_CONCURRENT_EDITORS;

// ---------------------------------------------------------------------------
// One person's hands
// ---------------------------------------------------------------------------

/**
 * Where a note sits among the notes this page paints. The page paints them in the order
 * they were made, which is not the order they are stacked in, so a note is always found
 * by its id and never by its position in a list.
 */
export async function paintedIndexOf(participant: Participant, id: string): Promise<number> {
  const ids = await notes(participant.page).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.noteId ?? ''),
  );
  const index = ids.indexOf(id);
  if (index < 0) {
    throw new Error(`${participant.name} paints no note with id ${id} (of ${ids.join(', ')})`);
  }
  return index;
}

/** The point a pointer would grab this person's copy of a note at, on their screen. */
export async function centreOf(participant: Participant, id: string): Promise<Point> {
  return actualCentre(await noteBox(participant.page, await paintedIndexOf(participant, id)));
}

/** Picks a note up and puts it down again, in screen pixels, on one person's screen. */
export async function dragNoteById(
  participant: Participant,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  await dragNote(participant.page, await centreOf(participant, id), dx, dy);
}

/** Selects a note without editing it. */
export async function selectNoteById(participant: Participant, id: string): Promise<void> {
  await noteAt(participant.page, await paintedIndexOf(participant, id)).click();
  await settled(participant.page);
}

/** Double-clicks a note open, so this person can type in it. */
export async function editNoteById(participant: Participant, id: string): Promise<void> {
  await noteAt(participant.page, await paintedIndexOf(participant, id)).dblclick();
  await expect(editor(participant.page), `${participant.name} has no text box open`).toBeVisible();
}

/**
 * Points this page's camera somewhere specific. The camera is this page's own business
 * (it is not in the document and nobody else sees it), so a test that wants several
 * screens to be comparable — or wants 25 notes on one screen — sets them all to the same
 * place, in world units, rather than relying on where the board happened to open.
 */
export async function aimCamera(participant: Participant, camera: Partial<{ x: number; y: number; zoom: number }>): Promise<void> {
  await setCamera(participant.page, camera);
}

/** Where a note of a given id is painted on this page's screen. */
export async function boxOfNote(participant: Participant, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return noteBox(participant.page, await paintedIndexOf(participant, id));
}
