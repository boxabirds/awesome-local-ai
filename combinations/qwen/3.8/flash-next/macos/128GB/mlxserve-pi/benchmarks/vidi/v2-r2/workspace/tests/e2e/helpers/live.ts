// Helpers for the story-3 live-collaboration e2e tests: open N isolated browser
// contexts on the same board, drive real mouse/keyboard edits, read the live
// document back by content (via the window.__vidi6 test hook), and watch the
// connection badge through its DOM transitions.

import { expect, type Browser, type Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import type { Point } from './board';
import { newBoardId } from '../../../src/shared/board-id';

export { newBoardId };
export { createBoard } from './board';

/** A board note reduced to the fields that must agree across every client. */
export interface Content {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  // story 7: a note's stored size, absent while it is the default square
  width?: number;
  height?: number;
}

export interface BadgeTransition {
  state: string;
  text: string;
}

/** Open one editor in its own context (so selection/awareness are separate). */
export async function openBoard(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitForSyncReady(page);
  return page;
}

/** The page's document is exposed and the provider has attached. */
export async function waitForSyncReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __vidi6?: { snapshot?: unknown } }).__vidi6?.snapshot === 'function',
  );
}

/** The live document, as plain content a Node-side test can compare. */
export async function content(page: Page): Promise<Content[]> {
  return page.evaluate(
    () =>
      (
        (window as unknown as { __vidi6: { snapshot(): StickySnapshot[] } }).__vidi6
          .snapshot() as readonly StickySnapshot[]
      )
        .map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          color: n.color,
          text: n.text,
          z: n.z,
          ...(n.width === undefined ? {} : { width: n.width }),
          ...(n.height === undefined ? {} : { height: n.height }),
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** True once every page holds byte-identical board content. */
export async function contentsMatch(pages: Page[]): Promise<boolean> {
  const all = await Promise.all(pages.map(content));
  const first = JSON.stringify(all[0]);
  return all.every((c) => JSON.stringify(c) === first);
}

export async function waitForContentsMatch(pages: Page[], timeout = 15_000): Promise<void> {
  await expect
    .poll(() => contentsMatch(pages), { timeout, message: 'every client to converge' })
    .toBe(true);
}

async function noteCentre(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-testid="sticky-note"]').nth(index).boundingBox();
  if (box === null) throw new Error(`note ${index} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Double-click empty board space to drop a note, type text, then commit. */
export async function createNote(page: Page, at: { x: number; y: number }, text = ''): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  if (text !== '') await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/**
 * Create a note with the toolbar button (always makes a new note and opens it for
 * editing) and type its text. Used when peers create many notes whose screen
 * positions would overlap - a double-click on an existing note would edit it
 * rather than create a new one.
 */
export async function createNoteViaToolbar(page: Page, text = ''): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note (N)', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Sticky note text' });
  await editor.waitFor({ state: 'visible' });
  if (text !== '') await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Open an existing note's editor (caret lands where it was left). */
export async function editNote(page: Page, index: number): Promise<void> {
  const c = await noteCentre(page, index);
  await page.mouse.dblclick(c.x, c.y);
}

/** Click a note once to select it (no editing). */
export async function selectNote(page: Page, index: number): Promise<void> {
  const c = await noteCentre(page, index);
  await page.mouse.click(c.x, c.y);
}

/** Select a note and pick a colour from its toolbar. */
export async function recolourNote(page: Page, index: number, color: string): Promise<void> {
  await selectNote(page, index);
  const label = color.charAt(0).toUpperCase() + color.slice(1);
  // force: during the soak peers move notes so a higher note can visually cover
  // the selected note's toolbar; the swatch still belongs to the selected note.
  await page.getByRole('button', { name: `${label} colour` }).click({ force: true });
}

/** Select a note and delete it with the keyboard. */
export async function deleteNote(page: Page, index: number): Promise<void> {
  await selectNote(page, index);
  await page.keyboard.press('Delete');
}

/** Drag note `index` by a screen delta in a few steps. */
export async function dragNote(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const c = await noteCentre(page, index);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 5 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Drag note `index` so its centre lands on `to` (a screen point). */
export async function dragNoteTo(page: Page, index: number, to: { x: number; y: number }): Promise<void> {
  const c = await noteCentre(page, index);
  await dragNote(page, index, to.x - c.x, to.y - c.y);
}

export async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"]').count();
}

/** Position (world coords) of a note, read from the live document. */
export async function notePosition(page: Page, index: number): Promise<{ x: number; y: number }> {
  const notes = await content(page);
  const n = notes[index];
  if (n === undefined) throw new Error(`note ${index} missing`);
  return { x: n.x, y: n.y };
}

/**
 * Record every connection-badge state the page shows, so a test can assert the
 * sequence (e.g. reconnecting then connected) even though "Connected" only shows
 * for CONNECTED_CONFIRMATION_MS.
 */
export async function watchBadge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __badgeLog: BadgeTransition[] };
    w.__badgeLog = [];
    const root = document.body;
    const push = (): void => {
      const el = document.querySelector('[data-testid="connection-status"]');
      w.__badgeLog.push({
        state: el?.getAttribute('data-state') ?? 'connected',
        text: el?.textContent ?? '',
      });
    };
    push();
    new MutationObserver(push).observe(root, { subtree: true, childList: true, attributes: true });
  });
}

export async function badgeLog(page: Page): Promise<BadgeTransition[]> {
  return page.evaluate(
    () => (window as unknown as { __badgeLog?: BadgeTransition[] }).__badgeLog ?? [],
  );
}

/** The badge's current state, or "connected" when the pill is hidden. */
export async function badgeState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="connection-status"]');
    return el?.getAttribute('data-state') ?? 'connected';
  });
}

/** Close the provider socket, as a real dropped link would (test build only). */
export async function dropSocket(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vidi6: { __drop(): void } }).__vidi6.__drop());
}

/** Re-open the provider socket and resync (test build only). */
export async function restoreSocket(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vidi6: { __restore(): void } }).__vidi6.__restore());
}

/** Whether the provider still holds a local awareness state (presence alive). */
export function hasAwareness(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6: { __awarenessPresent?(): boolean } }).__vidi6;
    return api.__awarenessPresent?.() ?? false;
  });
}

/** The current mapped connection state as the client sees it. */
export function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __vidi6: { connectionState?: string } }).__vidi6
    .connectionState ?? '');
}

/** The deduplicated log of every mapped connection state, oldest first. */
export function stateLog(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6: { __stateLog?(): readonly string[] } }).__vidi6;
    return [...(api.__stateLog?.() ?? [])];
  });
}

/** How many times the provider has begun (re)connecting. */
export function reconnectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6: { __reconnectCount?(): number } }).__vidi6;
    return api.__reconnectCount?.() ?? -1;
  });
}

/** Tear the connection down the way closing the context's React tree does. */
export function destroyConnection(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as { __vidi6: { __destroy(): void } }).__vidi6.__destroy());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------------
// text objects (story 9)
// --------------------------------------------------------------------------------

/** A board text reduced to the fields that must agree across every client. */
export interface TextContent {
  id: string;
  x: number;
  y: number;
  text: string;
  size: string;
  width: number;
  height: number;
  widthMode: string;
}

/**
 * The texts on the board, read from the live document. `snapshot()` answers with
 * every object, of every type, so a test that wants the words has to say so.
 */
export async function textContent(page: Page): Promise<TextContent[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __vidi6: { snapshot(): { type: string }[] };
        }
      )
        .__vidi6.snapshot()
        .filter((o) => o.type === 'text')
        .map((o) => {
          const t = o as unknown as TextContent & { createdBy?: string | null };
          return {
            id: t.id,
            x: t.x,
            y: t.y,
            text: t.text,
            size: t.size,
            width: t.width,
            height: t.height,
            widthMode: t.widthMode,
          };
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** How many text objects the document holds. */
export async function textCount(page: Page): Promise<number> {
  return (await textContent(page)).length;
}

/** True once every page holds the same texts, words and boxes included. */
export async function textContentsMatch(pages: Page[]): Promise<boolean> {
  const all = await Promise.all(pages.map(textContent));
  const first = JSON.stringify(all[0]);
  return all.every((c) => JSON.stringify(c) === first);
}

export async function waitForTextContentsMatch(
  pages: Page[],
  timeout = 15_000,
): Promise<void> {
  await expect
    .poll(() => textContentsMatch(pages), { timeout, message: 'the texts to converge' })
    .toBe(true);
}

/** The layer the Text tool holds clicks in, while the tool is held. */
export function textToolLayer(page: Page) {
  return page.locator('.text-tool-layer');
}

/** The open text editor. */
export function textEditor(page: Page) {
  return page.locator('textarea[data-testid="text-editor"]');
}

/** The rendered lines of one text, in the order they are drawn. */
export async function textLines(page: Page, index = 0): Promise<string[]> {
  return page
    .locator('[data-testid="text-object"]')
    .nth(index)
    .locator('.text-line')
    .allTextContents();
}

/**
 * Hold the Text tool and click at a screen point: that places a text and puts the
 * caret in it, which is the whole story of how words get onto the board. Returns
 * the new text's id.
 */
export async function createText(
  page: Page,
  at: Point,
  text = '',
): Promise<string> {
  await page.keyboard.press('t');
  await expect(textToolLayer(page)).toHaveCount(1);
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toHaveCount(1);
  if (text !== '') await page.keyboard.type(text);
  // The new text is the one the caret is in - which is a fact about the screen, and
  // far more reliable than diffing the document while other clients' objects are
  // arriving over the wire.
  const id = await page.evaluate(() => {
    const el = document.querySelector('textarea[data-testid="text-editor"]');
    return el?.closest('[data-text-id]')?.getAttribute('data-text-id') ?? null;
  });
  if (id === null) throw new Error('createText: no text was placed under the click');
  return id;
}

/** Open a text's editor by double-clicking it (the caret goes to the end). */
export async function editText(page: Page, index: number): Promise<void> {
  const box = await page.locator('[data-testid="text-object"]').nth(index).boundingBox();
  if (box === null) throw new Error(`text ${index} is not rendered`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(textEditor(page)).toHaveCount(1);
}

/** Choose a size from the text toolbar for the text currently selected. */
export async function pickTextSize(page: Page, size: string): Promise<void> {
  await page.getByTestId(`text-size-${size}`).click();
}

/** Delete the selected text with the toolbar's bin. */
export async function deleteTextViaToolbar(page: Page): Promise<void> {
  await page.getByTestId('text-toolbar-delete').click();
}
