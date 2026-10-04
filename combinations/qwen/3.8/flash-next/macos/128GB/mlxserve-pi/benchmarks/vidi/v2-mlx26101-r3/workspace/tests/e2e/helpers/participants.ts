/// <reference path="../../../src/client/testHooks.ts" />
/**
 * Several browsers, on one board, in one test.
 *
 * Story 3 is about what one person sees when another person edits, so a test needs more than
 * one page and more than one browser profile: each participant gets their own context, which is
 * what two people on two machines actually are. Two tabs of one profile would sync through the
 * broadcast channel and prove nothing, which is why the client does not use one at all.
 */

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';
import { board, createBoard } from './board';
import { boardPath } from '../../../src/client/router';

/** Everything a note shows on screen, as one comparable value. */
export interface NoteFace {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
  selected: boolean;
}

export interface Person {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /**
   * Anything this browser complained about: a console error, an uncaught exception, a request
   * that failed, a dialog put up. A steady board should add nothing to this; the tests that
   * break the network on purpose should not read it at all, because reconnecting is logged.
   */
  readonly problems: string[];
}

/**
 * Open a board by address, the way a person does from a link.
 *
 * The message on the wait is part of the helper: since story 5 an address that leads nowhere is an
 * answer rather than a board, so a test that invented an id instead of asking for one fails here
 * with the reason, not with a timeout on a canvas.
 */
export async function openBoardAt(page: Page, boardId: string): Promise<void> {
  await page.goto(boardPath(boardId));
  await expect(
    board(page),
    'a board should open from its link. If this page says "Board not found", the board was never '
      + 'created: make it with createBoard() or openBoard() rather than writing an id down.',
  ).toBeVisible();
}

/** The connection message, whatever it says. */
export const badge = (page: Page) => page.getByTestId('connection-status');

/** The words on the connection message, or null while it shows nothing. */
export async function badgeText(page: Page): Promise<string | null> {
  const element = badge(page);
  return (await element.count()) === 0 ? null : (await element.textContent());
}

/**
 * Wait until this page is connected to the room.
 *
 * The badge is the readout: it says "Connecting..." until the board has been exchanged, and
 * says nothing at all afterwards. So an absent badge is not "nothing happened yet" - it is the
 * settled state of a board that is in sync with its room.
 */
export async function waitConnected(page: Page): Promise<void> {
  await expect(badge(page), 'the board should be connected to its room').toHaveCount(0, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
}

/** Everything the board shows, notes in id order, as one string. */
export async function faceJson(page: Page): Promise<string> {
  return JSON.stringify(await faces(page));
}

/**
 * The notes as their own page draws them. Selection is included, because it belongs to the
 * person holding the mouse and must never travel: two people looking at the same board see the
 * same notes and choose for themselves which one each of them is holding.
 */
export async function faces(page: Page): Promise<NoteFace[]> {
  const faces = await page.evaluate(() => {
    const textIn = (note: Element): string => {
      const text = note.querySelector('[data-testid="sticky-note-text"]');
      if (text !== null) {
        return text.textContent ?? '';
      }
      // While it is being edited, the note shows the editor instead of the text it holds; the
      // editor holds the same text, which is the only way it can end up in the document.
      const field = note.querySelector('[data-testid="sticky-note-editor"]');
      return field === null ? '' : (field as HTMLTextAreaElement).value;
    };
    return [...document.querySelectorAll('[data-sticky-note]')].map((note) => ({
      id: note.getAttribute('data-note-id') ?? '',
      x: Number.parseFloat(note.getAttribute('data-x') ?? 'NaN'),
      y: Number.parseFloat(note.getAttribute('data-y') ?? 'NaN'),
      z: Number.parseFloat(note.getAttribute('data-z') ?? 'NaN'),
      color: note.getAttribute('data-color') ?? '',
      text: textIn(note),
      selected: note.getAttribute('data-selected') === 'true',
    }));
  });
  return faces.slice().sort((a, b) => a.id.localeCompare(b.id));
}

/** The same, without who is holding what: what the board itself says. */
export async function boardJson(page: Page): Promise<string> {
  const shown = await faces(page);
  return JSON.stringify(
    shown.map(({ id, x, y, z, color, text }) => ({ id, x, y, z, color, text })),
  );
}

/** The person holding the mouse is not part of what the board says. */
export function unheld(faces: readonly NoteFace[]): Omit<NoteFace, 'selected'>[] {
  return faces.map(({ id, x, y, z, color, text }) => ({ id, x, y, z, color, text }));
}

/**
 * Wait until every person's page draws the same board, and give back what they all ended up
 * showing. The wait is the functional one (E2E_EVENTUAL_TIMEOUT_MS): how long a change takes
 * is measured and printed, never asserted.
 */
export async function waitForSameBoard(people: readonly Person[]): Promise<string> {
  await expect
    .poll(
      async () => new Set(await Promise.all(people.map((person) => boardJson(person.page)))).size,
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [10, 25, 50],
        message: 'every page should end up showing the same board',
      },
    )
    .toBe(1);
  return boardJson(people[0]!.page);
}

/**
 * Do something on one page, and wait until another page shows it.
 *
 * Returns how long the change took to arrive, and prints it against the budget. The print is
 * the point: a change that arrives in 5 s is a failure worth noticing, and an assertion that
 * waits 15 s for it would only ever say "passed".
 */
export async function measureChange(
  what: string,
  edit: () => Promise<void>,
  arrived: () => Promise<boolean>,
): Promise<number> {
  const started = Date.now();
  await edit();
  await expect
    .poll(arrived, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [10, 25, 50] })
    .toBe(true);
  const elapsed = Date.now() - started;
  const budget = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'over';
  console.log(
    `[latency] ${what}: ${elapsed}ms (${budget} the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`,
  );
  return elapsed;
}

/**
 * This person's connection to the room dies, and stays dead until {@link restoreConnection}
 * says otherwise.
 *
 * Both halves are needed, and neither one is enough on its own. Offline emulation does not
 * disturb a connection that is already open - measured, not assumed: with the context offline
 * the other person's notes kept arriving for a minute - and dropping the socket on its own
 * would be a momentary blip, because the client is supposed to get straight back on the phone.
 * Offline first, then the socket: there is no gap in which a reconnect can slip through, and
 * from here on this person is a browser with no network holding a board it cannot reach.
 *
 * What the test does not do is notice, retry, or catch up: those are the client's own doing,
 * which is the thing the story is about.
 */
export async function loseConnection(person: Person): Promise<void> {
  await person.context.setOffline(true);
  const dropped = await person.page.evaluate(() => {
    if (typeof window.__vidi6?.dropConnection !== 'function') {
      return false;
    }
    window.__vidi6.dropConnection();
    return true;
  });
  expect(
    dropped,
    'window.__vidi6.dropConnection should exist in the test build - the server on this port ' +
      'is serving a bundle built without the test hooks, most likely because "npm run build" ' +
      '(production) writes to the same folder: run "npm run build:test" and try again',
  ).toBe(true);
}

/** This person has their network back; their own retries can get through again. */
export async function restoreConnection(person: Person): Promise<void> {
  await person.context.setOffline(false);
}

/**
 * Wait out `ms` with the badge saying `text` the whole way: an interruption is not over when
 * the client gives up trying, and a badge that flickers to "connected" between two failed
 * handshakes is a lie about the board.
 */
export async function stayShowing(page: Page, text: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await expect(badge(page), `the badge should still say ${text}`).toHaveText(text, {
      timeout: 5_000,
    });
    await page.waitForTimeout(500);
  }
}

/** Watch the badge from inside the page, so a message that is only up briefly cannot be missed. */
export async function watchBadge(page: Page): Promise<(string | null)[]> {
  const seen: (string | null)[] = [];
  await page.exposeFunction('__vidi6Badge', (text: string | null) => {
    const last = seen[seen.length - 1];
    if (last !== text) {
      seen.push(text);
    }
  });
  await page.evaluate(() => {
    const read = (): string | null => {
      const element = document.querySelector('[data-testid="connection-status"]');
      return element === null ? null : element.textContent;
    };
    const report = (): void => {
      void (window as unknown as { __vidi6Badge(t: string | null): Promise<void> }).__vidi6Badge(
        read(),
      );
    };
    report();
    new MutationObserver(report).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  return seen;
}

/** The note this page is editing right now, whichever note is on top of the stack. */
export async function editingNoteId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const field = document.querySelector('[data-testid="sticky-note-editor"]');
    const note = field === null ? null : field.closest('[data-sticky-note]');
    return note === null ? null : note.getAttribute('data-note-id');
  });
  if (id === null) {
    throw new Error('this page is not editing a note');
  }
  return id;
}

/** Say how long one change took to cross, against the budget, without asserting anything. */
export function logLatency(what: string, startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  const budget = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'over';
  console.log(
    `[latency] ${what}: ${elapsed}ms (${budget} the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`,
  );
  return elapsed;
}

/** Say how long a whole scenario took. No budget applies to a batch of thirty gestures. */
export function logScenario(what: string, startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  console.log(`[scenario] ${what}: ${(elapsed / 1000).toFixed(2)}s across the browsers`);
  return elapsed;
}

/** Everything a page's badge said, as one readable string. */
export function badgeStory(seen: readonly (string | null)[]): string {
  return seen.map((text) => text ?? '(hidden)').join(' -> ');
}

/** Watch a page for anything it complains about. */function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console.error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`uncaught: ${error.message}`);
  });
  page.on('dialog', (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return problems;
}

/**
 * Ask the service for a board from a browser that has no page to spare.
 *
 * A browser context can make a request of its own, which is the smallest possible way to want a
 * board: nobody is looking at anything, and the answer is an id that people can then be sent to.
 */
async function createBoardOfOne(browser: Browser, at: string | undefined): Promise<string> {
  const context = await browser.newContext(at === undefined ? {} : { baseURL: at });
  try {
    return await createBoard(context.request);
  } finally {
    await context.close();
  }
}

/**
 * The people on one board. Every test gets a board nobody else is on, because the room is
 * real and outlives the page that opened it, and every test hangs up at the end.
 */
export class Cast {
  readonly boardId: string;
  readonly people: Person[] = [];
  private readonly browser: Browser;
  private readonly at: string | undefined;

  private constructor(browser: Browser, boardId: string, at: string | undefined) {
    this.browser = browser;
    this.boardId = boardId;
    this.at = at;
  }

  /** A board nobody has opened before, with `names` people arriving on it together. */
  static async open(browser: Browser, ...names: string[]): Promise<Cast> {
    return Cast.openAt(undefined, browser, ...names);
  }

  /**
   * The same, with `at` saying where the board is served from - or `undefined`, meaning whatever
   * address the run is configured with, which is what every other test wants.
   *
   * The ordinary tests are pointed at one address by the project's `baseURL`, which is right when
   * one server answers the whole run. A test that starts its own service - and story 4 has to, in
   * order to stop one - cannot say in advance which port it will get, so it says where the board is
   * instead. Contexts are given it, and the pages open the board by path as ever.
   */
  static async openAt(
    at: string | undefined,
    browser: Browser,
    ...names: string[]
  ): Promise<Cast> {
    // The board is asked for, and its id is what the service answers with. Since story 5 there is
    // no other way for a board to begin, and a room that somebody connects to on its own is not a
    // board - it is an address with a stranger at it. So this is the one place a Cast's board comes
    // from, and it is the same request the home page's button makes.
    const boardId = await createBoardOfOne(browser, at);
    const cast = new Cast(browser, boardId, at);
    for (const name of names) {
      await cast.add(name);
    }
    // Everybody is in the room before the first test action: otherwise a test's first edit
    // could be missed by someone still loading, and that is a race in the test, not in the
    // product.
    await Promise.all(cast.people.map((person) => waitConnected(person.page)));
    return cast;
  }

  /** Another person opening the same board, which is how a late joiner arrives. */
  async add(name: string): Promise<Person> {
    const context = await this.browser.newContext(this.at === undefined ? {} : { baseURL: this.at });
    const page = await context.newPage();
    const person: Person = { name, context, page, problems: watchProblems(page) };
    this.people.push(person);
    await openBoardAt(page, this.boardId);
    return person;
  }

  by(name: string): Person {
    const person = this.people.find((candidate) => candidate.name === name);
    if (person === undefined) {
      throw new Error(`nobody called ${name} is on this board`);
    }
    return person;
  }

  /** Names of everyone on the board, in the order they arrived. */
  get names(): string[] {
    return this.people.map((person) => person.name);
  }

  async close(): Promise<void> {
    for (const person of this.people) {
      await person.context.close();
    }
    this.people.length = 0;
  }
}
