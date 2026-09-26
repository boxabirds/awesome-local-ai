/**
 * Story 5 — share e2e workflows (TC-26..TC-31) against the real worker +
 * Durable Object + WebSocket stack (wrangler dev with TEST_HOOKS enabled).
 *
 * The specs exercise the production paths end to end: POST /api/boards, the
 * BoardPage existence check, the Share panel's Clipboard API path, and
 * multi-context collaboration over the same board link.
 */
import * as Y from 'yjs';
import { test, expect, type Page } from '@playwright/test';
import {
  newBoardId,
  createNoteAt,
  typeInNote,
  getNotes,
  getNote,
  waitForSynced,
} from './participants';


/** Mirrors src/shared/config (e2e cannot use the `@` alias). */
const CREATE_BUDGET_MS = 2000;
const BOARD_CREATE_LIMIT = 10;
const RATE_LIMITED_TEXT = "You're creating boards too quickly. Wait a minute and try again.";

/** In-page server test hook: GET/POST /__test/boards/:id/:op. */
async function hook(
  page: Page,
  boardId: string,
  op: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  return page.evaluate(async ({ id, op, body }) => {
    const res = await fetch(`/__test/boards/${id}/${op}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }, { id: boardId, op, body });
}

/** Creates the board via the test hook and returns once it exists. */
async function initialize(page: Page, boardId: string): Promise<void> {
  const r = await hook(page, boardId, 'initialize');
  expect(r.status).toBe(200);
}

const toB64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');

/** Three sticky notes as full-state Yjs updates (base64), legacy shape. */
function legacyUpdates(): string[] {
  const doc = new Y.Doc();
  const objects = doc.getMap('objects');
  doc.getMap('meta').set('schemaVersion', 1);
  const specs = [
    { x: 0, y: 0, color: 'yellow', text: 'legacy one' },
    { x: 200, y: 0, color: 'pink', text: 'legacy two' },
    { x: 400, y: 0, color: 'blue', text: 'legacy three' },
  ];
  const updates: string[] = [];
  specs.forEach((n, i) => {
    const obj = new Y.Map();
    obj.set('type', 'sticky');
    obj.set('x', n.x);
    obj.set('y', n.y);
    obj.set('color', n.color);
    obj.set('text', new Y.Text(n.text));
    obj.set('z', i + 1);
    obj.set('createdAt', 1_700_000_000_000 + i);
    doc.transact(() => {
      objects.set(`legacy-note-${i}`, obj);
    });
    updates.push(toB64(Y.encodeStateAsUpdate(doc)));
  });
  return updates;
}

test.describe('story 5: share workflows', () => {
  // Generous budget: multi-step browser workflows against a local wrangler.
  test.describe.configure({ timeout: 90_000 });

  test('TC-26: create, share, join', async ({ browser }) => {
    const mayaCtx = await browser.newContext();
    await mayaCtx.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:8787',
    });
    const maya = await mayaCtx.newPage();
    await maya.goto('/');

    // Create a board; it must be visible within CREATE_BUDGET_MS.
    await maya.getByRole('button', { name: 'Create a board' }).click();
    const shown = () => maya.locator('[data-testid="board-viewport"]').isVisible();
    await expect
      .poll(shown, { timeout: CREATE_BUDGET_MS, message: 'board visible within CREATE_BUDGET_MS' })
      .toBe(true);
    await waitForSynced(maya);

    // Maya adds a note.
    const noteId = await createNoteAt(maya, 400, 300);

    // Share -> Copy link -> "Link copied"; the clipboard holds the link.
    await maya.getByTestId('share-button').click();
    const link = await maya.getByTestId('share-link-input').inputValue();
    await maya.getByTestId('copy-link-button').click();
    await expect(maya.getByTestId('copy-link-button')).toHaveText('Link copied');
    const clipboard = await maya.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(link);

    // Sam (a fresh context) opens the clipboard text: same board, same note.
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await sam.goto(clipboard);
    await sam.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
    await waitForSynced(sam);
    expect(await getNote(sam, noteId)).not.toBeNull();

    // Sam edits Maya's note; Maya sees the edit live.
    await typeInNote(sam, noteId, 'hello from Sam');
    await expect
      .poll(async () => (await getNote(maya, noteId))?.text, { timeout: 5_000 })
      .toBe('hello from Sam');

    await mayaCtx.close();
    await samCtx.close();
  });

  test('TC-27: bad link -> Board not found -> Create a new board', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/b/' + newBoardId()); // never created
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    expect(page.url()).toMatch(/\/b\//);

    await page.getByRole('button', { name: 'Create a new board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 5_000 });
    expect(page.url()).toMatch(/^https?:\/\/[^/]+\/b\/[a-zA-Z0-9_-]{22}$/);
    // Fresh and empty.
    expect(await getNotes(page)).toHaveLength(0);

    await context.close();
  });

  test('TC-28: flaky service on open -> retrying status, recovers without a reload', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const id = newBoardId();

    // The board exists, so the recovered check succeeds.
    await page.goto('/');
    await initialize(page, id);

    // Block the existence check: the board page must show the retrying state.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto('/b/' + id);
    await expect(page.getByTestId('board-unreachable')).toBeVisible();
    await expect(page.getByTestId('board-unreachable')).toHaveText("Couldn't reach vidi6. Retrying…");
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__story5NoReload = true;
    });

    // The service recovers: the next retry opens the board in the SAME document.
    await page.unroute('**/api/boards/*');
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__story5NoReload)).toBe(true);
    expect(await getNotes(page)).toHaveLength(0);

    await context.close();
  });

  test('TC-29: clipboard blocked -> manual copy with the full link selected', async ({ browser }) => {
    const context = await browser.newContext();
    // Block the Clipboard API for every document in this context.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
        configurable: true,
      });
    });
    const page = await context.newPage();
    const id = newBoardId();

    await page.goto('/');
    await initialize(page, id);
    await page.goto('/b/' + id);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });

    await page.getByTestId('share-button').click();
    const input = page.getByTestId('share-link-input');
    const link = await input.inputValue();
    await page.getByTestId('copy-link-button').click();
    await expect(page.getByTestId('manual-copy-message')).toBeVisible();

    // The input is focused and FULLY selected; the selection is the full link.
    const selected = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[data-testid="share-link-input"]');
      if (!el || document.activeElement !== el) return null;
      return el.selectionStart === 0 && el.selectionEnd === el.value.length ? el.value : null;
    });
    expect(selected).toBe(link);
    expect(link).toBe(new URL(page.url()).origin + '/b/' + id);

    await context.close();
  });

  test(`TC-30: abuse guard -> ${BOARD_CREATE_LIMIT + 1}th creation in a window is rate limited`, async ({ browser }) => {
    const context = await browser.newContext();
    // A dedicated visitor key: exactly BOARD_CREATE_LIMIT allowed, then 429.
    await context.setExtraHTTPHeaders({
      'x-test-visitor': `tc30-${crypto.randomUUID()}`,
    });
    const page = await context.newPage();
    await page.goto('/');

    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const status = await page.evaluate(async () => (await fetch('/api/boards', { method: 'POST' })).status);
      expect(status, `creation ${i + 1} should be allowed`).toBe(201);
    }

    // The next creation through the UI shows the rate-limit message, and no
    // navigation happened (still on the home page).
    await page.getByRole('button', { name: 'Create a board' }).click();
    await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED_TEXT);
    expect(page.url()).toMatch(/\/$/);

    await context.close();
  });

  test('TC-31: pre-existing (legacy) board opens with its notes', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const id = newBoardId();

    // Seed the legacy shape: schema + update rows, NO created_at. (The hook
    // runs in-page, so the page needs the app origin first.)
    await page.goto('/');
    const updates = legacyUpdates();
    const seeded = await hook(page, id, 'seed-legacy', { updates });
    expect(seeded.status).toBe(200);
    expect(seeded.json.seeded).toBe(updates.length);
    expect(seeded.json.storage.createdAt).toBeNull();

    // The seed constructed the room on empty storage: force a reload so its
    // doc reflects the seeded rows (the room instance is reused by the WS).
    await hook(page, id, 'simulate-reconstruct');

    // Opening its link renders the board with the seeded notes.
    await page.goto('/b/' + id);
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
    await waitForSynced(page);
    const notes = await getNotes(page);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.text).sort()).toEqual(['legacy one', 'legacy three', 'legacy two']);

    await context.close();
  });
});
