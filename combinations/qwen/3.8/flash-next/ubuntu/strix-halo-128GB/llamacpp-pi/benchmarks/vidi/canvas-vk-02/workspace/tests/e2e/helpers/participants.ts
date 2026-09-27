/**
 * tests/e2e/helpers/participants.ts
 *
 * Multiple people on one board, in one test.
 *
 * Every participant is a separate browser *context* — cookies, storage and
 * BroadcastChannel are all isolated, so the only way two of them can share
 * anything is the server. They open the same `/b/<boardId>` address, and the
 * helper does not hand them back until they have proved they can see each
 * other: a note is created, everyone sees it, it is deleted, everyone sees that.
 * Without that warm-up the first change of a test would be measured with the
 * connection setup inside its latency, and the budget is about edits.
 */
import { expect, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

/** How a note looks in the DOM: everything another person would notice. */
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
  readonly page: Page;
  readonly context: BrowserContext;
  /** Anything the page complained about, for the tests that must not. */
  readonly errors: string[];
}

/** A board address no other test will use. */
export function boardUrl(boardId: string): string {
  return `/b/${boardId}`;
}

/** The badge's text, or `null` when the badge is hidden. */
export async function badgeText(page: Page): Promise<string | null> {
  return (await page.getByTestId('connection-status').textContent().catch(() => null));
}

/** The connection state the page has mapped, from the test build's hook. */
export function connectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState,
  );
}

/** Every note on the page, in a stable order, as the DOM holds it. */
export function notesOn(page: Page): Promise<NoteView[]> {
  return page
    .getByTestId('sticky-note')
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const el = element as HTMLElement;
          return {
            id: el.dataset.id ?? '',
            x: Number.parseFloat(el.style.left),
            y: Number.parseFloat(el.style.top),
            z: Number(el.dataset.z ?? '0'),
            color: el.dataset.color ?? '',
            text: (el.querySelector('.sticky-note__text')?.textContent ?? '').trim(),
          } satisfies NoteView;
        })
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
}

/** One note by id, or `undefined` when this page does not have it. */
export async function noteOn(page: Page, id: string): Promise<NoteView | undefined> {
  return (await notesOn(page)).find((note) => note.id === id);
}

/**
 * Something worth waiting for, in a way that says what it waited for and gives
 * up on the delivery budget rather than on Playwright's default.
 */
export function expectDelivered(
  what: string,
  probe: () => Promise<boolean>,
  budgetMs = LIVE_UPDATE_LATENCY_BUDGET_MS,
): Promise<void> {
  return expect
    .poll(probe, { timeout: budgetMs, message: `${what} did not arrive within ${budgetMs}ms` })
    .toBe(true);
}

/** Open one participant's board and wait until their badge says all is well. */
async function openPage(name: string, browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const participant: Participant = { name, page, context, errors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') participant.errors.push(message.text());
  });
  page.on('pageerror', (error) => participant.errors.push(String(error)));

  await page.goto(boardUrl(boardId));
  await expect(page.getByTestId('board'), `${name}: board did not render`).toBeVisible();
  await expect
    .poll(() => connectionState(page), { timeout: 15_000, message: `${name}: never connected` })
    .toBe('connected');
  return participant;
}

/**
 * `count` participants on the same board, able to see each other.
 *
 * The warm-up is part of opening: without it a test's first edit is timed across
 * connection setup, and the budget is about edits.
 */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  const names = ['Alex', 'Sam', 'Riley', 'Jo', 'Max', 'Priya', 'Dee'];
  const people: Participant[] = [];
  for (let i = 0; i < count; i++) {
    people.push(await openPage(names[i] ?? `P${i + 1}`, browser, boardId));
  }

  // Prove the mesh is live: one note, seen by everybody, then deleted.
  const first = people[0] as Participant;
  await first.page.getByTestId('create-sticky').click();
  await expect
    .poll(
      async () => {
        for (const person of people) {
          if ((await notesOn(person.page)).length !== 1) return false;
        }
        return true;
      },
      { timeout: 10_000, message: 'participants did not share the warm-up note' },
    )
    .toBe(true);

  const [warmUp] = await notesOn(first.page);
  if (warmUp === undefined) throw new Error('warm-up note disappeared before it could be removed');
  await first.page.keyboard.press('Escape');
  await first.page.keyboard.press('Delete');
  await expect
    .poll(
      async () => {
        for (const person of people) {
          if ((await notesOn(person.page)).length !== 0) return false;
        }
        return true;
      },
      { timeout: 10_000, message: 'participants did not share the warm-up delete' },
    )
    .toBe(true);

  return people;
}

/**
 * Open participants, run a test body with them, and close their contexts
 * whatever the body did — a failed assertion in a collaboration test leaves
 * browsers otherwise, and the next test pays for it.
 */
export async function withParticipants<T>(
  browser: Browser,
  boardId: string,
  count: number,
  run: (people: Participant[]) => Promise<T>,
): Promise<T> {
  const people = await openParticipants(browser, boardId, count);
  try {
    return await run(people);
  } finally {
    await closeParticipants(people);
  }
}

/** Close every participant's browser context. */
export async function closeParticipants(people: readonly Participant[]): Promise<void> {
  for (const person of people) await person.context.close().catch(() => undefined);
}

/**
 * Cut a participant off from the network, and bring them back.
 *
 * Chromium goes through the devtools protocol because that is what actually
 * stops an established WebSocket: `context.setOffline` holds new HTTP requests
 * back, and a board whose socket is quietly alive is not an outage. Elsewhere
 * `setOffline` is the best the harness can do.
 */
const outages = new WeakMap<object, CDPSession>();

export async function setOutage(person: Participant, offline: boolean): Promise<void> {
  const isChromium = person.page.context().browser()?.browserType().name() === 'chromium';
  if (!isChromium) {
    await person.context.setOffline(offline);
    return;
  }

  // One session per participant, reused to switch the network back on: an
  // emulation set through one session is not undone by another.
  let cdp = outages.get(person);
  if (cdp === undefined) {
    cdp = await person.context.newCDPSession(person.page);
    outages.set(person, cdp);
  }
  await cdp.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}
