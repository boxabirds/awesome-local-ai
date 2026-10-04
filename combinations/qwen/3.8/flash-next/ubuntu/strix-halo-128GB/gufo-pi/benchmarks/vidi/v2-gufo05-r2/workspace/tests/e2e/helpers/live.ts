/**
 * Helpers for the live-collaboration e2e tests: several people, each in their
 * own browser context, on the same board URL.
 *
 * Every participant collects its own console and uncaught errors, because "the
 * other person's screen did not fall over" is part of most of these cases.
 */

import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { getNotes, noteBoxes, type NoteBox } from './notes';
import { expectNoPendingCameraFrame, type Pixel } from './board';

export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors and uncaught exceptions, in the order they appeared. */
  readonly errors: string[];
}

/** Open one board as `names`, one person per browser context. */
export async function openBoardAs(
  browser: Browser,
  boardId: string,
  names: string[],
): Promise<Participant[]> {
  const people: Participant[] = [];
  for (const name of names) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    people.push({ name, context, page, errors });
  }
  return people;
}

/** The connection badge, which only exists while there is something to report. */
export function badge(page: Page) {
  return page.getByTestId('connection-status');
}

/**
 * Double-click empty board and return the note that appeared there.
 *
 * Story 2's equivalent finds the new note by diffing ids, which stops working the
 * moment several people work at once: more than one id is new at the same time.
 * Here the note is picked by where it is — the one that appeared centred under the
 * pointer — so five people creating simultaneously is fine.
 */
export async function createNoteAt(page: Page, at: Pixel): Promise<string> {
  const before = new Set((await getNotes(page)).map((note) => note.id));
  await page.mouse.dblclick(at.x, at.y);
  await expectNoPendingCameraFrame(page);
  const boxes: Record<string, NoteBox> = await noteBoxes(page);
  const created = (await getNotes(page)).filter((note) => !before.has(note.id));
  const here = created.find((note) => {
    const box = boxes[note.id];
    return (
      !!box &&
      Math.abs(box.x + box.width / 2 - at.x) < 3 &&
      Math.abs(box.y + box.height / 2 - at.y) < 3
    );
  });
  if (!here) {
    throw new Error(
      `no note appeared at (${at.x}, ${at.y}); ${created.length} note(s) appeared just now`,
    );
  }
  // Creating starts editing, which the caller types into.
  await expect(page.locator(`[data-note-id="${here.id}"] textarea`)).toBeVisible();
  return here.id;
}

/**
 * Start editing a note by name of its id, without the browser hit-testing the point.
 *
 * A busy board has toolbars and neighbouring notes in the way, and a real click that
 * waits for a covered element waits for a long time. The app's own double-click
 * handler still runs, so what follows is the ordinary editing path.
 */
/** Click the middle of a note, which selects it and brings up its toolbar. */
export async function selectNote(page: Page, id: string): Promise<void> {
  const box = (await noteBoxes(page))[id];
  if (!box) throw new Error(`note ${id} is not on this screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('note-toolbar')).toBeVisible({ timeout: 5_000 });
}

/**
 * Press a button in the note's toolbar.
 *
 * The toolbar floats above the selected note and its row is re-rendered as other
 * people's changes arrive, so a real mouse click can spend a very long time waiting for
 * the button to stop moving and stay attached. The button's own click handler is
 * dispatched instead: what is under test is the app's response to the press, which is
 * the same one a finger produces.
 */
async function pressNoteToolbarButton(page: Page, label: string): Promise<void> {
  await page.evaluate((accessibleName) => {
    const toolbar = document.querySelector('[data-testid="note-toolbar"]');
    const button = toolbar?.querySelector<HTMLElement>(`[aria-label="${accessibleName}"]`);
    if (!button) throw new Error(`the note toolbar has no "${accessibleName}" button`);
    button.click();
  }, label);
}

/** Pick a colour for a note from its toolbar, the way a person does. */
export async function recolourNote(page: Page, id: string, colour: string): Promise<void> {
  await selectNote(page, id);
  await pressNoteToolbarButton(page, `${colour.charAt(0).toUpperCase()}${colour.slice(1)} colour`);
}

/** Delete a note with the toolbar's delete button. */
export async function deleteNoteViaToolbar(page: Page, id: string): Promise<void> {
  await selectNote(page, id);
  await pressNoteToolbarButton(page, 'Delete note');
  await expect(page.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
}

export async function startEditingNote(page: Page, id: string): Promise<void> {
  await page.evaluate((noteId) => {
    const el = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!el) throw new Error(`note ${noteId} is not on this screen`);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }, id);
  await expect(page.locator(`[data-note-id="${id}"] textarea`)).toBeVisible();
}

/** The whole board as one string, for comparing what two screens hold. */
export async function boardJson(page: Page): Promise<string> {
  return JSON.stringify(await getNotes(page));
}

/** Close every participant's context. */
export async function closeAll(people: readonly Participant[]): Promise<void> {
  for (const person of people) await person.context.close();
}

export interface LiveBoards {
  /**
   * Open a brand-new board as `names`, one participant per browser context. The
   * board id is returned so a test can open the same board for more people, and
   * every context is closed when the test ends.
   */
  open(names: string[]): Promise<{ boardId: string; people: Participant[] }>;
}

/**
 * The e2e test object: like Playwright's, plus `liveBoards`, which hands out
 * participants on a shared board and cleans them up afterwards.
 */
export const test = base.extend<{ liveBoards: LiveBoards }>({
  liveBoards: async ({ browser, request }, use) => {
    const opened: Participant[] = [];
    await use({
      async open(names: string[]) {
        // A board is created, not invented: this is the same request the home page's
        // button makes, and the id it hands back is the link a person would share.
        const response = await request.post('/api/boards');
        if (!response.ok()) {
          throw new Error(`could not create a board for the test: ${response.status()}`);
        }
        const { id } = (await response.json()) as { id: string };
        const boardId = id;
        const people = await openBoardAs(browser, boardId, names);
        opened.push(...people);
        return { boardId, people };
      },
    });
    await closeAll(opened);
  },
});

export { expect };

/**
 * Do something on one screen and wait for it to show up on the others, reporting
 * how long it took. Latency against LIVE_UPDATE_LATENCY_BUDGET_MS is logged, not
 * asserted: model, browsers and server share this one machine.
 */
export async function changeArrives(
  label: string,
  act: () => Promise<void>,
  arrived: () => Promise<boolean>,
): Promise<number> {
  await act();
  const started = Date.now();
  await expect
    .poll(arrived, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `${label}: change did not arrive` })
    .toBe(true);
  const elapsed = Date.now() - started;
  console.log(
    `${label}: arrived in ${elapsed} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms` +
      `${elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS ? ', over on this shared machine' : ''})`,
  );
  return elapsed;
}

/**
 * Chrome prints a console error for every WebSocket it cannot connect, so cutting the
 * network on purpose (TC-27) produces a stream of them. That is the outage talking, not
 * the app: the app's own behaviour — reconnecting, catching up, saying so — is what
 * these tests look at.
 */
const CONNECTION_NOISE = /WebSocket connection to .* failed|net::ERR_INTERNET_DISCONNECTED/;

/** Nothing on any of these screens went wrong. */
export function expectNoErrors(people: readonly Participant[]): void {
  for (const person of people) {
    const problems = person.errors.filter((line) => !CONNECTION_NOISE.test(line));
    expect(`${person.name}: ${problems.join('\n')}`).toBe(`${person.name}: `);
  }
}
