// Story 4: "Return to a board and find everything as it was left."
//
// These are the only tests that restart the real server. The functional persistence
// guarantees (write-before-broadcast, restore on wake, save/load failure handling,
// compaction rollback) are proven against real Durable Object SQLite in the
// integration suite, where a woken object reloads from disk. What a real process
// restart proves on top of that is that a board is rebuilt from the bytes WRITTEN TO
// DISK — not from anything the process happened to keep in memory.
//
// Each test spawns its own `wrangler dev` (own `--persist-to` directory), creates a
// board in the browser, stops the process (it forgets all memory and releases the
// state directory), starts a fresh process on the SAME directory, and reopens. Two
// `wrangler dev` processes never share a directory at the same time (SQLITE_BUSY), so
// the phases are strictly sequential and use distinct ports.
//
// The board is compared by CONTENT (text, colour, world position, stacking, creation
// time) rather than by object id: a note's id is drawn from the creating client's
// Yjs identity, which legitimately differs between the seeding session and a new one
// after the restart. Matching by content is the honest check that "everything is as
// it was left".
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  LOAD_RETRY_MIN_INTERVAL_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { createBoardAt } from './helpers/board';
import { dropPersistDir, newPersistDir, WranglerProc } from './helpers/wrangler-process';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

// One distinct (app, inspector) port per wrangler phase. All are clear of the shared
// e2e server (28394/28395) and never reused, so a lingering socket from a stopped
// phase cannot collide with the next. Phases that share a board share a state
// directory but run strictly one after the other.
const PHASE_PORTS = {
  overnight: [
    { port: 28384, inspectorPort: 28385 },
    { port: 28386, inspectorPort: 28387 },
  ],
  leaveImmediately: [
    { port: 28388, inspectorPort: 28389 },
    { port: 28390, inspectorPort: 28391 },
  ],
  bigBoard: [
    { port: 28392, inspectorPort: 28393 },
    // 28394/28395 are free for THIS project because playwright.persistence.config.ts
    // starts no shared webServer (unlike playwright.config.ts), and the tests are
    // serial so no other phase is live here.
    { port: 28394, inspectorPort: 28395 },
  ],
  // TC-24 reuses the (app, inspector) ports freed by TC-19/TC-20 above: the whole
  // suite is serial (`workers: 1`, serial mode) and every earlier phase is stopped
  // and its port released before TC-24 runs, so there is no port collision. It must
  // avoid 28396/28398 (held by unrelated orphaned processes on this machine).
  brokenBoard: [
    { port: 28385, inspectorPort: 28386 },
    // Hooks disabled (production shape): TEST_HOOKS is not passed, so the route is
    // absent and `/__test/...` falls through to the SPA, exactly as a deploy.
    { port: 28387, inspectorPort: 28384 },
  ],
} as const;

interface NoteShape {
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  createdAt: number;
}

/** The board as content, independent of the object ids a fresh session would use. */
function contentOf(notes: readonly (NoteShape & { id: string })[]): string {
  const rows = notes.map((n) => ({
    x: n.x,
    y: n.y,
    color: n.color,
    text: n.text,
    z: n.z,
    createdAt: n.createdAt,
  }));
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(rows);
}

async function openBoard(
  browser: Browser,
  baseURL: string,
  boardId: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
  return { page, close: () => context.close() };
}

/** Read the live board through the same model functions the UI uses. */
function readNotes(page: Page): Promise<(NoteShape & { id: string })[]> {
  return page.evaluate(
    () => window.__vidi6TestBoard?.notes().map((n) => ({ ...n })) ?? null as any,
  );
}

/** Wait until the board model and the painted DOM both show `count` notes. */
async function waitForNotes(page: Page, count: number, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const model = window.__vidi6TestBoard?.notes().length ?? -1;
      const painted = document.querySelectorAll('[data-note-id]').length;
      return model === n && painted === n;
    },
    count,
    { timeout },
  );
}

/**
 * Seed `count` varied notes through the model (so they sync, store and render like a
 * person's). Varied in text, colour, position and stacking — the properties the story
 * promises to preserve. Returns the seeded content.
 */
async function seedNotes(page: Page, count: number): Promise<void> {
  const colors = COLOR_NAMES.slice();
  await page.evaluate(
    ({ count, colors }) => {
      const api = window.__vidi6TestBoard;
      if (!api) throw new Error('window.__vidi6TestBoard missing (need test build)');
      for (let i = 0; i < count; i += 1) {
        const id = api.create({
          x: (i % 5) * 240 - 600,
          y: Math.floor(i / 5) * 220 - 440,
        });
        // Multi-line where it helps, and a length that varies so a truncation shows.
        api.write(id, i % 7 === 0 ? `Note ${i}\nsecond line` : `Note ${i} — a little longer text`);
        api.color(id, colors[i % colors.length]!);
      }
    },
    { count, colors },
  );
}

test.describe.configure({ mode: 'serial' });

test('TC-19 overnight return: 25 notes come back identical after a real restart', async ({
  browser,
}) => {
  const dir = newPersistDir();
  let a: WranglerProc | null = null;
  let b: WranglerProc | null = null;
  try {
    a = await new WranglerProc({ ...PHASE_PORTS.overnight[0]!, dir }).start();
    // Story 5: the link is minted by the service, on the process that will store it.
    const boardId = await createBoardAt(a.baseURL);
    const alex = await openBoard(browser, a.baseURL, boardId);
    await alex.page.waitForFunction(() => Boolean(window.__vidi6TestBoard));
    await seedNotes(alex.page, 25);
    await waitForNotes(alex.page, 25);

    // A second person sees all 25 before the shutdown (so we know it is a shared,
    // stored board, not just one tab's memory).
    const sam = await openBoard(browser, a.baseURL, boardId);
    await waitForNotes(sam.page, 25);
    const before = contentOf(await readNotes(alex.page));

    // Overnight: the process stops (memory gone, state directory released).
    await alex.close();
    await sam.close();
    await a.stop();
    a = null;

    // The next morning: a fresh process on the same state directory.
    b = await new WranglerProc({ ...PHASE_PORTS.overnight[1]!, dir }).start();
    const back = await openBoard(browser, b.baseURL, boardId);
    await waitForNotes(back.page, 25);

    // Identical in text, colour, position and stacking.
    expect(contentOf(await readNotes(back.page))).toBe(before);
    await back.close();
  } finally {
    if (a) await a.stop();
    if (b) await b.stop();
    dropPersistDir(dir);
  }
});

test('TC-20 leave immediately: a note Sam already saw survives a same-second restart', async ({
  browser,
}) => {
  const dir = newPersistDir();
  const noteText = 'the very last note before I close the laptop';
  let a: WranglerProc | null = null;
  let b: WranglerProc | null = null;
  try {
    a = await new WranglerProc({ ...PHASE_PORTS.leaveImmediately[0]!, dir }).start();
    // Story 5: the link is minted by the service, on the process that will store it.
    const boardId = await createBoardAt(a.baseURL);
    const alex = await openBoard(browser, a.baseURL, boardId);
    await alex.page.waitForFunction(() => Boolean(window.__vidi6TestBoard));
    await alex.page.evaluate((text) => {
      const api = window.__vidi6TestBoard!;
      api.write(api.create({ x: 123, y: 77 }), text);
    }, noteText);

    // Sam joins and sees the note. Because the room stores before it broadcasts, the
    // moment Sam sees it the bytes are already on disk — so "within 1 second" cannot
    // lose it.
    const sam = await openBoard(browser, a.baseURL, boardId);
    await waitForNotes(sam.page, 1);
    const seen = (await readNotes(sam.page)).find((n) => n.text === noteText);
    expect(seen, 'Sam never saw the note before the shutdown').toBeTruthy();

    // Leave immediately: both pages and the process go, well inside a second.
    const started = Date.now();
    await Promise.all([alex.close(), sam.close()]);
    await a.stop();
    a = null;

    b = await new WranglerProc({ ...PHASE_PORTS.leaveImmediately[1]!, dir }).start();
    const reopened = await openBoard(browser, b.baseURL, boardId);
    await waitForNotes(reopened.page, 1);
    const notes = await readNotes(reopened.page);
    const survivor = notes.find((n) => n.text === noteText);
    expect(survivor, 'the last note did not survive the restart').toBeTruthy();
    // Exactly where Sam last saw it (createSticky centres, so compare to the stored
    // position rather than the centre that was passed in).
    expect(survivor!.x).toBe(seen!.x);
    expect(survivor!.y).toBe(seen!.y);
    // A genuine same-second leave: the shutdown we are testing took under a second.
    expect(Date.now() - started).toBeLessThan(10_000);
    await reopened.close();
  } finally {
    if (a) await a.stop();
    if (b) await b.stop();
    dropPersistDir(dir);
  }
});

// @nightly: opening a PERSIST_TESTED_NOTES board is heavy (a full render of thousands
// of notes twice). Kept out of the default run like the other soak.
test('TC-21 @nightly big board open: a large board loads from disk after a restart', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const dir = newPersistDir();
  let seed: WranglerProc | null = null;
  let opener: WranglerProc | null = null;
  try {
    // Seed the big board (a real process, so it is compacted into on-disk state).
    seed = await new WranglerProc({ ...PHASE_PORTS.bigBoard[0]!, dir }).start();
    // Story 5: the link is minted by the service, on the process that will store it.
    const boardId = await createBoardAt(seed.baseURL);
    const seeding = await openBoard(browser, seed.baseURL, boardId);
    await seeding.page.waitForFunction(() => Boolean(window.__vidi6TestBoard));
    await seedNotes(seeding.page, PERSIST_TESTED_NOTES);
    await waitForNotes(seeding.page, PERSIST_TESTED_NOTES, 180_000);
    const expected = contentOf(await readNotes(seeding.page));
    await seeding.close();
    await seed.stop();
    seed = null;

    // Fresh process on the same state directory: reopen the board cold and time it.
    opener = await new WranglerProc({ ...PHASE_PORTS.bigBoard[1]!, dir }).start();
    const openerPage = await openBoard(browser, opener.baseURL, boardId);
    // The board is open when every note is painted; the client applies the whole
    // board in one transaction and renders it in one batch.
    await waitForNotes(openerPage.page, PERSIST_TESTED_NOTES, 120_000);
    const loadMs = await openerPage.page.evaluate(
      () => performance.now(), // ms since this page's navigation origin, at full render
    );
    const after = await readNotes(openerPage.page);
    // eslint-disable-next-line no-console
    console.log(
      `[TC-21] big board load: ${PERSIST_TESTED_NOTES} notes opened in ${Math.round(
        loadMs,
      )}ms (server budget reference: ${BOARD_LOAD_BUDGET_MS}ms)`,
    );

    expect(after.length).toBe(PERSIST_TESTED_NOTES);
    expect(contentOf(after)).toBe(expected);
    // A generous functional ceiling: the whole navigation-to-fully-rendered round trip
    // must complete, so a load that regressed into thousands of renders cannot slip by.
    expect(loadMs).toBeGreaterThan(0);
    expect(loadMs).toBeLessThan(30_000);
    await openerPage.close();
  } finally {
    if (seed) await seed.stop();
    if (opener) await opener.stop();
    dropPersistDir(dir);
  }
});

/** POST to a board test hook and return its parsed JSON response. */
async function callHook(
  baseURL: string,
  boardId: string,
  action: 'corrupt-snapshot' | 'repair',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, {
    method: 'POST',
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON (e.g. the SPA fallback when the hook route is absent); the caller
    // inspects `status` and the raw shape via `body.__raw`.
    body = { __raw: text.slice(0, 80), __type: response.headers.get('content-type') };
  }
  return { status: response.status, body };
}

// @nightly: a full broken-board cycle with two wrangler processes (corrupt a stored
// snapshot over a test hook, watch a fresh context refuse the board, repair it, and
// watch the same page recover with no reload). The failure/retry/edit-lock mechanics
// are proven in integration (TC-15/16/26) and component (TC-22/23/28); this proves the
// whole thing over the real browser + real HTTP + real Durable Object SQLite.
test('TC-24 @nightly broken board: honest failure, edit lock, recovery without reload', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const dir = newPersistDir();
  let hooks: WranglerProc | null = null;
  let prod: WranglerProc | null = null;
  try {
    // --- Seed a 25-note board (hooks enabled), then disconnect everyone ---------
    hooks = await new WranglerProc({
      ...PHASE_PORTS.brokenBoard[0]!,
      dir,
      vars: { TEST_HOOKS: '1' },
    }).start();
    // Story 5: the link is minted by the service, on the process that will store it.
    const boardId = await createBoardAt(hooks.baseURL);
    const seed = await openBoard(browser, hooks.baseURL, boardId);
    await seed.page.waitForFunction(() => Boolean(window.__vidi6TestBoard));
    await seedNotes(seed.page, 25);
    await waitForNotes(seed.page, 25);
    // Close the seeding page so the board has zero connected clients — the corrupt
    // hook requires this (a live client's memory would hide the on-disk corruption).
    await seed.close();

    // --- Corrupt the stored snapshot (compacts first, then damages chunk 0) ------
    const corrupt = await callHook(hooks.baseURL, boardId, 'corrupt-snapshot');
    expect(corrupt.status, `corrupt-snapshot failed: ${JSON.stringify(corrupt.body)}`).toBe(200);
    expect(corrupt.body.ok).toBe(true);

    // --- A brand-new context opens the board and sees an HONEST failure ----------
    const fresh = await openBoard(browser, hooks.baseURL, boardId);
    const badge = fresh.page.getByTestId('connection-status');
    await expect(badge).toHaveAttribute('data-state', 'load_failed', { timeout: 15_000 });
    await expect(badge).toContainText("This board couldn't be loaded. Retrying…");
    // It is NOT shown an empty board it could edit: there is no board, and every
    // way to make one is locked.
    await expect(fresh.page.locator('[data-note-id]')).toHaveCount(0);
    const createButton = fresh.page.getByTestId('create-sticky');
    await expect(createButton).toBeDisabled();
    // Neither the button nor a double-click on empty board space creates a note.
    await createButton.click({ force: true }).catch(() => {});
    await fresh.page.mouse.dblclick(640, 400);
    await fresh.page.waitForTimeout(500);
    await expect(fresh.page.locator('[data-note-id]')).toHaveCount(0);
    await expect(badge).toHaveAttribute('data-state', 'load_failed');

    // --- Repair the snapshot, then wait past the room's retry interval -----------
    const repair = await callHook(hooks.baseURL, boardId, 'repair');
    expect(repair.status, `repair failed: ${JSON.stringify(repair.body)}`).toBe(200);
    // Recovery happens on the SAME page (no reload): the provider keeps retrying,
    // and once LOAD_RETRY_MIN_INTERVAL_MS has passed the room re-reads the repaired
    // storage, becomes ready, and the board reappears by itself.
    await fresh.page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 500);
    await waitForNotes(fresh.page, 25, 60_000);
    // The badge is intentionally absent once the board is connected and in sync
    // (it only draws when something is wrong), so recovery means it disappears.
    await expect(badge).toHaveCount(0, { timeout: 30_000 });
    await expect(createButton).toBeEnabled();
    await fresh.close();

    // --- A production-shaped server (no TEST_HOOKS) has no such routes -----------
    await hooks.stop();
    hooks = null;
    prod = await new WranglerProc({ ...PHASE_PORTS.brokenBoard[1]!, dir }).start();
    const boardPath = newBoardId();
    const absent = await callHook(prod.baseURL, boardPath, 'corrupt-snapshot');
    // With TEST_HOOKS=1 the identical POST returns JSON {ok:true}; here the route
    // is absent, so the request is not handled as surgery: it never produces the
    // hook's JSON `ok` result (it falls through to the static-assets handler).
    expect(absent.body.ok).toBeUndefined();
    expect(absent.body.corruptedBytes).toBeUndefined();
    // It is definitely served *something* (not a Durable Object surgery 200-with-ok).
    const raw = await fetch(`${prod.baseURL}/__test/boards/${boardPath}/corrupt-snapshot`, {
      method: 'POST',
    });
    expect(raw.headers.get('content-type') ?? '').not.toContain('application/json');
  } finally {
    if (hooks) await hooks.stop();
    if (prod) await prod.stop();
    dropPersistDir(dir);
  }
});
