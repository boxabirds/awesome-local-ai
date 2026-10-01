// Story 5 end-to-end: a board reaches other people through its link, and nothing
// else (TC-26 to TC-29, TC-31). These are the only tests that start a browser from
// what a link contains: a link taken in one browser is entered in another, and the
// boards are compared by the content that ends up on them.
//
// TC-31 runs against a server of its own with the room's test hooks on, the way
// story 4's persistence tests do: a board made before links existed can only be
// produced by a build from before this story.

import * as Y from 'yjs';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { retroBoard, type BoardFixture } from '../fixtures/boards';
import {
  content,
  createNote,
  editNote,
  openBoard,
  waitForContentsMatch,
  waitForSyncReady,
  type Content,
} from './helpers/live';
import { createBoard } from './helpers/board';
import { removeStateDir, newStateDir, WranglerProcess } from './helpers/wrangler-process';

/** Where to drop a note on an empty board: clear of every control and of the fixture. */
const EMPTY_BOARD = { x: 260, y: 520 };

/**
 * How long to give a page that has just been reloaded to show the board. This is a
 * page load happening under the load of the whole suite, and what is being tested is
 * that the board comes back at all; the timings the product promises are measured in
 * `live-collaboration.spec.ts` and `persistence.spec.ts` against their own budgets.
 */
const RELOAD_SYNC_MS = 30_000;

const viewportOf = (page: Page) => page.getByTestId('board-viewport');
const shareButton = (page: Page) => page.getByRole('button', { name: 'Share' });
const copyButton = (page: Page) => page.getByRole('button', { name: 'Copy link' });
const linkField = (page: Page) => page.getByRole('textbox', { name: 'Board link' });
const copiedStatus = (page: Page) => page.getByText('Link copied');
const manualStatus = (page: Page) => page.getByText('Press Ctrl+C');

/**
 * The grants to try, most complete first. Chromium wants both halves; WebKit's
 * driver does not know the name `clipboard-write` and fails a page creation over it;
 * Firefox needs no grant here and refuses the name outright. They are tried in order
 * and only a page that got its own text back is believed.
 */
const CLIPBOARD_GRANTS: readonly (readonly string[])[] = [
  ['clipboard-read', 'clipboard-write'],
  ['clipboard-read'],
  [],
];

/** Whether a page can put text in the clipboard and read the same text back. */
async function clipboardWorks(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const marker = `probe-${Math.random()}`;
    if (navigator.clipboard?.writeText === undefined) return false;
    try {
      await navigator.clipboard.writeText(marker);
    } catch {
      return false;
    }
    try {
      return (await navigator.clipboard.readText()) === marker;
    } catch {
      return false;
    }
  });
}

/**
 * The grant list, if any, under which a page in this browser reads back what it
 * wrote - established by trying it on a throwaway context, because a permission
 * granted is only worth the page that can use it. `null` means the clipboard is out
 * of this driver's reach, and a test then reads the link out of the field the panel
 * hands a person instead: what changes is how the test reads the link back, never
 * what the product has to do.
 */
async function clipboardGrant(browser: Browser): Promise<string[] | null> {
  for (const permissions of CLIPBOARD_GRANTS) {
    const context = await browser.newContext();
    try {
      if (permissions.length > 0) await context.grantPermissions(permissions);
      const page = await context.newPage();
      await page.goto('/');
      const works = await clipboardWorks(page);
      await context.close();
      if (works) return [...permissions];
    } catch {
      await context.close().catch(() => undefined);
    }
  }
  return null;
}

/**
 * A context whose clipboard is reachable, or - with `refuse` - one whose clipboard is
 * there and then refuses, which is the position a denied person is in.
 */
async function clipboardContext(
  browser: Browser,
  options: { refuse?: boolean } = {},
): Promise<{ context: BrowserContext; reached: boolean }> {
  const grant = await clipboardGrant(browser);
  const context = await browser.newContext();
  if (grant !== null && grant.length > 0) await context.grantPermissions(grant);
  const reached = grant !== null;
  if (options.refuse === true || !reached) await context.addInitScript(clipboardRefused);
  return { context, reached: options.refuse === true ? false : reached };
}

/** The clipboard's text, or `null` where reading it is not permitted. */
async function clipboardText(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const clipboard = navigator.clipboard;
    if (clipboard?.readText === undefined) return null;
    try {
      return await clipboard.readText();
    } catch {
      return null;
    }
  });
}

/**
 * Take the clipboard away from underneath a page: `navigator.clipboard` answers for
 * an API that refuses, which is what a denial looks like to the panel.
 */
const clipboardRefused = () => {
  Object.defineProperty(Navigator.prototype, 'clipboard', {
    configurable: true,
    value: {
      writeText: () =>
        Promise.reject(new DOMException('not allowed to write to the clipboard', 'NotAllowedError')),
    },
  });
};

/**
 * A board opened from a link by a browser that has never been here before: its own
 * context, so nothing is shared - no storage, no tab, no origin state - but the URL.
 */
async function openLink(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  // A page that was sent to a board that is not there says so, and this is the
  // assertion that tells the two apart.
  await expect(viewportOf(page)).toBeVisible();
  await waitForSyncReady(page);
  return page;
}

/** Create a note through the UI and wait until the board holds it. */
async function writeNote(page: Page, text: string): Promise<void> {
  const before = (await content(page)).length;
  await createNote(page, EMPTY_BOARD, text);
  await expect
    .poll(() => content(page), { timeout: 10_000, message: `the note "${text}" to land` })
    .toHaveLength(before + 1);
}

const textsOf = (notes: Content[]): string[] => notes.map((note) => note.text).sort();

/**
 * Wait for a note's text to be on this page's board. A page that has just been
 * reloaded has its document before it has the board's content on it, so this is what
 * a test waits for rather than the page having finished loading.
 */
async function expectNoteWithText(page: Page, text: string, timeout = RELOAD_SYNC_MS): Promise<void> {
  await expect
    .poll(async () => textsOf(await content(page)), {
      timeout,
      message: `the note "${text}" to be on the board`,
    })
    .toContain(text);
}

/** The fixture's notes in the shape `content()` reads a live board into. */
function fixtureContent(fixture: BoardFixture): Content[] {
  const notes: Content[] = [];
  for (const [id, object] of fixture.doc.getMap<Y.Map<unknown>>('objects')) {
    const text = object.get('text');
    notes.push({
      id,
      x: Number(object.get('x')),
      y: Number(object.get('y')),
      color: String(object.get('color')),
      text: text instanceof Y.Text ? text.toString() : '',
      z: Number(object.get('z')),
    });
  }
  return notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

test('TC-26 one link, two editors, one write: both show the same board', async ({
  browser,
  request,
}) => {
  // One board, made the way the New board button makes one, at the address a person
  // would share: the link is taken from the address bar of a browser on the board.
  const id = await createBoard(request);
  const sharer = await openBoard(browser, id);
  const link = sharer.url();
  expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

  const a = await openLink(browser, link);
  const b = await openLink(browser, link);
  await waitForContentsMatch([a, b], E2E_EVENTUAL_TIMEOUT_MS);

  const started = Date.now();
  await writeNote(a, 'one write');
  await waitForContentsMatch([a, b], E2E_EVENTUAL_TIMEOUT_MS);
  const elapsed = Date.now() - started;
  console.log(`TC-26: the write was on the other board in ${elapsed}ms (budget ${E2E_EVENTUAL_TIMEOUT_MS}ms)`);

  expect(textsOf(await content(b))).toContain('one write');
  expect(await content(a)).toEqual(await content(b));
  // Both are on the same board, which is to say: the same address, and no warning.
  expect(b.url()).toBe(link);
  await expect(b.getByText('Board not found')).toHaveCount(0);
});

test('TC-27 the link that was copied opens the board it was copied from', async ({
  browser,
}) => {
  // One browser, two tabs: the person who shares and the person who follows.
  const { context, reached } = await clipboardContext(browser);
  const a = await context.newPage();

  await a.goto('/');
  await a.getByRole('button', { name: 'New board' }).click();
  await expect(viewportOf(a)).toBeVisible();
  const boardUrl = a.url();

  await shareButton(a).click();
  await copyButton(a).click();

  let link: string;
  if (reached) {
    await expect(copiedStatus(a)).toBeVisible();
    const copied = await clipboardText(a);
    // This is the test's whole point, and no other test in the suite can make it:
    // what went into the clipboard is the board's own address - not the home page,
    // not just a path, not something the person could have read off the screen.
    expect(copied).not.toBeNull();
    expect(copied).toBe(boardUrl);
    link = copied as string;
  } else {
    // No clipboard this driver can reach, so the link is read from the field the
    // panel gives a person who has to copy it by hand - the same string.
    await expect(manualStatus(a)).toBeVisible();
    link = await linkField(a).inputValue();
    expect(link).toBe(boardUrl);
  }

  const b = await context.newPage();
  await b.goto(link);
  await expect(viewportOf(b)).toBeVisible();
  await waitForSyncReady(b);
  await expect(b.getByText('Board not found')).toHaveCount(0);

  // One board: what one writes, the other has.
  await writeNote(a, 'same link');
  await waitForContentsMatch([a, b], E2E_EVENTUAL_TIMEOUT_MS);

  // And the second editor writes too, into the note the first one made.
  await editNote(b, 0);
  await b.keyboard.type(' and the second');
  await b.keyboard.press('Escape');
  await waitForContentsMatch([a, b], E2E_EVENTUAL_TIMEOUT_MS);
  expect(textsOf(await content(a))).toEqual(textsOf(await content(b)));
  expect(textsOf(await content(b))[0]).toContain('same link');

  // B arrived at the board and was never sent anywhere else: it never needed the
  // home page, and it is still on the link it was given.
  expect(b.url()).toBe(link);
});

test('TC-28 a hundred links are a hundred boards', async ({ browser, request }) => {
  test.setTimeout(240_000);

  const ids: string[] = [];
  for (let i = 0; i < 100; i++) ids.push(await createBoard(request));

  // Nobody is ever pointed at the same board as anyone else: creation is not
  // idempotent, and a link is good for exactly one board.
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) {
    expect((await request.get(`/api/boards/${id}`)).status()).toBe(200);
  }

  // That a write stays on its own board is checked on a sample of pairs, which is
  // the same room-per-id mechanism all hundred use: the board written on one pair
  // is not on any other pair.
  const sample = [ids[0]!, ids[37]!, ids[63]!, ids[99]!];
  const writers: Page[] = [];
  const peers: Page[] = [];
  for (const id of sample) {
    writers.push(await openBoard(browser, id));
    peers.push(await openBoard(browser, id));
  }
  for (let i = 0; i < sample.length; i++) {
    await writeNote(writers[i]!, `board ${i}`);
  }
  for (let i = 0; i < sample.length; i++) {
    await waitForContentsMatch([writers[i]!, peers[i]!], E2E_EVENTUAL_TIMEOUT_MS);
    expect(textsOf(await content(peers[i]!))).toEqual([`board ${i}`]);
  }
  // Nothing bled between the boards: each of the four holds its one note.
  for (const page of [...writers, ...peers]) {
    expect((await content(page)).length).toBe(1);
  }
});

test('TC-29 a clipboard that will not take the link still hands the link over', async ({
  browser,
  request,
}) => {
  // The clipboard is one this browser can reach, taken away from underneath the
  // page: the panel falling back, not a panel that never had the API to begin with.
  const { context } = await clipboardContext(browser, { refuse: true });

  const id = await createBoard(request);
  const page = await context.newPage();
  await page.goto(`/b/${id}`);
  await expect(viewportOf(page)).toBeVisible();

  await shareButton(page).click();
  await copyButton(page).click();
  await expect(manualStatus(page)).toBeVisible();
  await expect(copiedStatus(page)).toHaveCount(0);

  const value = await linkField(page).inputValue();
  // What the field holds is the board's absolute link - origin and board path -
  // which is what the address bar agrees the board is at.
  expect(value).toBe(page.url());
  expect(value).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

  // A second browser given that copied text arrives at this board: the link in the
  // field is a copy of this board's address, not of some other board's.
  const peer = await openLink(browser, value);
  expect(peer.url()).toBe(value);

  // The panel still offers the same link it offered before.
  expect(await linkField(page).inputValue()).toBe(value);

  // And the board still works behind that link: write, come back, it is there.
  await writeNote(page, 'still works');
  await waitForContentsMatch([page, peer], E2E_EVENTUAL_TIMEOUT_MS);
  await page.goto(value);
  await expect(viewportOf(page)).toBeVisible();
  await waitForSyncReady(page);
  await expectNoteWithText(page, 'still works');
});

test.describe('a board made before links existed', () => {
  let server: WranglerProcess;
  let stateDir: string;

  test.beforeAll(async () => {
    stateDir = newStateDir('share-legacy');
    server = await WranglerProcess.start({ label: 'share-legacy', stateDir, testHooks: true });
  });

  test.afterAll(async () => {
    await server.stop();
    removeStateDir(stateDir);
  });

  test('TC-31 a board with no creation stamp is still a board', async ({ browser }) => {
    test.setTimeout(240_000);
    const id = newBoardId();
    const legacy = retroBoard();
    // Rows and a snapshot, and no `created_at`, exactly as a build before this story
    // would have left them.
    await server.seedLegacy(id, legacy.updates);
    const expected = fixtureContent(legacy);
    expect(expected.length).toBeGreaterThan(0);

    // The service answers for it.
    const answer = await fetch(`${server.url}/api/boards/${id}`);
    expect(answer.status).toBe(200);
    expect((await answer.json()) as { id?: string }).toEqual({ id });

    // And a socket joins it and finds what is on it.
    const page = await browser.newPage();
    await page.goto(server.boardUrl(id));
    await expect(viewportOf(page)).toBeVisible();
    await waitForSyncReady(page);
    await expect
      .poll(() => content(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the legacy board to load' })
      .toEqual(expected);
    expect(await page.getByText('Board not found').count()).toBe(0);

    // It is a board, not a museum piece: it takes a write and keeps it.
    await writeNote(page, 'added later');
    await expect.poll(() => content(page), { timeout: 10_000 }).toHaveLength(expected.length + 1);
    await page.reload();
    await expect(viewportOf(page)).toBeVisible();
    await waitForSyncReady(page);
    await expectNoteWithText(page, 'added later');
    await page.close();
  });
});
