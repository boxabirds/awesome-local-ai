/**
 * Story 3 e2e helpers: drive real browser contexts against the `wrangler dev` stack
 * (client + entry Worker + `BoardRoom` Durable Object), and read the live `Y.Doc` the
 * client holds through the `window.__vidi6` test hook.
 */
import { expect, type Browser, type Page } from '@playwright/test';

interface VidiWindow {
  __vidi6?: { getDoc(): { getMap(name: string): { keys(): Iterable<string> } } };
}

const CONNECTED = '.test-connection-status[data-status="online"]';

/** The note ids in the page's live document. */
export function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from((window as unknown as VidiWindow).__vidi6!.getDoc().getMap('objects').keys()),
  );
}

/** Navigate to a board id and wait until its room connection reports online. */
export async function openBoardId(page: Page, boardId: string, base = ''): Promise<void> {
  await page.goto(`${base}/b/${boardId}`);
  await page.waitForFunction(() => typeof (window as unknown as VidiWindow).__vidi6 === 'object');
  await expect(page.locator(CONNECTED)).toBeVisible();
}

/** A brand-new page in its own context opened on `boardId` (isolated browser state). */
export async function newBoardPage(browser: Browser, boardId: string, base = ''): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await openBoardId(page, boardId, base);
  return page;
}

/** The `/b/:boardId` id read from the live URL. */
export function boardIdOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = /^\/b\/([^/]+)/.exec(location.pathname);
    if (!m) throw new Error(`not a board route: ${location.pathname}`);
    return decodeURIComponent(m[1]!);
  });
}

/** The connection badge label currently shown. */
export function connectionLabel(page: Page): Promise<string> {
  return page.locator('.test-connection-status').innerText();
}

/** Wait for the badge to read Connected (override the timeout for reconnect scenarios). */
export async function waitForConnected(page: Page, timeout?: number): Promise<void> {
  await expect(page.locator(CONNECTED)).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Create a note via the toolbar and return its id (the board's id set grows by it). */
export async function createNote(page: Page): Promise<string> {
  const before = new Set(await noteIds(page));
  await page.getByTestId('create-sticky').click();
  const added = (await noteIds(page)).filter((id) => !before.has(id));
  if (added.length !== 1) throw new Error(`expected one new note, saw ${added.length}`);
  return added[0]!;
}

/**
 * Click the toolbar create button without asserting an id diff. Use this for genuinely
 * concurrent edits — when several editors create at once, another editor's note can land
 * between a `createNote` before/after read, so a single-editor diff is the wrong assertion.
 */
export async function addNote(page: Page): Promise<void> {
  await page.getByTestId('create-sticky').click();
}

/** Poll in-page until the note id set satisfies `predicate` (Playwright-bounded). */
export async function waitForNoteIds(page: Page, predicate: (ids: string[]) => boolean): Promise<void> {
  await expect
    .poll(() => noteIds(page).then((ids) => (predicate(ids) ? ids.length : -1)), { timeout: 5_000 })
    .toBeGreaterThan(-1);
}

/** Assert two pages currently hold exactly the same, non-empty note id set. */
export async function expectSameNotes(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const x = [...(await noteIds(a))].sort().join(',');
        const y = [...(await noteIds(b))].sort().join(',');
        return x === y && x.length > 0 ? 1 : 0;
      },
      { timeout: 5_000 },
    )
    .toBe(1);
}

/** The current text of a note in the page's live document. */
export function noteText(page: Page, id: string): Promise<string> {
  return page.evaluate((noteId) => {
    const doc = (window as unknown as { __vidi6: { getDoc(): unknown } }).__vidi6!.getDoc() as {
      getMap(name: string): { get(k: string): unknown };
    };
    const entry = doc.getMap('objects').get(noteId) as { get(k: string): unknown } | undefined;
    const text = entry?.get('text') as { toString(): string } | undefined;
    return text ? text.toString() : '';
  }, id);
}

/** Append text to a note through the page's own Y.Doc (a genuine local edit that syncs). */
export async function appendNoteText(page: Page, id: string, value: string): Promise<void> {
  await page.evaluate(
    ([noteId, text]) => {
      const doc = (window as unknown as { __vidi6: { getDoc(): unknown } }).__vidi6!.getDoc() as {
        getMap(name: string): { get(k: string): unknown };
        transact(fn: () => void): void;
      };
      const entry = doc.getMap('objects').get(noteId) as { get(k: string): unknown };
      const ytext = entry.get('text') as { length: number; insert(index: number, s: string): void };
      doc.transact(() => ytext.insert(ytext.length, text));
    },
    [id, value] as const,
  );
}

/** Wait until a note's text in `page` contains `needle`. */
export async function waitForNoteText(page: Page, id: string, needle: string): Promise<void> {
  await expect
    .poll(() => noteText(page, id).then((t) => (t.includes(needle) ? 1 : 0)), { timeout: 5_000 })
    .toBe(1);
}

/** Read a scalar field (`x`, `y`, `color`) of a note from the page's live document. */
export function noteField(page: Page, id: string, field: string): Promise<unknown> {
  return page.evaluate(
    ([noteId, key]) => {
      const doc: any = (window as any).__vidi6.getDoc();
      const entry = doc.getMap('objects').get(noteId) as { get(k: string): unknown } | undefined;
      return entry ? entry.get(key) : undefined;
    },
    [id, field] as const,
  );
}

/**
 * Set a scalar field of a note through the page's own Y.Doc (inside a transaction, so it
 * propagates to peers like a real move / recolour edit) without waiting for the peer.
 */
export async function setNoteField(
  page: Page,
  id: string,
  field: string,
  value: string | number,
): Promise<void> {
  await page.evaluate(
    ([noteId, key, val]) => {
      const doc: any = (window as any).__vidi6.getDoc();
      const entry = doc.getMap('objects').get(noteId) as { set(k: string, v: unknown): void };
      doc.transact(() => {
        entry.set(key, val);
      });
    },
    [id, field, value] as const,
  );
}

/** Poll in `page` until a note's scalar field equals `value` (propagation within budget). */
export async function waitForNoteField(
  page: Page,
  id: string,
  field: string,
  value: string | number,
): Promise<void> {
  await expect
    .poll(() => noteField(page, id, field).then((v) => (v === value ? 1 : 0)), { timeout: 5_000 })
    .toBe(1);
}

/** Select a note in `page` by clicking it (a purely local selection). */
export async function selectNote(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).click();
}

/** The `data-selected` value a peer currently renders for a note (selection is never shared). */
export function selectedOf(page: Page, id: string): Promise<string | null> {
  return page
    .locator(`[data-testid="sticky-note"][data-note-id="${id}"]`)
    .getAttribute('data-selected');
}

