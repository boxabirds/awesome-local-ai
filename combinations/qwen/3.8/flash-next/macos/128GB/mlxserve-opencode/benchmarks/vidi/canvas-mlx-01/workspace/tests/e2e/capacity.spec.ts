/**
 * Story 3 advisory capacity, at the e2e level: five tabs of the same user concurrently
 * editing one board, a sixth that can still join and see them, and the soft over-capacity
 * note that appears without ever blocking a joiner. Tabs sync only through the Durable
 * Object room (cross-tab BroadcastChannel is disabled), so five tabs are five real
 * connections to the room.
 */
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { newBoardPage, createNote, addNote, noteIds, waitForNoteIds, expectSameNotes } from './helpers/live.js';

const maxEditors = Number(process.env.VIDI_TEST_MAX_EDITORS ?? 5);

/** Wait until a page's badge reports exactly `n` other editors (badge text "Connected · n"). */
async function waitForPeerBadge(page: import('@playwright/test').Page, n: number): Promise<void> {
  await expect
    .poll(() => page.locator('.test-connection-status').innerText().then((t) => t.includes(`· ${n}`) ? 1 : 0), { timeout: 5_000 })
    .toBe(1);
}

test('TC-25 five concurrent tab editors, a sixth joins and sees five, edits converge', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const tabs: import('@playwright/test').Page[] = [];
  for (let i = 0; i < maxEditors; i++) tabs.push(await newBoardPage(browser, boardId));

  // A sixth editor joins the same board and its badge reports five others already there.
  const sixth = await newBoardPage(browser, boardId);
  await waitForPeerBadge(sixth, maxEditors);

  // All six edit at once; the CRDT converges every tab onto the same six notes. A plain
  // click (not the single-diff `createNote`) is required: peers' notes land mid-read.
  await Promise.all([...tabs, sixth].map((p) => addNote(p)));
  for (const p of tabs) await expectSameNotes(p, sixth);
  await expect
    .poll(() => noteIds(sixth).then((ids) => ids.length), { timeout: 5_000 })
    .toBe(maxEditors + 1);

  for (const p of tabs) await p.context().close();
  await sixth.context().close();
});

test('TC-27 an over-capacity joiner sees the soft note and can still edit', async ({ browser }) => {
  const boardId = newBoardId();
  const firsts: import('@playwright/test').Page[] = [];
  for (let i = 0; i < maxEditors; i++) firsts.push(await newBoardPage(browser, boardId));

  // The (maxEditors+1)-th joiner is over the advisory limit.
  const late = await newBoardPage(browser, boardId);
  await expect(late.locator('.test-soft-capacity')).toBeVisible();
  await expect(late.locator('.test-soft-capacity')).toContainText('keep editing');

  // And it can still create a note that propagates to the others — nothing is refused.
  const id = await createNote(late);
  await waitForNoteIds(firsts[0]!, (ids) => ids.includes(id));
  expect(await noteIds(firsts[0]!)).toContain(id);

  for (const p of firsts) await p.context().close();
  await late.context().close();
});
