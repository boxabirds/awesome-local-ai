import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { BOARD_ID_PATTERN } from '../../../src/shared/board-id';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
  STICKY_SIZE_WORLD,
} from '../../../src/shared/config';
import { LINK_COPIED_LABEL } from '../../../src/client/share/SharePanel';
import { screenToWorld } from '../../../src/client/canvas/camera';
import {
  BOARD_URL,
  boardNotes,
  dragPointer,
  noteRect,
  readCamera,
  waitForCentredBoard,
  type NoteRecord,
} from './board';

/**
 * Live collaboration in real browsers: one `Participant` per browser context, so two
 * people really are two people — separate documents, separate WebSockets, no shared
 * storage. Everything a participant does is done through the same UI a person uses.
 */
export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console and page errors this browser has produced, in order. */
  readonly errors: string[];
  /** The URL of every WebSocket this browser has opened, in order. */
  readonly sockets: string[];
}

/** The people the story names first, then enough seats for `MAX_CONCURRENT_EDITORS`. */
const NAMES = ['Alex', 'Sam', 'Priya', 'Chen', 'Kim', 'Nina', 'Omar', 'Bea'] as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One measured change, for the latency report the budget is reported against. */
export interface LatencySample {
  readonly op: string;
  readonly latencyMs: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
}

/** The address of a board, as it appears in the link the app copies. */
export function boardLink(boardId: string): string {
  return `/b/${boardId}`;
}

/** Anything that can ask the test server for something: a request, a context, or a browser. */
type Requester = APIRequestContext | BrowserContext | Browser;

/**
 * A board that exists, made through the endpoint the app itself uses — since story 5 an
 * id nobody created is simply a board that is not there, and a test that wants one of
 * those should say so with a link rather than by hoping the client still opens it.
 */
export async function createBoard(via: Requester): Promise<string> {
  const context = 'newContext' in via ? await via.newContext() : null;
  const request: APIRequestContext =
    context !== null
      ? context.request
      : 'request' in via
        ? via.request
        : (via as APIRequestContext);
  try {
    const response = await request.post('/api/boards');
    expect(response.status(), 'POST /api/boards').toBe(201);
    const body: unknown = await response.json();
    const id =
      typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string'
        ? body.id
        : null;
    expect(id, 'the created board id').not.toBeNull();
    if (id === null) throw new Error('unreachable');
    expect(BOARD_ID_PATTERN.test(id), `created id ${id}`).toBe(true);
    return id;
  } finally {
    await context?.close();
  }
}

/** The link of a board that exists, ready to hand to `createParticipants`. */
export async function createBoardLink(via: Requester): Promise<string> {
  return boardLink(await createBoard(via));
}

/**
 * Open `count` isolated contexts on the same board and wait until each one is holding
 * a board. Contexts, not pages: two pages in one context would share `localStorage` and
 * be a weaker test than two strangers on the internet.
 */
export async function createParticipants(
  browser: Browser,
  link: string,
  count: number,
): Promise<Participant[]> {
  const people: Participant[] = [];
  for (const name of NAMES.slice(0, count)) {
    const context = await clipboardContext(browser);
    const person = participantOf(name, context, await context.newPage());
    people.push(person);
    await person.page.goto(link);
    await waitForCentredBoard(person.page);
  }
  return people;
}

/**
 * A context that can read and write the clipboard. Sharing a link is a clipboard act, so
 * every context this suite opens has the permission — and where the engine has nothing to
 * grant, granting it changes nothing.
 */
export async function clipboardContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  return context;
}

/**
 * A person out of a context and page a test opened itself, with the same recording of
 * console errors and sockets that the suites which open their own people rely on.
 */
export function participantOf(name: string, context: BrowserContext, page: Page): Participant {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  return { name, context, page, errors, sockets };
}

const closed = new WeakSet<Participant>();

/** Close every context, once, so a test's cleanup and a mid-test teardown cannot clash. */
export async function closeParticipants(people: Participant[]): Promise<void> {
  await Promise.all(
    people.map(async (person) => {
      if (closed.has(person)) return;
      closed.add(person);
      try {
        await person.context.close();
      } catch {
        // Already closed by the browser or by Playwright itself.
      }
    }),
  );
}

/** How many participants the story's capacity setting expects. */
export function capacity(): number {
  return MAX_CONCURRENT_EDITORS;
}

/* -------------------------------------------------------------------------
 * Reading a board
 * ---------------------------------------------------------------------- */

/** Everything the board holds, as one comparable string. */
export async function snapshotOf(page: Page): Promise<string> {
  return JSON.stringify(await boardNotes(page));
}

/** Note ids in the order the board paints them. */
export async function noteIds(page: Page): Promise<string[]> {
  return (await boardNotes(page)).map((note) => note.id);
}

/** Where a note sits on the screen, which is the only thing a reader can verify. */
export async function markerPosition(page: Page, id: string): Promise<Point> {
  const rect = await noteRect(page, id);
  return { x: rect.centerX, y: rect.centerY };
}

/** The notes as a reader sees them: id and screen position, sorted by id. */
export async function boardMarkers(page: Page): Promise<Array<{ id: string; x: number; y: number }>> {
  const notes = await boardNotes(page);
  const markers = await Promise.all(
    notes.map(async (note) => ({ id: note.id, ...(await markerPosition(page, note.id)) })),
  );
  return markers.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function connectionState(page: Page): Promise<string> {
  const state = await page.evaluate(() => window.__vidi6?.connectionState?.());
  if (typeof state !== 'string') throw new Error(`no connection state exposed at ${page.url()}`);
  return state;
}

/* -------------------------------------------------------------------------
 * Waiting for something to become true
 * ---------------------------------------------------------------------- */

/**
 * Wait for a functional outcome. There is no sleep in this file that stands in for
 * "the change should have arrived by now": a change either arrives within the generous
 * budget or the test fails, and how long it took is logged instead.
 */
export async function expectEventually(
  page: Page,
  what: string,
  ready: () => Promise<boolean>,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(ready, { timeout: timeoutMs, message: `${what} — never happened at ${page.url()}` })
    .toBe(true);
}

/** Every participant holding the same board. */
export async function expectConverged(people: Participant[]): Promise<string> {
  const [first, ...rest] = people;
  if (!first) throw new Error('no participants');
  await expectEventually(
    first.page,
    'every participant agrees on the board',
    async () => {
      const expected = await snapshotOf(first.page);
      for (const other of rest) {
        if ((await snapshotOf(other.page)) !== expected) return false;
      }
      return true;
    },
  );
  return snapshotOf(first.page);
}

/**
 * One person changes the board and everybody else is waited for, one by one, with the
 * time each took measured from the moment of the change.
 */
export async function applyChange(
  description: string,
  sender: Participant,
  change: () => Promise<void>,
  receivers: Participant[],
): Promise<LatencySample[]> {
  await change();
  const changedAt = Date.now();
  const expected = await snapshotOf(sender.page);
  const samples: LatencySample[] = [];
  for (const receiver of receivers) {
    await expectEventually(receiver.page, `${description} reaches ${receiver.name}`, async () =>
      (await snapshotOf(receiver.page)) === expected,
    );
    samples.push(
      logLatency({
        op: `${description} → ${receiver.name}`,
        latencyMs: Date.now() - changedAt,
        budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
      }),
    );
  }
  return samples;
}

/** Report a measured change against the budget. The budget is never asserted. */
export function logLatency(sample: Omit<LatencySample, 'withinBudget'>): LatencySample {
  const withinBudget = sample.latencyMs <= sample.budgetMs;
  console.log(
    `[latency] ${sample.op}: ${sample.latencyMs}ms (budget ${sample.budgetMs}ms${
      withinBudget ? '' : ', over'
    })`,
  );
  return { ...sample, withinBudget };
}

/** The same report in aggregate, for the soak tests. */
export function logLatencySummary(samples: LatencySample[]): void {
  if (samples.length === 0) {
    console.log('[latency] nothing measured');
    return;
  }
  const sorted = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
  const over = samples.filter((sample) => !sample.withinBudget).length;
  console.log(
    `[latency] ${samples.length} changes: p50=${at(0.5)}ms p95=${at(0.95)}ms max=${
      sorted[sorted.length - 1]
    }ms over budget ${over}/${samples.length} (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted)`,
  );
}

/* -------------------------------------------------------------------------
 * What a person does
 * ---------------------------------------------------------------------- */

/**
 * Share, Copy link, and whatever the clipboard holds afterwards — which is the only proof
 * that matters, because the clipboard is what carries the link to the next person.
 */
export async function copyLinkThroughPanel(page: Page): Promise<string> {
  await page.getByTestId('share-button').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await page.getByTestId('copy-link').click();
  // The confirmation is the app's own claim that the link is on the clipboard, so it is
  // waited for before the clipboard is read back and compared with it.
  await expect(page.getByTestId('copy-link')).toContainText(LINK_COPIED_LABEL);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text, 'the copied link').toMatch(BOARD_URL);
  return text;
}

/** Double-click an empty spot: that is how a person makes a note. */
export async function createNoteAt(person: Participant, at: Point): Promise<string> {
  const camera = await readCamera(person.page);
  // `createSticky` stores the top-left corner of the note it centred on the pointer.
  const world = screenToWorld(camera, at);
  const left = world.x - STICKY_SIZE_WORLD / 2;
  const top = world.y - STICKY_SIZE_WORLD / 2;
  const before = new Set((await boardNotes(person.page)).map((note) => note.id));
  await person.page.mouse.dblclick(at.x, at.y);
  let mine: NoteRecord | undefined;
  await expect
    .poll(
      async () => {
        mine = (await boardNotes(person.page)).find(
          (note) =>
            !before.has(note.id) && Math.abs(note.x - left) <= 1 && Math.abs(note.y - top) <= 1,
        );
        return mine !== undefined;
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `a new note at ${left},${top} for ${person.name}` },
    )
    .toBe(true);
  if (!mine) throw new Error('unreachable');
  return mine.id;
}

/** A note double-clicked is a note being typed into; clicking elsewhere ends it. */
export async function endEditing(person: Participant): Promise<void> {
  await person.page.mouse.click(200, 60);
  await expect(person.page.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
}

/** Double-click a note to edit it, and type into it. Does not end the edit. */
export async function startTyping(person: Participant, id: string): Promise<void> {
  const at = await markerPosition(person.page, id);
  await person.page.mouse.dblclick(at.x, at.y);
  await expect(person.page.locator('[data-testid="sticky-editor"]')).toHaveCount(1);
}

export async function typeInto(person: Participant, id: string, text: string): Promise<void> {
  await startTyping(person, id);
  await person.page.keyboard.type(text);
  await endEditing(person);
}

/** Grab a note by its middle and drag it. */
export async function moveNoteBy(person: Participant, id: string, by: Point): Promise<void> {
  const at = await markerPosition(person.page, id);
  await dragPointer(person.page, at, { x: at.x + by.x, y: at.y + by.y });
}

export async function selectNote(person: Participant, id: string): Promise<void> {
  const at = await markerPosition(person.page, id);
  await person.page.mouse.click(at.x, at.y);
  await expect(person.page.locator(`[data-note-id="${id}"][data-selected="true"]`)).toHaveCount(1);
}

export async function recolourNote(person: Participant, id: string, colour: string): Promise<void> {
  await selectNote(person, id);
  const label = `${colour.slice(0, 1).toUpperCase()}${colour.slice(1)} colour`;
  await person.page.locator(`button[aria-label="${label}"]`).click();
}

export async function deleteNote(person: Participant, id: string): Promise<void> {
  await selectNote(person, id);
  await person.page.locator('button[aria-label="Delete note"]').click();
  await expect(person.page.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
}

/** What the board holds for this person, by id. */
export async function notesOf(person: Participant): Promise<NoteRecord[]> {
  return boardNotes(person.page);
}

/** Where a note sits in the board's own coordinates, as this person sees it. */
export async function positionOf(person: Participant, id: string): Promise<Point> {
  const note = (await notesOf(person)).find((candidate) => candidate.id === id);
  if (!note) throw new Error(`no note ${id} for ${person.name}`);
  return { x: note.x, y: note.y };
}

/** What a note says on this person's screen. */
export async function textOf(person: Participant, id: string): Promise<string> {
  return (await notesOf(person)).find((candidate) => candidate.id === id)?.text ?? '';
}

/* -------------------------------------------------------------------------
 * Connection
 * ---------------------------------------------------------------------- */

/** Pull the network cable out of one participant's hands, or put it back. */
export async function setOffline(person: Participant, offline: boolean): Promise<void> {
  await person.context.setOffline(offline);
}

const BADGE = '[data-testid="connection-status"]';

/**
 * Start watching the page for the connection badge appearing at all, so a test can say
 * "never rendered" instead of "was not seen at the moments this test happened to look".
 */
export async function watchForBadge(page: Page): Promise<void> {
  await page.evaluate((selector: string) => {
    const seen: string[] = [];
    const record = (): void => {
      const badge = document.querySelector(selector);
      if (badge) seen.push(badge.textContent ?? '');
    };
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true });
    record();
    Object.defineProperty(window, '__vidi6BadgeSightings', { value: seen });
  }, BADGE);
}

/** Everything the badge has shown on this page since `watchForBadge` started. */
export async function badgeSightings(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __vidi6BadgeSightings?: string[] }).__vidi6BadgeSightings ?? []);
}

/** The badge says exactly this, for as long as the state lasts. */
export async function waitForBadge(page: Page, text: string, timeoutMs = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect(page.locator(BADGE)).toHaveText(text, { timeout: timeoutMs });
}

/** Nothing about the connection to report. */
export async function expectBadgeHidden(page: Page, timeoutMs = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect(page.locator(BADGE)).toHaveCount(0, { timeout: timeoutMs });
}

/**
 * How long an outage may last before the provider is expected to have noticed and
 * reconnected: its own backoff cap is the promise the client makes, so the test waits
 * for that plus the usual functional budget instead of inventing a number.
 */
export const RECOVERY_TIMEOUT_MS = E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS;

/**
 * How long a disconnected client may take to *say* it is disconnected. Nothing in the
 * client polls: `y-websocket` gives up on a connection it has heard nothing on for 30
 * seconds and only then reports `disconnected`, which is what the badge maps. That
 * timeout is the library's own, so the wait is the outage budget plus a functional wait.
 */
export const OUTAGE_DETECTION_TIMEOUT_MS = CATCH_UP_TEST_OUTAGE_MS + E2E_EVENTUAL_TIMEOUT_MS;

/**
 * Nobody is complaining about the connection — except, perhaps, about the thing this test broke
 * on purpose. `ignoring` names those: a browser logs a request it was not allowed to complete,
 * and a test that refused the request has no interest in reading about it again.
 */
export function expectNoErrors(people: Participant[], ignoring: readonly RegExp[] = []): void {
  for (const person of people) {
    const complained = person.errors.filter(
      (message) => !ignoring.some((pattern) => pattern.test(message)),
    );
    expect(complained, `${person.name}'s console`).toEqual([]);
  }
}
