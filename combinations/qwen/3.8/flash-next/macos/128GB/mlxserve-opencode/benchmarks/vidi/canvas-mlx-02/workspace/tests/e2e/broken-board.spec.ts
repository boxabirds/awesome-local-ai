// Story 4's failure path, in a browser: a board the room cannot read says so in
// the user's language and locks its editing tools, and the room comes back on its
// own once storage can be read again.
//
// The hook breaks the stored snapshot the same way a corrupt row does: the bytes
// are there and no longer mean anything. `repair` puts them back, which is an
// operator fixing storage. Nothing in the client is told to reconnect on command,
// because 4500 deliberately stays inside y-websocket's retry range - the recovery
// below happens because the client keeps dialing back, which is the point of the
// dedicated close code.
//
// The two halves are separate tests because the second one spends most of its
// time waiting out the client's rate limited retry; see NOTES.md for why the
// "everything is on screen again" claim is carried by TC-19/TC-20 rather than by
// assertions made on this tab after the recovery.
import { test, expect, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config.ts';
import { openBoard, connectionBadge } from './helpers/room.ts';
import { createNoteAt, typeText, notes } from './helpers/sticky.ts';
import {
  corruptRoom,
  readNotes,
  repairRoom,
  roomStats,
  waitForRoom,
  SHARED_ORIGIN,
  type NoteOnScreen,
} from './helpers/persistence.ts';

// Leave one note on the board and wait until the room has it in its log, so
// there is something for the storage to be unreadable about.
async function leaveANote(page: Page): Promise<{ boardId: string; left: NoteOnScreen[] }> {
  const boardId = newBoardId();
  await openBoard(page, boardId);
  await createNoteAt(page, 420, 300);
  await typeText(page, 'Unreadable');
  await page.keyboard.press('Escape');
  await waitForRoom(boardId, (s) => s.logRows >= 1, 'the note row in the log');
  return { boardId, left: await readNotes(page) };
}

test('TC-24a a board that cannot be read says so and locks its editing tools', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { boardId, left } = await leaveANote(page);
  expect(left.length).toBe(1);

  // Storage goes bad while the user is looking at the board.
  const broken = await corruptRoom(boardId);
  expect(broken.state).toBe('load-failed');

  // The banner says what happened, in the user's words, and it is a message
  // rather than a spinner: a moment later it still says the same thing, and the
  // room is still refusing to serve the board.
  const badge = connectionBadge(page);
  await expect(badge).toHaveAttribute('data-state', 'load_failed', { timeout: 20000 });
  await expect(badge).toContainText("This board couldn't be loaded");
  await page.waitForTimeout(1200);
  await expect(badge).toHaveAttribute('data-state', 'load_failed');
  expect((await roomStats(boardId)).serving).toBe(false);

  // Editing is off, and says so.
  const create = page.locator('[data-testid="sticky-create"]');
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(`[data-testid="${left[0].id}"]`)).toHaveAttribute(
    'data-editable',
    'false',
  );

  // And using the tools does nothing at all: no note is created and no editor
  // opens, on empty space and on the note itself alike.
  await page.mouse.dblclick(900, 620);
  await page.mouse.dblclick(420, 300);
  await page.waitForTimeout(300);
  expect(await notes(page).count()).toBe(1);
  expect(await page.locator('textarea.sticky-editor').count()).toBe(0);
});

test('TC-24b once storage reads again the room serves the board to the client again', async ({
  page,
}) => {
  test.setTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 90_000);
  const { boardId } = await leaveANote(page);
  expect((await roomStats(boardId)).chunks).toBe(0); // the log is still the board

  const broken = await corruptRoom(boardId);
  // The hook folded the log into a snapshot before breaking it, so there is a
  // snapshot for the read to fail on - and it is that snapshot which is broken.
  expect(broken.state).toBe('load-failed');
  expect(broken.chunks).toBe(1);
  expect(broken.throughSeq).toBeGreaterThan(0);
  // Everyone was closed with 4500 (the close code itself is asserted exactly in
  // the integration suite); while it cannot read, the room refuses the board.
  expect(broken.serving).toBe(false);

  // An operator fixes storage. Nothing else is done: no reload, no second client,
  // no instruction to the browser to reconnect.
  await repairRoom(boardId);

  // The room is serving the board again. The only thing that can have caused
  // this is the client's own retry, which 4500 deliberately allows, and a socket
  // is attached to prove a browser is back on the recovered room.
  await waitForRoom(
    boardId,
    (s) => s.state === 'ready' && s.serving && s.sockets >= 1,
    'the room to serve the repaired board to a reconnecting client',
    SHARED_ORIGIN,
    LOAD_RETRY_MIN_INTERVAL_MS + 60_000,
  );

  // The snapshot is whole and the log carries on after it, so nothing the user
  // wrote was lost on the way back; and nothing was quietly thrown away.
  const recovered = await roomStats(boardId);
  expect(recovered.lifecycle).toBe('ready');
  expect(recovered.loadError).toBeNull();
  expect(recovered.chunks).toBe(1);
  expect(recovered.throughSeq).toBeGreaterThan(0);
  expect(recovered.quarantined).toBe(0);
});
