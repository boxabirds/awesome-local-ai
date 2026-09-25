/**
 * Multi-person e2e helpers (design E2E): each participant is an isolated browser context
 * on the same `/b/<newBoardId()>`, talking to the real `wrangler dev` BoardRoom.
 */
import { expect, type Browser, type BrowserContext, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import type { Point } from '../../../src/client/canvas/camera';

/** Poll often so the measured latency is not dominated by the polling interval. */
const POLL_INTERVAL_MS = 10;
const JOIN_TIMEOUT_MS = 15_000;

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught page errors seen so far. */
  errors: string[];
  /** Dialogs (alert/confirm) the page tried to open. */
  dialogs: string[];
  /** Cuts / restores this participant's network, including open board sockets. */
  setOnline(online: boolean): Promise<void>;
}

/** Close code the simulated outage uses for dropped board sockets ("going away"). */
const OUTAGE_CLOSE_CODE = 1001;

/**
 * `context.setOffline` blocks new requests but does not reliably cut a WebSocket that is
 * already open, so board sockets are proxied: going offline drops them and refuses new
 * ones until the network is back, exactly like a lost connection.
 */
async function routeBoardSockets(context: BrowserContext): Promise<(online: boolean) => void> {
  let online = true;
  const live = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  await context.routeWebSocket(/\/api\/rooms\//, (ws) => {
    if (!online) {
      void ws.close({ code: OUTAGE_CLOSE_CODE, reason: 'offline' });
      return;
    }
    const pair = { page: ws, server: ws.connectToServer() };
    live.add(pair);
    ws.onClose(() => live.delete(pair));
    pair.server.onClose(() => live.delete(pair));
  });
  return (next) => {
    online = next;
    if (next) return;
    for (const pair of live) {
      void pair.page.close({ code: OUTAGE_CLOSE_CODE, reason: 'offline' });
      void pair.server.close();
    }
    live.clear();
  };
}

/** `baseURL` targets another server than the shared one (story 4 restart tests). */
export async function openParticipant(browser: Browser, boardId: string, name: string, baseURL?: string): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(baseURL === undefined ? {} : { baseURL }) });
  const setSockets = await routeBoardSockets(context);
  const page = await context.newPage();
  const setOnline = async (online: boolean) => {
    setSockets(online);
    await context.setOffline(!online);
  };
  const p: Participant = { name, context, page, errors: [], dialogs: [], setOnline };
  page.on('console', (m) => {
    if (m.type() === 'error') p.errors.push(m.text());
  });
  page.on('pageerror', (e) => p.errors.push(e.message));
  page.on('dialog', (d) => {
    p.dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto(`/b/${boardId}`);
  await waitConnected(page);
  return p;
}

/** Opens `names.length` participants on one fresh board. */
export async function openParticipants(browser: Browser, names: string[], boardId = newBoardId()): Promise<Participant[]> {
  return Promise.all(names.map((n) => openParticipant(browser, boardId, n)));
}

export async function closeAll(participants: Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

export async function waitConnected(page: Page, timeout = JOIN_TIMEOUT_MS): Promise<void> {
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, { timeout });
}

/** `expect.poll` whose timeout is exactly the live-update latency budget. */
export function expectWithin<T>(fn: () => Promise<T>, message?: string) {
  return expect.poll(fn, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, intervals: [POLL_INTERVAL_MS], message });
}

export function notes(page: Page): Locator {
  return page.getByRole('group', { name: 'Sticky note' });
}

export function note(page: Page, id: string): Locator {
  return page.locator(`[data-id="${id}"]`);
}

export interface DomNote {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

/** Every note on the page as rendered, sorted by id. */
export async function domSnapshot(page: Page): Promise<DomNote[]> {
  return notes(page).evaluateAll((els) =>
    els
      .map((el) => {
        const h = el as HTMLElement;
        return {
          id: h.dataset.id ?? '',
          x: parseFloat(h.style.left),
          y: parseFloat(h.style.top),
          color: h.dataset.color ?? '',
          text: h.querySelector('.sticky-text-content')?.textContent ?? '',
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

export async function noteState(page: Page, id: string): Promise<DomNote | null> {
  const all = await domSnapshot(page);
  return all.find((n) => n.id === id) ?? null;
}

export async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Double-clicks empty board at `at`, leaves the editor, returns the new note's id. */
export async function createNoteAt(page: Page, at: Point, text = ''): Promise<string> {
  const before = new Set((await domSnapshot(page)).map((n) => n.id));
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeFocused();
  const id = await editor.evaluate((el) => (el.closest('[data-id]') as HTMLElement).dataset.id!);
  expect(before.has(id), 'double-click must land on empty board').toBe(false);
  if (text !== '') await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  return id;
}

export async function dragBy(page: Page, from: Point, dx: number, dy: number, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}
