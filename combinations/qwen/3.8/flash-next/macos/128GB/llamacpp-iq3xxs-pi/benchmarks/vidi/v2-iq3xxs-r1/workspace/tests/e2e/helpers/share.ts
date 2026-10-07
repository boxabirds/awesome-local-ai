import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { COPIED_LABEL, COPY_LABEL, MANUAL_COPY_MESSAGE } from '../../../src/client/share/SharePanel';
import { newBoardId } from '../../../src/shared/board-id';
import { retroBoard, type GeneratedBoard } from '../../fixtures/boards';

/**
 * The Share panel in a real browser (design TC-26 to TC-29, TC-31).
 *
 * The panel's labels come from the panel module itself, so a test that disagrees
 * with the copy fails for a reason. Nothing here reaches into another context: the
 * clipboard is read through the browser's own API, which is what a person pasting
 * into another app would get.
 */

export const shareButton = (page: Page) => page.getByTestId('share-button');
export const sharePanel = (page: Page) => page.getByTestId('share-panel');
export const shareLinkInput = (page: Page) => page.getByTestId('share-link');
export const shareCopyButton = (page: Page) => page.getByTestId('share-copy');

/** Open the panel the only way it opens: by pressing Share. */
export async function openShare(page: Page): Promise<void> {
  await shareButton(page).click();
  await expect(sharePanel(page)).toBeVisible();
}

/** The address the panel shows. */
export function shownLink(page: Page): Promise<string> {
  return shareLinkInput(page).inputValue();
}

/** The address in the bar, which is the other thing a person compares. */
export function addressBarLink(page: Page): Promise<string> {
  return page.evaluate(() => window.location.href);
}

/** Press `Copy link` and wait for the panel to say it worked. */
export async function copyLink(page: Page): Promise<void> {
  await expect(shareCopyButton(page)).toHaveText(COPY_LABEL);
  await shareCopyButton(page).click();
  await expect(shareCopyButton(page)).toContainText(COPIED_LABEL);
}

/**
 * What the browser's clipboard holds. Needs the `clipboard-read` permission on this
 * context — which is exactly the situation a person is in when they paste.
 */
export async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(async () => (await navigator.clipboard.readText()) as string);
}

/** The selection inside the panel's input, as a person would have it after Ctrl+A. */
export function selectedLink(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="share-link"]') as HTMLInputElement | null;
    if (!el) throw new Error('the share input is gone');
    return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  });
}

/**
 * The test id of the element holding the focus: where a keyboard person is left
 * after the panel closes, and after a copy that needed their own two hands.
 */
export function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null,
  );
}

/** The manual-copy message, when the panel shows one. */
export async function expectManualMessage(page: Page): Promise<void> {
  await expect(page.getByTestId('share-manual')).toHaveText(MANUAL_COPY_MESSAGE);
  await expect(shareCopyButton(page)).not.toContainText(COPIED_LABEL);
}

/** The panel is closed again. */
export async function expectClosed(page: Page): Promise<void> {
  await expect(sharePanel(page)).toHaveCount(0);
}


/**
 * Create a board over the real API without opening it, so a test can do something to
 * it before anyone looks (seed it as a legacy board, or simply never visit it).
 * Playwright's request API is used, which speaks to the same origin the browser has.
 */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

/**
 * Ask the API about a board id, without a browser ever visiting its address. The
 * address itself answers 200 with the app shell for any path at all — only the API
 * can say whether the *board* is there.
 */
export async function probeBoard(request: APIRequestContext, boardId: string): Promise<number> {
  return (await request.get(`/api/boards/${boardId}`)).status();
}

/**
 * The address of a board no one created — a well-formed link to nothing, used to
 * prove that merely naming an address creates nothing.
 */
export function absentBoardPath(): string {
  return `/b/${newBoardId()}`;
}

/** A board from before story 5: rows in the log, no `created_at`, never opened. */
export interface LegacySeed {
  readonly boardId: string;
  readonly fixture: GeneratedBoard;
}

/**
 * Build a board the way a board was built *before* story 5 existed: its id is made
 * up here, and the test-only hook writes its log rows through the room's own SQLite,
 * without the `created_at` marker the create endpoint writes. That is exactly the
 * shape the existence check has to cope with — storage that predates the marker, and
 * nothing else that says the board is real (design TC-31).
 */
export async function seedLegacyBoard(request: APIRequestContext): Promise<LegacySeed> {
  const fixture = retroBoard();
  const boardId = newBoardId();
  // Base64 in the hook body, because a hook travels as JSON.
  const response = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
    data: { updates: fixture.updates.map((update) => Buffer.from(update).toString('base64')) },
  });
  if (!response.ok()) {
    throw new Error(`seed-legacy failed: ${response.status()} ${await response.text()}`);
  }
  return { boardId, fixture };
}
