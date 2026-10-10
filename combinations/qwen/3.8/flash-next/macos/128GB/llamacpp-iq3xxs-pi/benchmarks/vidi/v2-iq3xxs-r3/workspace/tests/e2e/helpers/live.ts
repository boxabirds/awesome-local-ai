/**
 * Shared plumbing for the multi-person e2e specs (story 3). Everything here
 * talks to a real browser page: a participant is a browser *context* of its
 * own, and every change is awaited functionally, with the wall-clock time it
 * took logged next to the budget the PRD names instead of asserted.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { dblClick, dragFrom, noteTexts, readNotes } from './notes';
import type { Point } from './board';

/** One note as one screen renders it — what "the same board" means here. */
export interface NoteView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly text: string;
}

export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors, uncaught exceptions and dialogs this page produced. */
  readonly problems: string[];
}

/** A named person: their own browser context, on one board, in sync with it. */
export async function openBoard(browser: Browser, boardId: string, name: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page error: ${error instanceof Error ? error.message : String(error)}`);
  });
  page.on('dialog', (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-app'), `${name} never got a board`).toBeVisible();
  await expect
    .poll(() => connectionState(page), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `${name} never finished connecting to the room`,
    })
    .toBe('connected');
  return { name, context, page, problems };
}

export function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6?.connectionState ?? 'nothing published');
}

/** The badge, by test id: the zoom percent shares its ARIA role. */
export function badge(page: Page): Locator {
  return page.getByTestId('connection-status');
}

/** Notes plus their text, in render order, rounded so JSON compares cleanly. */
export async function notesOf(page: Page): Promise<NoteView[]> {
  const [geometry, texts] = await Promise.all([readNotes(page), noteTexts(page)]);
  return geometry.map((note, index) => ({
    id: note.id,
    x: at(note.x),
    y: at(note.y),
    z: note.z,
    color: note.color,
    text: texts[index] ?? '',
  }));
}

/** Which notes *this screen* has selected — deliberately not part of a view. */
export function selectionOf(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.sticky-note[data-selected="true"]')).map(
      (element) => element.dataset.noteId ?? '',
    ),
  );
}

const at = (value: number): number => Math.round(value * 100) / 100;
const view = (notes: readonly NoteView[]): string => JSON.stringify(notes);

/** Every page holds exactly `count` notes and they are all the same board. */
export async function everyPageSees(pages: readonly Page[], count: number): Promise<string> {
  const lists = await Promise.all(pages.map(notesOf));
  const keys = lists.map(view);
  const problems: string[] = [];
  lists.forEach((notes, index) => {
    if (notes.length !== count) problems.push(`page ${index} has ${notes.length} note(s)`);
    if (keys[index] !== keys[0]) {
      problems.push(`page ${index} differs: ${short(keys[index])} vs ${short(keys[0] as string)}`);
    }
  });
  return problems.length === 0 ? 'identical' : problems.join(' ; ');
}

const short = (key: string): string => (key.length <= 200 ? key : `${key.slice(0, 200)}…`);

export async function expectEveryPageSees(
  pages: readonly Page[],
  count: number,
  label: string,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  await expect
    .poll(() => everyPageSees(pages, count), {
      timeout: timeoutMs,
      message: label,
    })
    .toBe('identical');
}

/**
 * Do something, then wait for the other screens to show it, and write down how
 * long that took against the budget the PRD names. The number is the point of
 * the measurement; what is asserted is only that the change arrives at all.
 */
export async function changeVisible(
  label: string,
  action: () => Promise<unknown>,
  visible: () => Promise<boolean>,
): Promise<void> {
  const started = Date.now();
  await action();
  await expect
    .poll(visible, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `${label}: the change never reached the other screen`,
    })
    .toBe(true);
  const elapsedMs = Date.now() - started;
  const verdict = elapsedMs <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER';
  console.log(`[e2e] ${label}: visible in ${elapsedMs}ms (${verdict} the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`);
}

export const sameView = (pages: readonly Page[]) => async (): Promise<boolean> => {
  const keys = await Promise.all(pages.map(async (page) => view(await notesOf(page))));
  return keys.every((key) => key === keys[0]);
};

/** Double-click empty board: a note appears in edit mode and stays selected. */
export async function createNote(page: Page, point: Point): Promise<string> {
  const before = new Set((await readNotes(page)).map((note) => note.id));
  await dblClick(page, point);
  await expect
    .poll(async () => (await readNotes(page)).length === before.size + 1, {
      message: 'double-click on empty board did not create a note',
    })
    .toBe(true);
  const created = (await readNotes(page))
    .map((note) => note.id)
    .find((id) => !before.has(id));
  if (!created) throw new Error('the new note is not there any more');
  // Creation leaves the editor open (sticky.create_button); close it, so what
  // follows is a normal selected note that can be moved and recoloured.
  await page.keyboard.press('Escape');
  // Clicking empty board deselects: the note's own toolbar floats over the
  // board next to it, and the next double-click must not land on that.
  await page.mouse.click(EMPTY_CORNER.x, EMPTY_CORNER.y);
  return created;
}

export async function noteBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`.sticky-note[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`no bounding box for note ${id}`);
  return box;
}

export async function centreOf(page: Page, id: string): Promise<Point> {
  const box = await noteBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a note by its id to a point on the screen. */
export async function dragNoteTo(page: Page, id: string, to: Point): Promise<void> {
  await dragFrom(page, await centreOf(page, id), to);
}

/** A short press on a note selects it, and only that. */
export async function selectNote(page: Page, id: string): Promise<void> {
  const centre = await centreOf(page, id);
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator(`.sticky-note[data-note-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
}

/** Go from selection to typing, stopping short of closing the editor. */
export async function startTyping(page: Page, id: string, caret: 'start' | 'end' = 'end'): Promise<void> {
  await selectNote(page, id);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sticky-textarea')).toBeVisible();
  await page.keyboard.press(caret === 'start' ? 'Home' : 'End');
}

export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sticky-textarea')).toHaveCount(0);
}

/** Watch the badge from inside the page, so a 2-second state cannot be missed. */
export function watchBadge(page: Page): Promise<void> {
  return page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __badgeLog: string[] }).__badgeLog = log;
    const current = (): string =>
      document.querySelector<HTMLElement>('[data-testid="connection-status"]')?.textContent ?? '';
    const record = (): void => {
      const text = current();
      if (log.at(-1) !== text) log.push(text);
    };
    record();
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

export function badgeLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __badgeLog: string[] }).__badgeLog);
}

/**
 * Wait until every screen shows this note where the page that moved it shows
 * it: a move that only the mover can see has not happened yet.
 */
export function everyoneSeesNoteInPlace(
  from: Page,
  pages: readonly Page[],
  id: string,
): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    const moved = (await notesOf(from)).find((note) => note.id === id);
    if (!moved) return false;
    const lists = await Promise.all(pages.map(notesOf));
    return lists.every((notes) => {
      const note = notes.find((candidate) => candidate.id === id);
      return note !== undefined && note.x === moved.x && note.y === moved.y;
    });
  };
}

/** Put the whole board on one screen, so many notes never overlap. */
export function zoomOut(page: Page, zoom: number): Promise<void> {
  return page.evaluate((level) => {
    const api = window.__vidi6;
    if (!api) throw new Error('window.__vidi6 is missing; build the client with `npm run build:test`');
    api.setCamera({ ...api.getCamera(), zoom: level });
  }, zoom);
}

/**
 * Empty board points, far enough apart that notes and the toolbar of the
 * selected one never stand under the next double-click. `slot(column, row)`
 * belongs to one person and one note.
 */
export function slot(column: number, row: number): Point {
  return { x: 160 + column * 220, y: 150 + row * 120 };
}

/** Somewhere on the board with nothing on it, in every test's viewport. */
export const EMPTY_CORNER = { x: 1240, y: 110 };

/**
 * Watch the published connection state from inside the page: the badge is out
 * of the way while everything is normal, so a test that asks "did this board
 * ever lose the room?" watches the state the badge is built from (TC-29).
 */
export function watchConnection(page: Page): Promise<void> {
  return page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __connectionLog: string[] }).__connectionLog = log;
    const record = (): void => {
      const state = window.__vidi6?.connectionState ?? 'nothing published';
      if (log.at(-1) !== state) log.push(state);
    };
    record();
    const timer = setInterval(record, 200);
    window.addEventListener('pagehide', () => {
      clearInterval(timer);
    });
  });
}

/** The states this page has been in, consecutive duplicates folded away. */
export function connectionStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __connectionLog: string[] }).__connectionLog);
}
