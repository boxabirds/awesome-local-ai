import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * Getting onto a board, for suites that are not about boards themselves.
 *
 * Story 5 changed what `/` means. It used to be a board with a random address;
 * now it is the home page, and a board only exists once something has created
 * one. That is the whole point of the story — an address nobody created must
 * not quietly become a blank board — but it also means every suite that needs
 * "a board I can draw on" now has to say so, and this file is where that is
 * said once.
 *
 * ## Why the requests carry a made-up client address
 *
 * Board creation is rate limited per visitor: ten boards a minute, keyed on the
 * visitor's address (`share.rate_limit`). Every browser in this suite comes from
 * this machine, so left alone they are *one* visitor, and the suite's hundred-odd
 * boards would spend the allowance inside the first minute and then fail with a
 * 429 that has nothing to do with whatever the test was checking.
 *
 * So each test is given its own `CF-Connecting-IP`. That header is how Workers
 * reports the client address, and `wrangler dev` passes through what the client
 * sends — which is also how the integration tests fake different visitors
 * (TC-13). This is a test harness standing in for different people, not a way
 * of switching the limit off: the limit still applies, still counts, and a test
 * that wants to see it fire can still make it fire (see `share.spec.ts` TC-29).
 *
 * The seed also carries this process's id. Not for entropy: the limit's window is
 * sixty seconds and a second `npm run test:e2e` started straight after the first
 * would otherwise meet the *same* addresses with their budgets already spent, and
 * fail for a reason that only exists because the suite ran twice.
 */

/** The board page's path for an id: what Share copies, and what a tab opens. */
export const boardPath = (boardId: string): string => `/b/${boardId}`;

/** Addresses already handed out in this worker, so no two tests share one. */
const ADDRESSES = new Set<string>();

/**
 * A fake client address for one test, unique within this worker.
 *
 * Two pages in one test must share an address when they are meant to be the same
 * visitor opening one board, and have different ones when they are meant to be
 * different people — so the address comes from the test's own title and its
 * worker slot, never from randomness, and an address already used here is
 * skipped rather than reused. That is what keeps a suite of a hundred boards
 * from spending one visitor's ten-a-minute allowance by accident, while still
 * letting a test that *wants* the limit to have a visitor of its own.
 */
export function visitor(tag: string, slot: string | number = 'main'): string {
  const hash = (text: string): number => {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value = (value ^ (text.charCodeAt(index) ?? 0)) >>> 0;
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value >>> 0;
  };
  // The slot is mixed in *before* hashing, so that the same test name run under
  // two browsers does not hash to the same address. It would be easy to assume
  // each browser is its own visitor: three projects run the same specs in
  // parallel, and when they all hash a title to one address they are quietly
  // sharing one allowance — which is how a test about a rate limit ends up
  // failing on someone else's spent budget.
  let seed = hash(`${tag}|${String(slot)}|${process.pid ?? 0}`);
  for (let attempt = 0; attempt < 60_000; attempt += 1) {
    const a = 1 + (seed % 250);
    const b = 1 + (((seed >>> 8) ^ (seed >>> 16)) % 250);
    const address = `203.0.${a}.${b}`;
    if (!ADDRESSES.has(address)) {
      ADDRESSES.add(address);
      return address;
    }
    seed = (seed * 31 + 7) >>> 0;
  }
  throw new Error(`out of test visitor addresses for ${tag}`);
}

/**
 * The isolation key for one test: its browser and its worker slot.
 *
 * Pass this as the last argument of anything in this file that allocates a
 * visitor. Without it, the same test running under Chromium and under WebKit at
 * the same moment asks as the same person, and two people's boards come out of
 * one ten-a-minute allowance.
 */
export const slotOf = (testInfo: {
  project: { name: string };
  parallelIndex: number;
}): string => `${testInfo.project.name}:${testInfo.parallelIndex}`;

/**
 * Make a board, and return its id.
 *
 * Created over the real API rather than by clicking, because "a board exists" is
 * the precondition, not the thing under test: a suite about dragging notes
 * should not fail because the create button moved.
 */
export async function createBoard(
  request: APIRequestContext,
  tag: string,
  slot: string | number = 'main',
): Promise<string> {
  const response = await request.post('/api/boards', {
    headers: { 'CF-Connecting-IP': visitor(tag, slot) },
  });
  if (response.status() !== 201) {
    throw new Error(
      `could not create a board for "${tag}": ${response.status()} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error(`the create response carried no board id: ${JSON.stringify(body)}`);
  }
  return body.id;
}

/**
 * Open a board and wait until it is *live*.
 *
 * Two waits, in this order, because they mean different things. First the
 * existence check has to have passed — the board surface is not in the DOM until
 * it has, so a test that skipped this would be dragging on the "Opening board…"
 * page. Then the room's sync round-trip has to have completed, or the first
 * note a test seeds may be seeded into a document the room has not filled yet.
 */
export async function openBoard(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('board-page')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => window.__vidi6?.getConnectionState() === 'connected',
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Two separate browsers on one board: the pair shape the sync suite needs.
 *
 * Separate *contexts*, so nothing is shared but the room — no localStorage, no
 * BroadcastChannel, no connection pool. That is what makes "the note appeared on
 * the other screen" mean something.
 */
export async function openFreshPair(
  browser: Browser,
  tag: string,
  slot: string | number = 'main',
): Promise<[Page, Page, string]> {
  const maker = await browser.newContext();
  const boardId = await createBoard(maker.request, tag, slot);
  await maker.close();

  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  await openBoard(a, boardPath(boardId));
  await openBoard(b, boardPath(boardId));
  return [a, b, boardId];
}

/**
 * A board that exists but that nobody is on, for the "come back later" tests:
 * the writer leaves, the room goes quiet, and only then does the reader arrive.
 */
export async function openBoardIn(
  browser: Browser,
  path: string,
): Promise<[Page, BrowserContext]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, path);
  return [page, context];
}

/**
 * A whole board opened at once: `count` separate browsers on one room.
 *
 * Opened *concurrently* on purpose. Opened one after another, every newcomer
 * can see the people already there and a per-browser rule looks fine; the shape
 * that breaks one is five browsers that each choose before any of them has seen
 * another, which is what a board shared in a link actually does. Separate
 * contexts again, so "five people" means five browsers and not five tabs of one
 * browser's shared memory.
 */
export async function openCrowd(
  browser: Browser,
  count: number,
  tag: string,
  slot: string | number = 'main',
): Promise<{ pages: Page[]; contexts: BrowserContext[]; boardId: string }> {
  const maker = await browser.newContext();
  const boardId = await createBoard(maker.request, tag, slot);
  await maker.close();

  const contexts: BrowserContext[] = [];
  for (let index = 0; index < count; index += 1) contexts.push(await browser.newContext());
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await Promise.all(pages.map((page) => openBoard(page, boardPath(boardId))));
  return { pages, contexts, boardId };
}
