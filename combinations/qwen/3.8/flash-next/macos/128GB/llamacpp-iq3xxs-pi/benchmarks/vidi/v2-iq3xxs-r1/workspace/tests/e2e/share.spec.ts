import { expect, test } from '@playwright/test';
import {
  boardId,
  closeScreens,
  createNote,
  expectNoteText,
  gotoNewBoard,
  liveNoteIds,
  openScreen,
  waitForSynced,
} from './helpers/sync';
import {
  absentBoardPath,
  addressBarLink,
  clipboardText,
  copyLink,
  createBoard,
  expectClosed,
  expectManualMessage,
  focusedTestId,
  openShare,
  probeBoard,
  seedLegacyBoard,
  selectedLink,
  shareCopyButton,
  shownLink,
} from './helpers/share';
import { ACCESS_NOTE, COPY_LABEL } from '../../src/client/share/SharePanel';
import {
  NOT_FOUND_HEADING,
  NOT_FOUND_MESSAGE,
  UNREACHABLE_MESSAGE,
} from '../../src/client/pages/state';
import { CREATE_BUDGET_MS } from '../../src/shared/config';

/**
 * Story 5 — "Share a board with others using a link" (design TC-26 to TC-29, TC-31).
 *
 * These are the two-person stories, told with two browser contexts on a real
 * `wrangler dev`: one person creates a board and puts its link somewhere the other
 * person can read it (the clipboard, or a link typed from memory), and everything
 * that happens between them goes through the Worker. The clipboard is the browser's
 * real one, with the engine's own permission granted, because a link that only this
 * test could read is not a shareable link.
 */

/** Somewhere on the board that is clear of both toolbars. */
const SPOT = { x: 520, y: 400 };

test.describe('share a board by link', () => {
  test('TC-26 · create, share, join: the link is the whole invitation', async ({ page }) => {
    // ---- Maya: a board of her own, from the home page -------------------------
    const clickedAt = Date.now();
    await page.goto('/');
    await page.getByTestId('new-board-button').click();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const clickToBoardMs = Date.now() - clickedAt;
    // The PRD asks for the board to appear "within 200ms" of the click. Reported, not
    // asserted: a shared machine that takes longer is not a broken board (design
    // TC-26), but a number that drifts is something we would want to know.
    // eslint-disable-next-line no-console
    console.log(`    TC-26 click-to-board: ${clickToBoardMs}ms (CREATE_BUDGET_MS ${CREATE_BUDGET_MS}ms)`);

    await waitForSynced(page);
    const id = await boardId(page);
    expect(await liveNoteIds(page)).toEqual([]); // a board of one's own starts empty

    const note = await createNote(page, SPOT, 'Maya was here');
    await expect(page.getByTestId('board')).toHaveAttribute('data-board-id', id);

    // ---- Maya copies the link, with the panel's own confirmation ---------------
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openShare(page);
    await expect(page.getByText(ACCESS_NOTE)).toBeVisible();
    await copyLink(page);
    const shared = await clipboardText(page);
    // The clipboard, the panel and the address bar all say the same thing.
    expect(shared).toBe(await shownLink(page));
    expect(shared).toBe(await addressBarLink(page));
    expect(new URL(shared).pathname).toBe(`/b/${id}`);
    await page.getByTestId('share-close').click();
    await expectClosed(page);

    // ---- Sam: a fresh context, nothing but the link in it ---------------------
    // No accounts anywhere in this test: the address is the only credential.
    const sam = await openScreen(page, shared);
    try {
      await waitForSynced(sam);
      expect(await boardId(sam)).toBe(id);
      // Sam sees Maya's note without reloading, and can edit it.
      await expectNoteText(sam, note, 'Maya was here');
      // Sam edits that very note, from the other context.
      const box = await sam.locator(`[data-note-id="${note}"]`).boundingBox();
      if (!box) throw new Error('Maya\'s note is not on Sam\'s screen');
      await sam.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      await sam.keyboard.type(' (Sam agrees)');
      await sam.keyboard.press('Escape');
      // Maya sees Sam's edit on her own screen, with no reload either.
      await expectNoteText(page, note, 'Maya was here (Sam agrees)');
      // And they are on one board, not two that look alike.
      expect(await liveNoteIds(sam)).toEqual(await liveNoteIds(page));
    } finally {
      await closeScreens([sam]);
    }
  });

  test('TC-27 · a link to a board that is not there is honest, and creates nothing', async ({
    page,
    request,
  }) => {
    const path = absentBoardPath(); // well-formed, never created
    const absent = path.slice(3);
    await page.goto(path);

    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
    await expect(page.getByText(NOT_FOUND_MESSAGE)).toBeVisible();
    // Nothing of the board is faked at a wrong address: no board, no Share button.
    await expect(page.getByTestId('board')).toHaveCount(0);
    await expect(page.getByTestId('share-button')).toHaveCount(0);

    // Negative half (TC-06 at the browser level): visiting an address made nothing.
    // Asking the API about that very id is the proof.
    expect(await probeBoard(request, absent)).toBe(404);

    // The page's own way out: a real board, which is not the one asked for.
    await page.getByTestId('new-board-button').click();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const created = await boardId(page);
    expect(created).not.toBe(absent);
    await expect(page.getByTestId('board')).toHaveAttribute('data-board-id', created);
    await expect(page.getByTestId('share-button')).toBeVisible();
  });

  test('TC-28 · a board whose service is unreachable opens itself when it comes back', async ({
    page,
    request,
  }) => {
    const id = await createBoard(request); // the board is real, so this is about the road
    const path = `/b/${id}`;

    // Cut the only road the page has to the question "is this board here?".
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(path);
    // Remember this document, so "without reloading" can be proved rather than assumed.
    await page.evaluate(() => {
      (window as unknown as { __tc28?: boolean }).__tc28 = true;
    });

    // The page's own words, then the line under them saying it is still working.
    const unreachable = page.getByTestId('board-page-unreachable');
    await expect(unreachable.getByRole('status')).toHaveText(UNREACHABLE_MESSAGE, {
      timeout: 15_000,
    });
    await expect(unreachable.locator('.page-note')).toHaveText(/^Retrying in \d+s\.$/);
    await expect(page.getByTestId('board')).toHaveCount(0);

    await page.unroute('**/api/boards/*');
    // The retry is the page's own: same document, board appears, no reload.
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __tc28?: boolean }).__tc28)).toBe(true);
    expect(await boardId(page)).toBe(id);
  });

  test('TC-29 · clipboard blocked: the address is left selected, with the keys to copy it', async ({
    page,
  }) => {
    // A browser that says no to the clipboard — as a browser really does when the
    // person has refused permission. Both doors are closed, because a browser that
    // refuses automatic copying refuses both: the modern API and the old command.
    await page.addInitScript(() => {
      const real = navigator.clipboard;
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          // Writing is refused, reading is left alone — which is what a browser that
          // has not been given permission does, and what lets this test check at the
          // end what a person's own Ctrl+C achieved.
          writeText: () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')),
          readText: () => real.readText(),
        },
      });
      // The old `execCommand` door closed too: a browser that refuses automatic
      // copying refuses both, and only then is a person left to copy by hand.
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: () => false,
      });
    });
    await gotoNewBoard(page);
    const link = await addressBarLink(page);

    await openShare(page);
    await expect(shareCopyButton(page)).toHaveText(COPY_LABEL);
    await shareCopyButton(page).click();

    await expectManualMessage(page); // the message, and never a claim that it copied
    // The whole address is selected, in the panel's own field, with the focus on it:
    // one keypress and the person has the link.
    await expect.poll(() => selectedLink(page)).toBe(link);
    // The focus is left in the field that holds the selected address.
    expect(await focusedTestId(page)).toBe('share-link');

    // And the fallback works: the same keys a person would press do put the link on
    // the clipboard (granted here, refused above by the panel's own attempt).
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
    await expect.poll(() => clipboardText(page)).toBe(link);
  });

  test('TC-31 · a board that predates the link still opens at its link', async ({ page, request }) => {
    // A board as it was stored before this feature: rows in the log, and nothing
    // that says when it was created.
    const { boardId: id, fixture } = await seedLegacyBoard(request);
    await page.goto(`/b/${id}`);

    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('not-found-page')).toHaveCount(0);
    await waitForSynced(page);
    await expect.poll(() => liveNoteIds(page), { timeout: 30_000 }).toHaveLength(fixture.notes.length);

    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-note-id]')).map(
        (el) => el.querySelector('[data-testid="sticky-text-inner"]')?.textContent ?? '',
      ),
    );
    expect(texts.sort()).toEqual(fixture.notes.map((note) => note.text).sort());
  });
});
