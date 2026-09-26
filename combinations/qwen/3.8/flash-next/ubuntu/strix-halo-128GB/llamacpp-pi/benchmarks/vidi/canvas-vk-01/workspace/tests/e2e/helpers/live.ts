import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for story 3 (live collaboration): several clients on one board,
 * compared with each other through what they show on screen.
 *
 * Notes carry `data-note-id`, the id every client sees (it lives in the
 * Y.Doc), so a note created on one client is located by the same id on another.
 */

/**
 * Budget for "appears live" (TC-22, TC-27): from the local commit to the same
 * value showing on another client. Localhost plus a local room is far below
 * this; it is deliberately generous so the suite stays green on shared CI.
 */
export const LATENCY_BUDGET_MS = 100;

/** A note's on-screen rectangle. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything a comparison test needs to know about the notes a client shows. */
export type NotesOnScreen = Record<string, Box>;

/** Board ids are 22 base64url characters (src/shared/board-id.ts). */
const BOARD_ID_IN_URL = /\/b\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/;

export const viewportOf = (page: Page): Locator => page.getByTestId('board-viewport');
export const createStickyButton = (page: Page): Locator => page.getByTestId('create-sticky');
export const connectionBadge = (page: Page): Locator => page.getByTestId('connection-status');
export const noteToolbar = (page: Page): Locator => page.getByTestId('note-toolbar');
export const editorOf = (page: Page): Locator => page.getByTestId('sticky-textarea');
export const noteOf = (page: Page, id: string): Locator => page.locator(`[data-note-id="${id}"]`);

/** Watch console errors and uncaught exceptions (TC-25, TC-30 assert none). */
export function watchErrors(page: Page): { errors(): string[]; reset(): void } {
  let errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${String(error)}`));
  return {
    errors: () => [...errors],
    reset: () => {
      errors = [];
    },
  };
}

/** Load the app at `/`, create a board via the button, and return the board id. */
export async function startBoard(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  await page.waitForFunction(
    () => /^\/b\/[A-Za-z0-9_-]{22}$/.test(window.location.pathname),
    { timeout: 10_000 },
  );
  await expect(viewportOf(page)).toBeVisible();
  await expectConnected(page);
  return boardIdOf(page);
}

/** Join an existing board and wait until it is loaded and in sync. */
export async function joinBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await expect(viewportOf(page)).toBeVisible();
  expect(boardIdOf(page)).toBe(boardId);
  await expectConnected(page);
}

/** The board id in the address bar. */
export function boardIdOf(page: Page): string {
  const url = page.url();
  const match = BOARD_ID_IN_URL.exec(url);
  if (match === null) throw new Error(`expected a board URL, got ${url}`);
  return match[1];
}

/** The badge is gone once the board is in sync (and stays gone for 2 s after that). */
export async function expectConnected(page: Page): Promise<void> {
  await expect(connectionBadge(page)).toBeHidden();
}

export async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-note-id]')].map((element) =>
      String(element.getAttribute('data-note-id')),
    ),
  );
}

/** `{ noteId: box }` for every note the page currently shows. */
export async function notesOnScreen(page: Page): Promise<NotesOnScreen> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-note-id]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return [
          String(element.getAttribute('data-note-id')),
          { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        ];
      }),
    ),
  );
}

export async function noteBox(page: Page, id: string): Promise<Box> {
  const notes = await notesOnScreen(page);
  const box = notes[id];
  if (box === undefined) throw new Error(`note ${id} is not on ${page.url()}`);
  return box;
}

export async function noteText(page: Page, id: string): Promise<string> {
  return (await page.getByTestId(`sticky-text-${id}`).textContent()) ?? '';
}

/** What a client shows for one note: where, what it says, what colour. */
export interface NoteState {
  x: number;
  y: number;
  text: string;
  color: string;
}

/**
 * `{ noteId: state }` for a full comparison between clients (TC-30): position,
 * text and colour. Render order is stable, so the JSON of two identical boards
 * is the same string.
 */
export async function noteStates(page: Page): Promise<Record<string, NoteState>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-note-id]')].map((element) => [
        String(element.getAttribute('data-note-id')),
        {
          x: Math.round(element.getBoundingClientRect().x),
          y: Math.round(element.getBoundingClientRect().y),
          text: element.querySelector('.sticky-note-text')?.textContent ?? '',
          color: getComputedStyle(element).backgroundColor,
        },
      ]),
    ),
  );
}

/**
 * Wait until every client shows the same board, note for note, and return how
 * long the slowest client took — the per-change latency of TC-30.
 */
export async function waitForIdenticalBoards(
  pages: readonly Page[],
  timeout = 10_000,
): Promise<number> {
  const start = Date.now();
  await expect
    .poll(
      async () => {
        const shots = await Promise.all(pages.map(noteStates));
        const reference = JSON.stringify(shots[0]);
        return shots.every((shot) => JSON.stringify(shot) === reference);
      },
      { timeout, intervals: [10] },
    )
    .toBe(true);
  return Date.now() - start;
}

/**
 * True when the topmost element at a note's centre is that note, i.e. a real
 * user could press it without hitting a neighbour.
 */
export async function ownsCentre(page: Page, id: string): Promise<boolean> {
  return page.evaluate((noteId) => {
    const element = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return hit?.closest('[data-note-id]')?.getAttribute('data-note-id') === noteId;
  }, id);
}

/** How many board sockets this client currently has open (test builds only). */
export async function socketCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hooks = (window as unknown as {
      __vidi6?: { socketCount(): number };
    }).__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing; build the client with `--mode test`');
    return hooks.socketCount();
  });
}

/** Compare two clients' notes: same ids at the same positions. */
export function sameNotes(a: NotesOnScreen, b: NotesOnScreen, tolerance = 0.5): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.join() !== keysB.join()) return false;
  return keysA.every(
    (id) =>
      Math.abs(a[id].x - b[id].x) <= tolerance && Math.abs(a[id].y - b[id].y) <= tolerance,
  );
}

/**
 * Wait until `page` shows exactly `expected` notes at the expected positions,
 * returning how long that took — the live latency measurement (TC-22, TC-27).
 */
export async function waitForNotes(
  page: Page,
  expected: NotesOnScreen,
  timeout = 10_000,
): Promise<number> {
  const want = JSON.stringify(sortNotes(expected));
  const start = Date.now();
  await expect
    .poll(
      async () => {
        const onScreen = await notesOnScreen(page);
        const left = sortNotes(onScreen);
        const right = sortNotes(expected);
        if (left.length !== right.length) return Number.POSITIVE_INFINITY;
        return right.reduce(
          (worst, note, index) =>
            Math.max(
              worst,
              Math.abs(left[index].box.x - note.box.x),
              Math.abs(left[index].box.y - note.box.y),
            ),
          0,
        );
      },
      // Fine-grained polling: this number is the measurement in TC-27, and the
      // default 100 ms poll interval would dominate it.
      { timeout, intervals: [10] },
    )
    .toBeLessThanOrEqual(1);
  expect(JSON.stringify(sortNotes(await notesOnScreen(page)))).toBe(want);
  return Date.now() - start;
}

function sortNotes(notes: NotesOnScreen): Array<{ id: string; box: Box }> {
  return Object.entries(notes)
    .map(([id, box]) => ({ id, box }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The id of the new note this client created at `at` — looked up by position,
 * because a note the peer created at the same moment may have arrived in the
 * meantime and "the one new id" would then be ambiguous.
 */
async function newNoteIdAt(
  page: Page,
  before: Set<string>,
  at: { x: number; y: number },
): Promise<string> {
  let found = '';
  await expect
    .poll(async () => {
      found = '';
      for (const [id, box] of Object.entries(await notesOnScreen(page))) {
        if (before.has(id)) continue;
        if (
          Math.abs(box.x + box.width / 2 - at.x) <= box.width / 2 + 4 &&
          Math.abs(box.y + box.height / 2 - at.y) <= box.height / 2 + 4
        ) {
          found = id;
          break;
        }
      }
      return found === '' ? 0 : 1;
    })
    .toBe(1);
  return found;
}

/**
 * Leave the editor a freshly created note opens in, so the note can be dragged
 * and located without a textarea in the way. `editing: true` keeps it open.
 */
async function settleEditor(page: Page, editing: boolean): Promise<void> {
  if (editing) return;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sticky-textarea')).toHaveCount(0);
}

export interface CreateNoteOptions {
  /** Leave the new note in edit mode (default: false). */
  editing?: boolean;
}

/** Create a note with the toolbar button (it centres on the viewport) and return its id. */
export async function createNote(page: Page, options: CreateNoteOptions = {}): Promise<string> {
  const before = new Set(await noteIds(page));
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const centre = { x: size.width / 2, y: size.height / 2 };
  await createStickyButton(page).click();
  const id = await newNoteIdAt(page, before, centre);
  await settleEditor(page, options.editing ?? false);
  return id;
}

/**
 * Create a note by double-clicking empty board at `at` (screen coordinates).
 * Notes are 200x200 and centred on that point, so pick points far apart when a
 * test needs to grab a specific note.
 */
export async function createNoteAt(
  page: Page,
  at: { x: number; y: number },
  options: CreateNoteOptions = {},
): Promise<string> {
  const before = new Set(await noteIds(page));
  await page.mouse.dblclick(at.x, at.y);
  const id = await newNoteIdAt(page, before, at);
  await settleEditor(page, options.editing ?? false);
  return id;
}

/** Screen positions for `count` notes that never overlap each other. */
export function notePositions(count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_unused, index) => ({
    x: 250 + (index % 3) * 350,
    y: 260 + Math.floor(index / 3) * 330,
  }));
}

/** Append text to a note through the editor, then close the editor. */
export async function appendToNote(page: Page, id: string, text: string): Promise<void> {
  await noteOf(page, id).dblclick();
  await expect(editorOf(page)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editorOf(page)).toHaveCount(0);
}

/** Pick a colour for a note from its toolbar. */
export async function colourNote(page: Page, id: string, color: string): Promise<void> {
  await noteOf(page, id).click();
  await page.getByTestId(`color-${color}`).click();
}

/** Delete a note through its toolbar. */
export async function deleteNote(page: Page, id: string): Promise<void> {
  await noteOf(page, id).click();
  await page.getByTestId('delete-note').click();
}

/** Drag a note by `delta`, ending with a normal pointerup (the local commit). */
export async function dragNoteBy(
  page: Page,
  id: string,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await noteBox(page, id);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 4 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 4 });
  await page.mouse.up();
}

/** Type into a note (double-click opens the editor); the editor stays open. */
export async function typeInNote(page: Page, id: string, text: string): Promise<void> {
  await noteOf(page, id).dblclick();
  await expect(editorOf(page)).toBeVisible();
  await page.keyboard.type(text);
}

/**
 * Poll `check` until it is true, then assert it happened inside `budgetMs` — the
 * "appears live" measurement, used for every change type (TC-22).
 */
export async function expectWithin(
  budgetMs: number,
  check: () => Promise<boolean>,
  timeout = 10_000,
): Promise<number> {
  const start = Date.now();
  await expect.poll(check, { timeout, intervals: [10] }).toBe(true);
  const elapsed = Date.now() - start;
  expect(elapsed, `expected a change to appear within ${budgetMs}ms`).toBeLessThanOrEqual(budgetMs);
  return elapsed;
}

/** Jump a client's camera (test hook); all clients on one camera render alike. */
export async function setCamera(
  page: Page,
  camera: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((want) => {
    const hooks = (window as unknown as {
      __vidi6?: { setCamera(camera: { x: number; y: number; zoom: number }): void };
    }).__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing; build the client with `--mode test`');
    hooks.setCamera(want);
  }, camera);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/**
 * Wait until every client shows exactly `expectedIds` notes at the same places,
 * returning how long the slowest client took (TC-26, TC-30).
 */
export async function waitForAgreement(
  pages: readonly Page[],
  expectedIds: readonly string[],
  tolerance = 1.5,
  timeout = 10_000,
): Promise<number> {
  const want = [...expectedIds].sort().join();
  const start = Date.now();
  await expect
    .poll(
      async () => {
        const shots = await Promise.all(pages.map(notesOnScreen));
        if (!shots.every((shot) => Object.keys(shot).sort().join() === want)) return false;
        return shots.every((shot) => sameNotes(shots[0], shot, tolerance));
      },
      { timeout, intervals: [10] },
    )
    .toBe(true);
  return Date.now() - start;
}

/**
 * Record every text the connection badge shows, in order (`''` while it is
 * hidden). Sampling beats a mutation observer here because the badge is removed
 * from the DOM rather than emptied, and the "Connected" state only lasts
 * CONNECTED_CONFIRMATION_MS.
 */
export async function recordBadgeTexts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __badgeTexts: string[] };
    w.__badgeTexts = [];
    const tick = (): void => {
      const element = document.querySelector('[data-testid="connection-status"]');
      const text = element === null ? '' : (element.textContent ?? '').trim();
      if (w.__badgeTexts.at(-1) !== text) w.__badgeTexts.push(text);
    };
    tick();
    setInterval(tick, 20);
  });
}

/** The badge texts recorded since `recordBadgeTexts`, in order. */
export async function badgeTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __badgeTexts: string[] }).__badgeTexts);
}

/** `window.__vidi6.connectionState` (test builds only). */
export async function connectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState,
  );
}

/** Close the page's live board sockets: the client sees the connection drop now. */
export async function dropSockets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hooks = (window as unknown as { __vidi6?: { dropSockets(): void } }).__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is missing; build the client with `--mode test`');
    hooks.dropSockets();
  });
}
