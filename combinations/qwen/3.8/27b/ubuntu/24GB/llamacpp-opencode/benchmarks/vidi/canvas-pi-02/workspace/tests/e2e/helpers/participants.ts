import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';
import { getNotes, setCamera } from './board';

/** Camera shared by all participants so pixel math is identical on every page. */
export const HOME_CAMERA = { x: -640, y: -400, zoom: 1 };

/**
 * One isolated browser context on a shared board, synced and ready.
 *
 * Each participant is a separate context (separate cache, separate
 * connection) pointed at the same `/b/<boardId>` — that is exactly the
 * "two people, same board" scenario, driven over the real `wrangler dev`
 * serving path.
 */
export interface Participant {
  readonly context: BrowserContext;
  readonly page: Page;
  /** The board id this participant joined. */
  readonly boardId: string;
  /** Uncaught page errors (JS exceptions) — the "no console errors" asserts read this. */
  readonly pageErrors: Error[];
  /** Console messages (informational; some suites assert on their absence). */
  readonly consoleLines: string[];
  /** Close the context (calls the client's destroy path on unload). */
  close(): Promise<void>;
}

/** A fresh, random board id for a test (never shared across tests). */
export function freshBoardId(): string {
  return newBoardId();
}

/**
 * Open a new isolated context on `/b/<boardId>`, wait until the client's
 * mapped state is `connected` (socket open AND state exchanged — the
 * provider's `sync` event), and park the camera so geometry is stable.
 *
 * `expectState: 'load_failed'` (TC-24) waits for the other end-state instead:
 * the room refused the connection with 4500 and the client is retrying.
 */
/**
 * POST /api/boards → create a board and return its (server-generated) id.
 * Since story 5 a board must exist before it can be opened, so e2e tests
 * create boards up front instead of just making up an id.
 */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  if (res.status() !== 201) {
    throw new Error(`board creation failed: HTTP ${res.status()}`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Boards ensured by `join()` for this worker, keyed by the requested board
 * id. The value is the PROMISE for the real (server-generated) id, not the
 * id itself: parallel joins of the same fresh id (Promise.all of join() —
 * every multi-participant test) must funnel through one GET+POST, otherwise
 * each joiner creates its own board and the others watch empty boards.
 */
const ensuredBoards = new Map<string, Promise<string>>();

/**
 * Ensure `/api/boards/<boardId>` exists and resolve its real id: the
 * requested id when the board already exists, the server-generated id of
 * the board created for it otherwise. Concurrent callers share one flight.
 */
function ensureBoard(request: APIRequestContext, boardId: string): Promise<string> {
  let pending = ensuredBoards.get(boardId);
  if (pending === undefined) {
    pending = (async () => {
      const check = await request.get(`/api/boards/${boardId}`);
      if (check.status() === 200) return boardId;
      return createBoard(request);
    })();
    ensuredBoards.set(boardId, pending);
    // Drop the entry on failure so a later join can retry.
    void pending.catch(() => {
      ensuredBoards.delete(boardId);
    });
  }
  return pending;
}

export async function join(
  browser: Browser,
  boardId: string,
  opts: { expectState?: 'connected' | 'load_failed' } = {},
): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors: Error[] = [];
  const consoleLines: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err as Error));
  page.on('console', (msg) => consoleLines.push(msg.text()));

  // Since story 5 an unknown board id renders "Board not found" before any
  // connection is attempted. For the connected path, a fresh id is created
  // on the fly (the server generates the real id); repeated joins of the
  // same fresh id within one worker reuse it.
  let id = boardId;
  if (opts.expectState !== 'load_failed') {
    id = await ensureBoard(context.request, boardId);
  }

  await page.goto(`/b/${id}`);
  if (opts.expectState === 'load_failed') {
    await expectLoadFailed(page);
  } else {
    await expectConnected(page);
  }
  await setCamera(page, HOME_CAMERA);
  return {
    context,
    page,
    boardId: id,
    pageErrors,
    consoleLines,
    close: () => context.close(),
  };
}

/** Wait until the client's mapped connection state is `load_failed`. */
export async function expectLoadFailed(page: Page, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6?.connectionState ?? null,
        ),
      { timeout: timeoutMs, intervals: [50], message: 'client should reach the load_failed state' },
    )
    .toBe('load_failed');
}

/** Wait until the client's mapped connection state is `connected`. */
export async function expectConnected(page: Page, timeoutMs = 15_000): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6?.connectionState ?? null),
      { timeout: timeoutMs, intervals: [50], message: 'client should reach the connected state' },
    )
    .toBe('connected');
}

/**
 * `expectWithin`: an `expect.poll` capped at the PRD's live-propagation
 * budget (sender-side to receiver-side). 20 ms poll intervals keep the
 * measurement close to the true arrival time.
 */
export function expectWithin<T>(
  probe: () => Promise<T> | T,
  expected: T,
  message?: string,
): Promise<void> {
  return expect.poll(probe, {
    timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    intervals: [20],
    message: message ?? `should be visible within the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms live-update budget`,
  }).toBe(expected);
}

/** Convenience: expectWithin on a note count for a participant. */
export function expectNoteCountWithin(participant: Participant, count: number): Promise<void> {
  return expectWithin(() => getNotes(participant.page).then((n) => n.length), count);
}

/** Drag a note from (fromX, fromY) by (dx, dy) CSS pixels (one gesture). */
export async function dragNote(
  page: Page,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + dx, fromY + dy, { steps: 10 });
  await page.mouse.up();
}

/** Double-click empty board space at (x, y) creates a note centred there. */
export async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.keyboard.press('Escape');
}

