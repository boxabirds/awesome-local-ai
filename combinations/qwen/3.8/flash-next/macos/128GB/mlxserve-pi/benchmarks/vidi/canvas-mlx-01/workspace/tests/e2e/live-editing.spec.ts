/**
 * Story 3 — see other people's edits appear live. Cross-browser (chromium / firefox /
 * webkit): the same board synced across real browser contexts over the real entry Worker
 * and `BoardRoom` Durable Object (`wrangler dev`).
 *
 * Each case generates its own board id in Node, so editors meet on a fresh empty room
 * without depending on the create-flow button.
 */
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  newBoardPage,
  createNote,
  addNote,
  noteIds,
  connectionLabel,
  waitForNoteIds,
  expectSameNotes,
  waitForNoteText,
  appendNoteText,
  waitForNoteField,
  setNoteField,
  selectNote,
  selectedOf,
} from './helpers/live.js';

test('TC-22 the create flow produces a live board route with a connected badge', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as unknown as { __vidi6?: unknown }).__vidi6 === 'object',
  );
  await page.getByTestId('create-board').click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.locator('.test-connection-status[data-status="online"]')).toBeVisible();
});

test('TC-23 a sticky created in one browser appears in another', async ({ browser }) => {
  const boardId = newBoardId();
  const a = await newBoardPage(browser, boardId);
  const b = await newBoardPage(browser, boardId);

  const id = await createNote(a);
  await waitForNoteIds(b, (ids) => ids.includes(id)); // <1s propagation
  expect(await noteIds(b)).toContain(id);

  await a.context().close();
  await b.context().close();
});

test('TC-24 the second editor shows connecting then online, never offline, note <1s', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const a = await newBoardPage(browser, boardId);
  const id = await createNote(a);

  const b = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await b.newPage();
  await page.goto(`/b/${boardId}`);
  // It must reach Connected and must never have shown Offline.
  await expect(page.locator('.test-connection-status[data-status="online"]')).toBeVisible({
    timeout: 1_000,
  });
  expect(await page.locator('.test-connection-status[data-status="offline"]').count()).toBe(0);
  await expect(page.locator('.test-connection-status')).not.toContainText('Offline');
  await waitForNoteIds(page, (ids) => ids.includes(id));
  expect(await noteIds(page)).toContain(id);

  await a.context().close();
  await b.close();
});

test('TC-26 two editors make concurrent edits and both converge on both merges', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const [a, b] = await Promise.all([newBoardPage(browser, boardId), newBoardPage(browser, boardId)]);

  // Both editors create a note at the same instant; the CRDT keeps both (no lost update).
  await Promise.all([addNote(a), addNote(b)]);
  await expectSameNotes(a, b);
  await expect.poll(() => noteIds(a).then((ids) => ids.length), { timeout: 5_000 }).toBe(2);
  const shared = (await noteIds(a))[0]!;

  // Concurrent text edits to the SAME note merge into one document holding both texts.
  await Promise.all([appendNoteText(a, shared, 'AAA'), appendNoteText(b, shared, 'BBB')]);
  await waitForNoteText(a, shared, 'AAA');
  await waitForNoteText(a, shared, 'BBB');
  await waitForNoteText(b, shared, 'AAA');
  await waitForNoteText(b, shared, 'BBB');

  await a.context().close();
  await b.context().close();
});

test('TC-28 a client that briefly disconnects still receives a later edit on reconnect', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const a = await newBoardPage(browser, boardId);
  const b = await newBoardPage(browser, boardId);

  // Drop B's socket out from under the page (network offline), then bring it back.
  await b.context().setOffline(true);
  await b.waitForTimeout(200);
  await b.context().setOffline(false);

  // A's later edit must reach B after reconnect, without B ever showing offline.
  const id = await createNote(a);
  await waitForNoteIds(b, (ids) => ids.includes(id));
  expect(await connectionLabel(b)).not.toContain('Offline');
  expect(await noteIds(b)).toContain(id);

  await a.context().close();
  await b.context().close();
});

test('TC-22b a two-person workshop: create, move, recolour and type each reach the other editor', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const [a, b] = await Promise.all([
    newBoardPage(browser, boardId),
    newBoardPage(browser, boardId),
  ]);

  // Create, then move, recolour and type — every one of those live edits must arrive in
  // the other editor within the latency budget (this is what "live" promises).
  const id = await createNote(a);
  await waitForNoteIds(b, (ids) => ids.includes(id));
  await setNoteField(a, id, 'x', 777);
  await waitForNoteField(b, id, 'x', 777);
  await setNoteField(a, id, 'color', 'blue');
  await waitForNoteField(b, id, 'color', 'blue');
  await appendNoteText(a, id, 'workshop');
  await waitForNoteText(b, id, 'workshop');
  await expectSameNotes(a, b);

  await a.context().close();
  await b.context().close();
});

test('TC-28b selection is local: a peer never shows another editor selection', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const [a, b] = await Promise.all([
    newBoardPage(browser, boardId),
    newBoardPage(browser, boardId),
  ]);
  const id = await createNote(a);
  await waitForNoteIds(b, (ids) => ids.includes(id));

  // Selecting the note on A lights it up there, but the shared document carries only note
  // content — B must still render that note unselected.
  await selectNote(a, id);
  await expect.poll(() => selectedOf(a, id), { timeout: 5_000 }).toBe('true');
  expect(await selectedOf(b, id)).toBe('false');

  await a.context().close();
  await b.context().close();
});
