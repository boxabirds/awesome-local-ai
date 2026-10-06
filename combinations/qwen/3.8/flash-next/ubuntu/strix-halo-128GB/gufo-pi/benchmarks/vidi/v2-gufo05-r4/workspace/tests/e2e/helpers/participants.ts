/**
 * More than one person at the board, in one test.
 *
 * A `Session` opens isolated browser contexts — separate profiles, so nothing is
 * shared between them but the board — points them all at the same `/b/<id>`, and
 * waits until each has finished its first sync. Isolation matters: two tabs in one
 * context could in principle hear each other without the server, and the whole
 * point of these tests is that they cannot.
 *
 * `eventually` is how a change is asserted. Live collaboration is eventually
 * consistent, so a test says what should become true and lets Playwright wait for
 * it, up to the functional timeout in the settings. Each wait is also timed, and
 * the measurement is *reported* against `LIVE_UPDATE_LATENCY_BUDGET_MS` rather than
 * asserted: the model, the browsers and the server all share one machine here, so
 * a budget that this box can meet would fail on a slower one and pass on this one
 * even when the real thing was slow. `report` prints them at the end of the test.
 */

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';
import { createBoardOn, waitForBoard } from './board';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import type { ConnectionState } from '../../../src/client/sync/connectBoard';

/* Re-exported because story 5's specs ask for a board by name, and `board.ts` is where making
   one now lives. */
export { createBoardOn };

/** One person at the board: a context of their own and a page inside it. */
export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Every console error and uncaught exception this page has reported. */
  readonly errors: string[];
}

/** One measured change. */
export interface Latency {
  readonly what: string;
  readonly ms: number;
  readonly overBudget: boolean;
}

export interface Session {
  readonly boardId: string;
  readonly people: Participant[];
  readonly latencies: Latency[];
  /** The person by name, failing loudly when the session has no such person. */
  person(name: string): Participant;
  /** Wait until every person's board holds the same notes. */
  everyoneSees(what: string, count: number): Promise<void>;
  /**
   * Wait for something to become true, and record how long it took. `check` returns
   * `true`, or a string explaining what it found instead, which is what a failing
   * wait prints.
   */
  eventually(what: string, check: () => Promise<boolean | string> | boolean | string): Promise<void>;
  /** Print the latency measurements against the budget. */
  report(): void;
  close(): Promise<void>;
}

/** What one page's board holds, straight out of the rendered document. */
export async function boardOf(page: Page): Promise<unknown[]> {
  const notes = await page.evaluate(() => window.__vidi6?.getBoard());
  if (!notes) throw new Error('window.__vidi6 test hook is not available in this build');
  return [...notes];
}

/**
 * Cut a page's socket and stop it reconnecting, so the outage starts where a real
 * one does: at the link, not at the browser's idea of the network.
 *
 * Playwright's `setOffline` only fails *new* requests — an established WebSocket
 * carries on working and nobody notices — so the board exposes `dropConnection` in
 * test builds. Optionally keep the endpoint unreachable meanwhile, which is what
 * turns "disconnected" into "kept trying and failing": handshakes to the room
 * endpoint are refused until the returned function is called.
 */
export async function takeLinkAway(
  page: Page,
  options: { refuseReconnects?: boolean } = {}
): Promise<() => Promise<void>> {
  await page.evaluate(() => window.__vidi6?.dropConnection());
  if (!options.refuseReconnects) {
    return async () => {
      await page.evaluate(() => window.__vidi6?.resumeConnection());
    };
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/rooms/*', requestStage: 'Request' }]
  });
  const refuse = (event: { requestId: string }) => {
    void cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionRefused' });
  };
  cdp.on('Fetch.requestPaused', refuse);
  return async () => {
    cdp.off('Fetch.requestPaused', refuse);
    await cdp.send('Fetch.disable');
    await page.evaluate(() => window.__vidi6?.resumeConnection());
  };
}

/** The connection state a page currently reports. */
export async function connectionOf(page: Page): Promise<ConnectionState | undefined> {
  return page.evaluate(() => window.__vidi6?.connectionState);
}

/** The notes as the DOM draws them: position, colour and text, note by note. */
export async function domOf(page: Page): Promise<string> {
  const rows = await page.$$eval('[data-vidi6="sticky"]', (elements: HTMLElement[]) =>
    elements.map((element) =>
      [
        element.dataset.noteId ?? '',
        element.dataset.x ?? '',
        element.dataset.y ?? '',
        element.dataset.color ?? '',
        element.dataset.selected ?? ''
      ].join(',')
    )
  );
  return JSON.stringify(rows);
}

/**
 * Open a board at `boardId` and wait until it has synced with the room.
 *
 * `origin` points the page somewhere other than the run's base URL — the persistence
 * tests run their own dev server on a port of their own, because they switch it off
 * and back on again.
 */
export async function openBoardAt(page: Page, boardId: string, origin = ''): Promise<void> {
  await page.goto(`${origin}/b/${boardId}`);
  await waitForBoard(page);
  await expect
    .poll(() => connectionOf(page), { message: 'the board should be in sync with its room' })
    .toBe('connected');
}

/**
 * Open one board with one context per name, all synced.
 *
 * Names are for the failure messages: when a wait fails, "sam" means more than an
 * index.
 */
export async function openSession(
  browser: Browser,
  names: string[],
  options: {
    origin?: string;
    /**
     * Do something to a person's context before their page exists — for the one case that has
     * to be true of the *wire* from the first frame, such as stopping one person's outgoing
     * messages so two people's changes can be made to overlap on purpose.
     */
    beforeOpen?: (context: BrowserContext, name: string) => Promise<void>;
  } = {}
): Promise<Session> {
  // Created first, through the API: a page that arrived at an address nobody had made would
  // correctly be told Board not found, and would spend the rest of the test waiting for a
  // board that is never coming.
  const boardId = await createBoardOn(options.origin ?? BASE_URL);
  const people: Participant[] = [];

  for (const name of names) {
    // A context of its own: no shared storage, no shared sockets, and no
    // BroadcastChannel even if the app had one.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (options.beforeOpen) await options.beforeOpen(context, name);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      // A missing favicon is not a broken board.
      if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) {
        errors.push(`console: ${message.text()}`);
      }
    });
    people.push({ name, context, page, errors });
    // One after another, so "who saw what first" stays answerable.
    await openBoardAt(page, boardId, options.origin ?? BASE_URL);
  }

  const latencies: Latency[] = [];
  const session: Session = {
    boardId,
    people,
    latencies,
    person(name: string): Participant {
      const found = people.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`the session has no participant called ${name}`);
      return found;
    },
    async everyoneSees(what: string, count: number): Promise<void> {
      await session.eventually(what, async () => {
        for (const person of people) {
          const notes = await boardOf(person.page);
          if (notes.length !== count) return `${person.name} holds ${notes.length} note(s)`;
        }
        return true;
      });
    },
    async eventually(what, check): Promise<void> {
      const started = Date.now();
      await expect
        .poll(
          async () => {
            try {
              const outcome = await check();
              return outcome === true ? true : String(outcome);
            } catch (error) {
              // A page mid-navigation or a document not yet written: keep waiting.
              return `threw: ${error instanceof Error ? error.message : String(error)}`;
            }
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: what }
        )
        .toBe(true);
      const ms = Date.now() - started;
      latencies.push({ what, ms, overBudget: ms > LIVE_UPDATE_LATENCY_BUDGET_MS });
    },
    report(): void {
      const over = latencies.filter((entry) => entry.overBudget).length;
      const lines = latencies.map(
        (entry) =>
          `    ${entry.ms}ms  ${entry.overBudget ? 'OVER ' : '      '}${entry.what}`
      );
      console.log(
        [
          `  latency report for board ${boardId} (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted):`,
          ...lines,
          `  ${latencies.length} change(s), ${over} over budget`
        ].join('\n')
      );
    },
    async close(): Promise<void> {
      for (const person of people) await person.context.close();
    }
  };

  return session;
}

/** Close a session whatever happened to it. */
export async function closeSessions(sessions: Session[]): Promise<void> {
  const pending = [...sessions];
  sessions.length = 0;
  for (const session of pending) await session.close();
}

/** A note's world position on a given page, or null when it is not there. */
export async function positionOf(
  page: Page,
  noteId: string
): Promise<{ x: number; y: number } | null> {
  const notes = (await boardOf(page)) as { id: string; x: number; y: number }[];
  const note = notes.find((candidate) => candidate.id === noteId);
  return note ? { x: note.x, y: note.y } : null;
}
