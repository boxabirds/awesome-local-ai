import { test, expect, type Page } from '@playwright/test';
import {
  openSharedBoard,
  createSticky,
  noteByTest,
  noteTexts,
  noteCount,
  simulateDrop,
  restoreConnection,
  connectionStatus,
} from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config.ts';

/** Whether the note with `noteId` is locally selected on this page. */
function isSelected(page: Page, noteId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[role="group"][aria-label="Sticky note"][data-note-id="${id}"]`);
    return el?.getAttribute('data-selected') === 'true';
  }, noteId);
}

test.describe('TC-28 selection is local, never shared', () => {
  test('selecting a note on one board does not select it on the other', async ({ context }) => {
    const id = newBoardId();
    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    await createSticky(a, 400, 300, 'shared-note');
    await expect.poll(() => noteCount(b)).toBe(1);

    // A selects the note (single click selects).
    const note = await noteByTest(a, 'shared-note');
    await a.mouse.click(note!.cx, note!.cy);
    await a.waitForTimeout(120);

    await expect.poll(() => isSelected(a, note!.id)).toBe(true);
    // B, after enough time for any (erroneous) share to arrive, is NOT selected.
    await b.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS);
    expect(await isSelected(b, note!.id)).toBe(false);
  });
});

test.describe('supplemental: connection drop and recovery (idle-drop path, no data loss)', () => {
  // Not the nightly idle-stability test (design TC-29 measures that a socket
  // stays connected for 45 s untouched — see tests/e2e/nightly). In production
  // an idle proxy timeout (~45 s) drops the socket; wrangler dev imposes no such
  // timeout, so we force-close the live WebSocket via simulateDrop — this runs
  // the exact client path an idle timeout would: real onclose -> Reconnecting ->
  // backoff reconnect -> Connected flash, with content surviving untouched.
  test('a dropped idle connection flashes Reconnecting/Connected, content survives', async ({
    context,
  }) => {
    const id = newBoardId();
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await createSticky(page, 400, 300, 'persist-me');
    await expect.poll(() => noteTexts(page)).toEqual(['persist-me']);

    // Idle drop: tear the connection down; the badge goes Reconnecting.
    await simulateDrop(page);
    await expect(connectionStatus(page)).toContainText(/reconnect/i, { timeout: 8000 });

    // Reconnect: the client resyncs and flashes the Connected confirmation, then
    // the badge hides as the connection becomes stable.
    await restoreConnection(page);
    await expect(connectionStatus(page)).toContainText(/connected/i, { timeout: 8000 });
    await expect(connectionStatus(page)).toBeHidden({ timeout: 15000 });

    // No content was lost across the drop.
    await expect
      .poll(() => noteTexts(page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 6 })
      .toEqual(['persist-me']);
    expect(await noteCount(page)).toBe(1);
  });
});

test.describe('supplemental: survivors unaffected by an abrupt close; reconnect sees content', () => {
  test('content survives an abrupt close and a fresh page reloads it', async ({ context }) => {
    const id = newBoardId();

    // A collaborator establishes content and then abruptly closes its page.
    const victim = await context.newPage();
    await openSharedBoard(victim, id);
    await createSticky(victim, 400, 300, 'survives');
    await expect.poll(() => noteTexts(victim)).toEqual(['survives']);

    // A second collaborator keeps working and is unaffected by the drop.
    const survivor = await context.newPage();
    await openSharedBoard(survivor, id);
    await expect.poll(() => noteTexts(survivor)).toEqual(['survives']);

    await victim.close(); // abrupt disconnect

    await createSticky(survivor, 600, 400, 'after-drop');
    await expect
      .poll(() => noteTexts(survivor), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 6 })
      .toEqual(['after-drop', 'survives']);

    // A brand new page reconnecting sees all persisted content within 10s.
    const reconnected = await context.newPage();
    await openSharedBoard(reconnected, id);
    await expect
      .poll(() => noteTexts(reconnected), { timeout: 10000 })
      .toEqual(['after-drop', 'survives']);
  });
});
