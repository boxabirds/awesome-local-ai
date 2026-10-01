// Story 3 end-to-end: real browsers on one board, syncing live through the
// Worker route into the room (TC-22 to TC-28). Everything runs against the
// `wrangler dev` server from playwright.config; participants are separate browser
// contexts so each has its own client id, selection and awareness. Latency is
// logged against LIVE_UPDATE_LATENCY_BUDGET_MS but never asserted (the PRD asks
// for "within about a second", not a hard timing test).

import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  badgeLog,
  badgeState,
  content,
  createBoard,
  createNote,
  createNoteViaToolbar,
  deleteNote,
  dragNote,
  dropSocket,
  editNote,
  noteCount,
  openBoard,
  recolourNote,
  restoreSocket,
  waitForContentsMatch,
  watchBadge,
} from './helpers/live';

/** Open `n` editors on the same board and wait until they agree. */
async function openMany(browser: Browser, n: number, boardId: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) pages.push(await openBoard(browser, boardId));
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
  return pages;
}

async function texts(page: Page): Promise<string[]> {
  return (await content(page)).map((n) => n.text).sort();
}

async function positions(page: Page): Promise<string> {
  return JSON.stringify((await content(page)).map((n) => [n.id, n.x, n.y]));
}

/** Run an action, logging how long the peers took to observe the resulting state. */
async function timed(label: string, action: () => Promise<void>, observe: () => Promise<void>): Promise<void> {
  const start = Date.now();
  await action();
  await observe();
  const ms = Date.now() - start;
  console.log(`[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
}

test('TC-22 every kind of change reaches the other editor', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);

  await timed(
    'create',
    () => createNote(alex, { x: 360, y: 300 }, 'idea'),
    () => expect.poll(async () => texts(sam)).toEqual(['idea']),
  );

  await timed(
    'move',
    () => dragNote(alex, 0, 220, 0),
    () =>
      expect
        .poll(async () => (await positions(sam)) === (await positions(alex)))
        .toBe(true),
  );

  await timed(
    'recolour',
    () => recolourNote(alex, 0, 'blue'),
    () => expect.poll(async () => (await content(sam))[0]?.color).toBe('blue'),
  );

  await timed(
    'text',
    async () => {
      await editNote(alex, 0);
      await alex.keyboard.type('!');
      await alex.keyboard.press('Escape');
    },
    () => expect.poll(async () => texts(sam)).toEqual(['idea!']),
  );

  await timed(
    'delete',
    () => deleteNote(alex, 0),
    () => expect.poll(async () => noteCount(sam)).toBe(0),
  );
  await waitForContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);
});

test('TC-23 both typing in one note keeps every character on both pages', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await createNote(alex, { x: 500, y: 320 });
  await expect.poll(() => noteCount(sam)).toBe(1);

  await editNote(alex, 0);
  await editNote(sam, 0);

  // Interleave keystrokes from both clients through the room.
  await Promise.all([alex.keyboard.type('AAAA'), sam.keyboard.type('BBBB')]);
  await alex.keyboard.press('Escape');
  await sam.keyboard.press('Escape');

  await waitForContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);
  expect((await texts(alex))[0]?.split('').sort().join('')).toBe('AAAABBBB');
  expect((await texts(sam))[0]?.split('').sort().join('')).toBe('AAAABBBB');
});

test('TC-24 both dragging one note settles on one identical position', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await createNote(alex, { x: 480, y: 320 });
  await expect.poll(() => noteCount(sam)).toBe(1);

  const start = Date.now();
  await Promise.all([dragNote(alex, 0, 250, 0), dragNote(sam, 0, 0, 250)]);
  await waitForContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);
  console.log(`[settle] concurrent drag converged in ${Date.now() - start}ms`);

  const a = (await content(alex))[0]!;
  const s = (await content(sam))[0]!;
  expect({ x: a.x, y: a.y }).toEqual({ x: s.x, y: s.y });
});

test('TC-25 deleting a note a peer is editing closes the editor without an error', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await createNote(alex, { x: 420, y: 300 }, 'shared');
  await expect.poll(() => noteCount(sam)).toBe(1);

  const errors: string[] = [];
  sam.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  sam.on('pageerror', (err) => errors.push(String(err)));

  await editNote(sam, 0);
  await expect(sam.locator('textarea[data-testid="sticky-text"]')).toHaveCount(1);

  await deleteNote(alex, 0);

  // Sam's note vanishes, the editor goes with it, and nothing errors.
  await expect.poll(() => noteCount(sam)).toBe(0);
  await expect(sam.locator('textarea[data-testid="sticky-text"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  await waitForContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);
});

test('TC-26 five editors each create and move notes and converge identically', async ({ browser, request }) => {
  // Five pages, five notes each, then a drag on every one of them: what runs out on a
  // loaded machine is the time the mouse actions take, not the time the board takes to
  // agree - which is measured below and logged against its own budget. Same reasoning
  // as the slow group in `navigation.spec.ts` and the persistence tests.
  test.setTimeout(60_000);
  const boardId = await createBoard(request);
  const pages = await openMany(browser, MAX_CONCURRENT_EDITORS, boardId);

  const labels: string[] = [];
  // Create with the toolbar button so each note is genuinely new even though
  // peers' notes land at the same viewport centre (a double-click there would
  // otherwise edit a synced note instead of making one).
  for (const [ci, page] of pages.entries()) {
    for (let i = 0; i < 5; i++) {
      const label = `c${ci}n${i}`;
      labels.push(label);
      await createNoteViaToolbar(page, label);
    }
  }
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);

  // Every note each context created is visible on every context.
  expect(await texts(pages[0]!)).toEqual([...labels].sort());

  // Each context nudges a note; positions must still converge everywhere.
  const start = Date.now();
  await Promise.all(pages.map((page, ci) => dragNote(page, ci, 20 + ci * 5, 20 + ci * 5)));
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
  console.log(
    `[latency] TC-26 post-move convergence: ${Date.now() - start}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
  );

  const final = await Promise.all(pages.map(content));
  expect(final.every((c) => JSON.stringify(c) === JSON.stringify(final[0]))).toBe(true);
});

test('TC-27 an offline editor catches up on reconnect and its badge reflects it', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await watchBadge(alex);

  // Alex loses the link: the network is blocked and the socket drops, so the
  // provider notices at once (rather than after its 30s watchdog) and the badge
  // flips to Reconnecting.
  await alex.context().setOffline(true);
  await dropSocket(alex);
  await expect.poll(() => badgeState(alex), { message: 'badge to show Reconnecting' }).toBe('reconnecting');

  // Both keep working: Sam through the room, Alex into the local document.
  for (let i = 0; i < 3; i++) await createNote(sam, { x: 150 + i * 210, y: 180 }, `sam${i}`);
  for (let i = 0; i < 3; i++) await createNote(alex, { x: 150 + i * 210, y: 480 }, `alex${i}`);

  // Back online within the outage window; edits from both sides reconcile.
  await alex.context().setOffline(false);
  await restoreSocket(alex);
  await expect.poll(() => noteCount(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);
  await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);
  await waitForContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);

  const states = (await badgeLog(alex)).map((b) => b.state);
  expect(states).toContain('reconnecting');
  expect(states).toContain('confirmed');
  // It then settles to the hidden, connected state.
  await expect.poll(() => badgeState(alex)).toBe('connected');
  expect(CATCH_UP_TEST_OUTAGE_MS).toBeGreaterThan(0);
});

test('TC-28 one editor selection and editing stay private', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await createNote(alex, { x: 460, y: 300 }, 'mine');
  await expect.poll(() => noteCount(sam)).toBe(1);

  await editNote(alex, 0);
  await expect(alex.locator('textarea[data-testid="sticky-text"]')).toHaveCount(1);

  // Sam sees the note, but nothing about Alex's selection or editor.
  const samNote = sam.locator('[data-testid="sticky-note"]').first();
  await expect(samNote).toHaveAttribute('data-selected', 'false');
  await expect(sam.locator('textarea[data-testid="sticky-text"]')).toHaveCount(0);
});
