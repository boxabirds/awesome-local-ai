/**
 * Multiple people on one board, in one test.
 *
 * A *participant* is an isolated browser context — separate storage, separate
 * cookies, separate WebSocket — pointed at the same `/b/<boardId>` and waiting
 * until its board has synced. Isolation matters: two pages in one context could in
 * principle see each other through a `BroadcastChannel`, and then a test would pass
 * while the server relayed nothing. (`disableBc` in `connectBoard` rules that out
 * anyway; the contexts mean the test does not depend on it.)
 *
 * The other thing here is `waitForChange`, which is how every cross-person
 * assertion is made. It polls until a condition holds, with
 * `E2E_EVENTUAL_TIMEOUT_MS`, and *records how long it took*. That number is logged
 * against `LIVE_UPDATE_LATENCY_BUDGET_MS` and never asserted: these tests run with
 * five browsers, the app, the Worker and the model on one machine, so a slow run is
 * a fact about the machine, not a broken board. Convergence is what is asserted.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { createBoard, setCamera } from './board';

export const NOTE_SELECTOR = '[data-testid="sticky-note"]';
export const EDITOR_SELECTOR = '[data-testid="sticky-note-editor"]';
export const BADGE_SELECTOR = '[data-testid="connection-status"]';

/** Names used in the order the contexts are opened, so logs read like a story. */
export const PARTICIPANT_NAMES = ['Alex', 'Sam', 'Jo', 'Priya', 'Rae', 'Nico', 'Kim'] as const;

export interface BoardNote {
  id: string;
  /** World coordinates of the note's top-left corner. */
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
  selected: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** The latency of every cross-person change made by the test now running. */
const latencySamples: { label: string; ms: number }[] = [];

/**
 * Options for `expect.poll` in this suite: the same eventual budget everything
 * else uses, so a busy machine slows a test down rather than failing it.
 */
export const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS } as const;

export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** The board as this person's screen shows it, in stacking order. */
  board(): Promise<BoardNote[]>;
  note(id: string): Promise<BoardNote | undefined>;
  /** Note ids, for comparisons where the rest of the note is the thing under test. */
  noteIds(): Promise<string[]>;
  /** Console and page errors so far, which some tests insist are empty. */
  errors(): string[];
  /** Double-click empty space: creates a note and starts typing it. Returns its id. */
  createNote(at?: ScreenPoint): Promise<string>;
  /** Create a note through the toolbar button, centred in the view. */
  createNoteFromToolbar(): Promise<string>;
  /** Select a note by clicking it. */
  selectNote(id: string): Promise<ScreenPoint>;
  /** Type into a note that is already being edited. */
  type(text: string): Promise<void>;
  /** Start editing a note that exists, then type into it. */
  editNote(id: string, text: string): Promise<void>;
  /** Stop editing, the way pressing Escape does. */
  stopEditing(): Promise<void>;
  editing(): Promise<boolean>;
  /** Drag a note by a screen delta. */
  dragNote(id: string, delta: ScreenPoint): Promise<void>;
  /** Click a colour swatch in the selected note's toolbar. */
  recolour(name: string): Promise<void>;
  /** Delete through the toolbar's bin, note must be selected. */
  deleteSelectedNote(): Promise<void>;
  /** The badge text, or null when the badge is not rendered. */
  badge(): Promise<string | null>;
  connectionState(): Promise<string>;
  goOffline(): Promise<void>;
  goOnline(): Promise<void>;
}

export interface BoardSession {
  boardId: string;
  participants: Participant[];
  byName(name: string): Participant;
  close(): Promise<void>;
}

/** Where a note's centre is on screen right now. */
export async function noteCentreOnScreen(page: Page, id: string): Promise<ScreenPoint> {
  const box = await page
    .locator(`${NOTE_SELECTOR}[data-note-id="${id}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`note ${id} has no box on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Wait for a condition that depends on another person's change, and time it. */
export async function waitForChange(label: string, check: () => Promise<boolean>): Promise<number> {
  const started = Date.now();
  await expect
    .poll(check, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [25, 50, 100, 250],
      message: `${label}: did not happen within ${String(E2E_EVENTUAL_TIMEOUT_MS)} ms`,
    })
    .toBe(true);
  const elapsed = Date.now() - started;
  latencySamples.push({ label, ms: elapsed });
  const verdict = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'over';
  console.log(
    `[latency] ${label}: ${String(elapsed)} ms (${verdict} the ${String(
      LIVE_UPDATE_LATENCY_BUDGET_MS,
    )} ms budget; reported, not asserted)`,
  );
  return elapsed;
}

/** Start the latency record afresh, so a report belongs to one test. */
export function resetLatencySamples(): void {
  latencySamples.length = 0;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

/** The run's latency summary, printed by the tests that measure it. */
export function logLatencyReport(title: string): void {
  const values = latencySamples.map((sample) => sample.ms);
  if (values.length === 0) {
    console.log(`[latency] ${title}: nothing measured`);
    return;
  }
  console.log(
    `[latency] ${title}: ${String(values.length)} changes, p50 ${String(percentile(values, 0.5))} ms, ` +
      `p95 ${String(percentile(values, 0.95))} ms, max ${String(Math.max(...values))} ms ` +
      `(budget ${String(LIVE_UPDATE_LATENCY_BUDGET_MS)} ms, reported not asserted)`,
  );
}

/** Every note id, so a test can wait for a specific one to appear or vanish. */
function idsOf(notes: readonly BoardNote[]): string[] {
  return notes.map((note) => note.id);
}

/** The same board, as one string, for comparisons that fail informatively. */
export function describeBoard(notes: readonly BoardNote[]): string {
  return notes
    .map((note) => `${note.id} x=${note.x} y=${note.y} z=${note.z} ${note.color} "${note.text}"`)
    .join('\n');
}

/**
 * Open `count` isolated people on one brand new board and wait for them to sync.
 *
 * The board is created before anybody is pointed at it. Since the sharing story that is
 * not a convenience but a requirement: an address nobody created is not a board, and its
 * room refuses the socket, so a test that invented an id would find its participants
 * looking at "Board not found".
 */
export async function openBoard(browser: Browser, count: number): Promise<BoardSession> {
  resetLatencySamples();
  const boardId = await createBoardIn(browser);
  const participants: Participant[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = PARTICIPANT_NAMES[index] ?? `Person${String(index + 1)}`;
    participants.push(await openParticipant(browser, name, boardId));
  }
  return {
    boardId,
    participants,
    byName(name: string): Participant {
      const found = participants.find((participant) => participant.name === name);
      if (!found) throw new Error(`no participant called ${name}`);
      return found;
    },
    async close(): Promise<void> {
      for (const participant of participants) await participant.context.close();
    },
  };
}

/** A board, made by the API in a context that is closed again straight away. */
async function createBoardIn(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    return await createBoard(context.request);
  } finally {
    await context.close();
  }
}

/**
 * Point one more person at a board that already exists.
 *
 * `boardId` must name a board: the page will open, but the room will refuse the socket
 * and `waitForConnection` will report the failure rather than wait forever.
 */
export async function openParticipant(browser: Browser, name: string, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: console.error ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`${name}: page error ${error.message}`);
  });
  // A board that has nothing to say about a problem should say nothing: a dialog of
  // any kind is a failure some test will report.
  page.on('dialog', (dialog) => {
    errors.push(`${name}: ${dialog.type()} dialog ${dialog.message()}`);
    void dialog.dismiss();
  });

  await page.goto(`/b/${boardId}`, { waitUntil: 'domcontentloaded' });
  await waitForConnection(page, name);

  const participant: Participant = {
    name,
    context,
    page,
    board: () => readBoard(page),
    async note(id: string) {
      return (await readBoard(page)).find((note) => note.id === id);
    },
    async noteIds() {
      return idsOf(await readBoard(page));
    },
    errors: () => errors,
    async createNote(at: ScreenPoint = { x: 640, y: 400 }) {
      const before = new Set(idsOf(await readBoard(page)));
      await page.mouse.dblclick(at.x, at.y);
      await expect
        .poll(() => readBoard(page).then((notes) => notes.filter((note) => !before.has(note.id))), {
          message: `${name}: the double-click did not create a note`,
        })
        .not.toHaveLength(0);
      const created = (await readBoard(page)).find((note) => !before.has(note.id));
      if (!created) throw new Error(`${name}: no new note after double-click`);
      return created.id;
    },
    async createNoteFromToolbar() {
      const before = new Set(idsOf(await readBoard(page)));
      await page.getByTestId('tool-sticky-note').click();
      await expect
        .poll(() => readBoard(page).then((notes) => notes.filter((note) => !before.has(note.id))), {
          message: `${name}: the toolbar did not create a note`,
        })
        .not.toHaveLength(0);
      const created = (await readBoard(page)).find((note) => !before.has(note.id));
      if (!created) throw new Error(`${name}: no new note after the toolbar`);
      return created.id;
    },
    async selectNote(id: string) {
      const centre = await noteCentreOnScreen(page, id);
      await page.mouse.click(centre.x, centre.y);
      await expect
        .poll(() => participant.note(id).then((note) => note?.selected ?? false), {
          message: `${name}: note ${id} did not become selected`,
        })
        .toBe(true);
      return centre;
    },
    async type(text: string) {
      await page.keyboard.type(text, { delay: 10 });
    },
    async editNote(id: string, text: string) {
      await participant.selectNote(id);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('sticky-note-textarea')).toBeVisible();
      if (text.length > 0) await participant.type(text);
    },
    async stopEditing() {
      await page.keyboard.press('Escape');
      await expect(page.locator(EDITOR_SELECTOR)).toHaveCount(0);
    },
    async editing() {
      return (await page.locator(EDITOR_SELECTOR).count()) > 0;
    },
    async dragNote(id: string, delta: ScreenPoint) {
      const centre = await noteCentreOnScreen(page, id);
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + delta.x, centre.y + delta.y, { steps: 10 });
      await page.mouse.up();
    },
    async recolour(colour: string) {
      await page.getByRole('button', { name: `${colour} colour` }).click();
    },
    async deleteSelectedNote() {
      await page.getByRole('button', { name: 'Delete note' }).click();
    },
    async badge() {
      const element = page.locator(BADGE_SELECTOR);
      if ((await element.count()) === 0) return null;
      return (await element.textContent()) ?? '';
    },
    async connectionState() {
      return page.evaluate(() => window.__vidi6?.connectionState ?? 'unknown');
    },
    async goOffline() {
      // Two things have to happen: the network has to stop, and the connection has
      // to notice. `setOffline` alone leaves the socket standing until it times out,
      // which is minutes, so the board is told to drop it as a real drop would.
      await context.setOffline(true);
      await page.waitForFunction(() => typeof window.__vidi6?.goOffline === 'function');
      await page.evaluate(() => window.__vidi6?.goOffline?.());
    },
    async goOnline() {
      await context.setOffline(false);
      await page.evaluate(() => window.__vidi6?.goOnline?.());
    },
  };
  return participant;
}

/** Wait until the board says it is in sync with its room. */
export async function waitForConnection(page: Page, name: string): Promise<void> {
  await page
    .waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .catch((error: unknown) => {
      throw new Error(`${name}: never reached the connected state (${String(error)})`);
    });
}

/** The notes on screen, in the order they are painted. */
export async function readBoard(page: Page): Promise<BoardNote[]> {
  return page.$$eval(NOTE_SELECTOR, (elements) =>
    elements.map((element) => {
      const note = element as HTMLElement;
      const textElement = note.querySelector<HTMLElement>('[data-testid="sticky-note-text"]');
      const textarea = note.querySelector<HTMLTextAreaElement>(
        '[data-testid="sticky-note-textarea"]',
      );
      return {
        id: note.dataset.noteId ?? '',
        x: Number(note.dataset.noteX),
        y: Number(note.dataset.noteY),
        z: Number(note.dataset.noteZ),
        color: note.dataset.color ?? '',
        text: textarea?.value ?? textElement?.textContent ?? '',
        selected: note.dataset.selected === 'true',
      };
    }),
  );
}

/** Wait until every participant's screen shows the same board. */
export async function waitForIdenticalBoards(label: string, people: readonly Participant[]): Promise<void> {
  await waitForChange(label, async () => {
    const boards = await Promise.all(people.map((person) => person.board()));
    const first = describeBoard(boards[0] ?? []);
    return boards.every((board) => describeBoard(board) === first);
  });
}

/** A note as a screen shows it, minus the local-only selection decoration. */
export type SharedBoardNote = Omit<BoardNote, 'selected'>;

/** Everything two people have to agree on, minus the local-only decorations. */
export function withoutSelection(notes: readonly BoardNote[]): SharedBoardNote[] {
  return notes.map((note) => {
    const { selected: _selected, ...rest } = note;
    return rest;
  });
}

/**
 * The world point a test should put a note at: one row per person, one column point
 * per note, spaced wider than a note so that clicking one can only ever hit that one.
 * The default 260 leaves a 60 unit gap around a 200 unit note, which is enough for a
 * click; a run that also uses a note's toolbar — which floats about 34 units above it,
 * where a taller neighbour can cover it — passes a wider spacing.
 */
export function noteWorld(
  personIndex: number,
  noteIndex: number,
  spacing = 260,
): ScreenPoint {
  return { x: noteIndex * spacing, y: personIndex * spacing };
}

/** Look at a world point, without moving anything. */
export async function focusWorld(page: Page, world: ScreenPoint): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await setCamera(page, { x: world.x - size.width / 2, y: world.y - size.height / 2, zoom: 1 });
}

/**
 * Put a note at a known world point: look at the spot, create a note in the middle
 * of the view (which the app centres on the view), and stop typing.
 *
 * Tests that then drag a note need exactly this: an id whose note is on screen, at a
 * place nobody else is using, so a click means what it says.
 */
export async function placeNote(person: Participant, world: ScreenPoint): Promise<string> {
  await focusWorld(person.page, world);
  const id = await person.createNoteFromToolbar();
  await person.stopEditing();
  return id;
}

/** How many of each character a string holds, for "nothing was lost and added". */
export function characterCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const character of text) counts[character] = (counts[character] ?? 0) + 1;
  return counts;
}
