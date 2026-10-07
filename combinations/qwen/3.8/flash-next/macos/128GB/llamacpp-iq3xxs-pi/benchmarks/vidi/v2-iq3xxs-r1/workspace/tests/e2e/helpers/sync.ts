import { expect, type Page } from '@playwright/test';
import type { ConnectionState } from '../../../src/client/sync/connectBoard';

/**
 * Live board fixtures (story 3).
 *
 * Two screens of the same board live in *separate browser contexts*, so nothing
 * can travel between them except through the Worker (design "Two browser
 * contexts": never `page.locator` across pages). Each screen is also instrumented
 * before it loads, so a test can prove where the page's sockets went (TC-29:
 * "the test reads the network log to prove every board message went through the
 * room") and that it never opened a BroadcastChannel to talk to its own sibling.
 */

interface SocketLog {
  sockets: string[];
  received: number;
  sent: number;
  broadcastChannels: number;
}

const INSTRUMENT_NETWORK = (): void => {
  const log: SocketLog = { sockets: [], received: 0, sent: 0, broadcastChannels: 0 };
  (window as unknown as { __vidi6Network: SocketLog }).__vidi6Network = log;

  const RealSocket = window.WebSocket;
  class RoomSocket extends RealSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      log.sockets.push(String(url));
      const socket = this;
      this.addEventListener('message', () => {
        log.received += 1;
      });
      // Counted per frame, in the page itself: the room is the only peer that
      // board traffic reaches, and the counters prove it was traffic-bearing.
      socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        log.sent += 1;
        return RealSocket.prototype.send.call(socket, data as string | ArrayBuffer | ArrayBufferView);
      };
    }
  }
  window.WebSocket = RoomSocket as unknown as typeof WebSocket;

  const RealChannel = window.BroadcastChannel;
  class CountingChannel extends RealChannel {
    constructor(name: string) {
      super(name);
      log.broadcastChannels += 1;
    }
  }
  window.BroadcastChannel = CountingChannel as unknown as typeof BroadcastChannel;
};

/** Everything the page's own network did, as the page saw it. */
export function networkLog(page: Page): Promise<SocketLog> {
  return page.evaluate(() => {
    const log = (window as unknown as { __vidi6Network?: SocketLog }).__vidi6Network;
    if (!log) throw new Error('network instrumentation missing');
    return log;
  });
}

/**
 * A board that does not appear in this long means the server or the bundle is
 * wrong, not that the test is slow — fail here rather than after the whole budget.
 */
const BOOT_TIMEOUT_MS = 15_000;

async function waitForBoard(page: Page): Promise<void> {
  await page.waitForURL('**/b/*', { timeout: BOOT_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: BOOT_TIMEOUT_MS });
  await page.waitForFunction(
    () => typeof (window as any).__vidi6 !== 'undefined',
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );
}

/**
 * Open a board of this screen's own: the home page is where a board starts now, so
 * this clicks `New board` and waits for the board the server named.
 */
export async function gotoNewBoard(page: Page): Promise<string> {
  await page.addInitScript(INSTRUMENT_NETWORK);
  await page.goto('/', { timeout: BOOT_TIMEOUT_MS });
  await page.getByTestId('new-board-button').click();
  await waitForBoard(page);
  return boardId(page);
}

/**
 * Ask the running Worker for a board over the same `POST /api/boards` the home page
 * uses, and return its id. For a test that needs the id *before* it opens anything
 * (a second screen that only ever uses the link, or an address that must not exist).
 */
export async function createBoard(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
    return ((await response.json()) as { id: string }).id;
  });
}

/**
 * A second screen on the same board, in a fresh context, so the only thing that
 * can carry an edit between the two is the room.
 */
export async function openSecondScreen(first: Page): Promise<Page> {
  return openScreen(first, first.url());
}

/**
 * Another screen (fresh context) at an absolute URL. `origin` supplies the
 * scheme/host, so a test can ask for `/` (a new board) or for a board URL it read
 * from another screen.
 */
export async function openScreen(origin: Page, path: '/'): Promise<Page>;
export async function openScreen(origin: Page, url: string): Promise<Page>;
export async function openScreen(origin: Page, pathOrUrl: string): Promise<Page> {
  const browser = origin.context().browser();
  if (!browser) throw new Error('expected a browser to open a context in');
  const target = /^https?:/.test(pathOrUrl)
    ? pathOrUrl
    : new URL(pathOrUrl, origin.url()).toString();
  const page = await browser.newContext().then((context) => context.newPage());
  await page.addInitScript(INSTRUMENT_NETWORK);
  await page.goto(target, { timeout: BOOT_TIMEOUT_MS });
  // `/` is the home page now, so a caller asking for it means "another board of mine".
  if (target === new URL('/', origin.url()).toString()) {
    await page.getByTestId('new-board-button').click();
  }
  await waitForBoard(page);
  return page;
}

/** Close every context belonging to these pages (screens are opened by hand). */
export async function closeScreens(pages: readonly Page[]): Promise<void> {
  await Promise.all(
    [...new Set(pages.map((page) => page.context()))].map((context) => context.close()),
  );
}

/** The board id in this page's URL: the address *is* the board (TC-22). */
export function boardId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const match = /^\/b\/([^/]+)\/?$/.exec(window.location.pathname);
    if (!match) throw new Error(`not a board URL: ${window.location.pathname}`);
    return match[1]!;
  });
}

export function connectionState(page: Page): Promise<ConnectionState> {
  return page.evaluate(() => window.__vidi6!.getConnectionState());
}

/** Wait until the screen has synced with its room (a synced board shows no badge). */
export async function waitForSynced(page: Page): Promise<void> {
  await expect.poll(() => connectionState(page), { timeout: 15_000 }).toBe('connected');
  await expect(page.getByTestId('connection-status')).toHaveCount(0);
}

/** Close the room socket without leaving the board (a network cut looks the same). */
export async function dropConnection(page: Page): Promise<void> {
  await page.evaluate(() => window.__vidi6!.dropConnection());
  await expect(page.getByTestId('connection-status')).toHaveText('Reconnecting…');
}

/** Ask the provider for its socket back (its own reconnect, not ours). */
export async function resumeConnection(page: Page): Promise<void> {
  await page.evaluate(() => window.__vidi6!.resumeConnection());
}

/** The badge's text, or null when it is not rendered. */
export async function badgeText(page: Page): Promise<string | null> {
  const el = page.getByTestId('connection-status');
  if ((await el.count()) === 0) return null;
  return (await el.textContent()) ?? null;
}

/** The badge is gone: a board in sync says nothing (TC-19). */
export async function expectNoBadge(page: Page): Promise<void> {
  await expect(page.getByTestId('connection-status')).toHaveCount(0);
}

/** Wait until the green "Connected" confirmation appears. */
export async function waitForConfirmedBadge(page: Page): Promise<void> {
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
}

/** Text of a note by document id, or null when this screen does not show it. */
export function noteText(page: Page, id: string): Promise<string | null> {
  return page.evaluate((noteId) => {
    const inner = document.querySelector(
      `[data-note-id="${noteId}"] [data-testid="sticky-text-inner"]`,
    );
    return inner ? (inner.textContent ?? null) : null;
  }, id);
}

/** Note ids on this screen, in paint order. */
export function liveNoteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-note-id]')).map(
      (el) => (el as HTMLElement).dataset.noteId ?? '',
    ),
  );
}

/** Everything one screen shows, as one comparable string (ids, places, text). */
export function boardSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const notes = Array.from(document.querySelectorAll('[data-note-id]')).map((el) => {
      const box = el.getBoundingClientRect();
      const text = el.querySelector('[data-testid="sticky-text-inner"]')?.textContent ?? '';
      return `${(el as HTMLElement).dataset.noteId}:${Math.round(box.left)},${Math.round(box.top)}:${text}`;
    });
    return notes.sort().join('|');
  });
}

/**
 * Create a note by double-clicking empty board space, type it, and return its id.
 * A deliberate position (rather than the toolbar's "centre of the view") keeps two
 * notes from stacking, so a pointer test is about sync and not about z-order.
 */
export async function createNote(
  page: Page,
  at: { x: number; y: number },
  text: string,
): Promise<string> {
  const before = new Set(await liveNoteIds(page));
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await liveNoteIds(page)).filter((id) => !before.has(id)), { timeout: 5_000 })
    .toHaveLength(1);
  const [created] = (await liveNoteIds(page)).filter((id) => !before.has(id));
  return created!;
}

/** Wait until this screen shows the note with the expected text. */
export async function expectNoteText(
  page: Page,
  id: string,
  expected: string,
  timeout = 5_000,
): Promise<void> {
  await expect.poll(() => noteText(page, id), { timeout }).toBe(expected);
}

/** Wait until these screens show the same board content (ids, positions, text). */
export async function expectSameBoard(a: Page, b: Page, timeout = 5_000): Promise<void> {
  await expect
    .poll(
      async () => (await boardSignature(a)) === (await boardSignature(b)),
      { timeout },
    )
    .toBe(true);
}

/** Wait until every screen shows exactly the given note ids. */
export async function expectNotesOn(
  pages: readonly Page[],
  ids: readonly string[],
  timeout = 5_000,
): Promise<void> {
  const wanted = [...ids].sort().join(',');
  for (const page of pages) {
    await expect
      .poll(async () => [...(await liveNoteIds(page))].sort().join(','), { timeout })
      .toBe(wanted);
  }
}
