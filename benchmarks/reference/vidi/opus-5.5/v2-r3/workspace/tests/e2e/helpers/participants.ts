// Multi-participant helpers for live-collaboration e2e (story 3).
//
// Every participant is an isolated browser context on the same `/b/<id>`. An init
// script records, in each page, when every note property first shows a value on
// that screen, so the latency of a change is measured from the moment it appears
// on the sender's screen to the moment it appears on a receiver's screen. Latency
// is logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted (the browsers,
// the server and the test runner share one machine).
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export const VIEWPORT = { width: 1280, height: 800 };

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
}

export interface SeenEvent {
  id: string;
  key: 'present' | 'x' | 'y' | 'color' | 'text' | 'badge';
  value: string;
  t: number;
}

export interface NoteOnScreen {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

declare global {
  interface Window {
    __vidi6Seen?: SeenEvent[];
    __vidi6Sockets?: number;
  }
}

/** Runs in every page before the app: records screen changes and counts WebSockets. */
function recorder(): void {
  const seen: SeenEvent[] = [];
  window.__vidi6Seen = seen;
  window.__vidi6Sockets = 0;
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      window.__vidi6Sockets = (window.__vidi6Sockets ?? 0) + 1;
    }
  };
  const last = new Map<string, string>();
  const note = (id: string, key: SeenEvent['key'], value: string, t: number) => {
    const k = `${id}\u0000${key}`;
    if (last.get(k) === value) return;
    last.set(k, value);
    seen.push({ id, key, value, t });
  };
  const scan = () => {
    const t = Date.now();
    const present = new Set<string>();
    document.querySelectorAll<HTMLElement>('[data-note-id]').forEach((el) => {
      const id = el.dataset.noteId!;
      present.add(id);
      note(id, 'present', '1', t);
      note(id, 'x', el.dataset.x ?? '', t);
      note(id, 'y', el.dataset.y ?? '', t);
      note(id, 'color', el.dataset.color ?? '', t);
      note(id, 'text', el.querySelector('.sticky-text-content')?.textContent ?? '', t);
    });
    for (const [k, v] of last) {
      const [id, key] = k.split('\u0000');
      if (key === 'present' && v === '1' && !present.has(id)) note(id, 'present', '0', t);
    }
    note('', 'badge', document.querySelector('.connection-status')?.textContent ?? '', t);
  };
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

export async function openParticipant(
  browser: Browser,
  name: string,
  boardId: string,
): Promise<Participant> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(recorder);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('dialog', (d) => {
    consoleErrors.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => window.__vidi6 !== undefined);
  await waitConnected(page);
  return { name, context, page, consoleErrors };
}

/** Opens `names.length` participants on one new board. */
export async function openParticipants(browser: Browser, names: string[], boardId = newBoardId()): Promise<Participant[]> {
  return Promise.all(names.map((n) => openParticipant(browser, n, boardId)));
}

export async function closeAll(participants: Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

export async function waitConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

export function badge(page: Page) {
  return page.locator('.connection-status');
}

/** The notes as shown on this participant's screen (DOM), sorted by id. */
export async function screenNotes(page: Page): Promise<NoteOnScreen[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'))
      .map((el) => ({
        id: el.dataset.noteId!,
        x: Number(el.dataset.x),
        y: Number(el.dataset.y),
        color: el.dataset.color ?? '',
        text: el.querySelector('.sticky-text-content')?.textContent ?? '',
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

export async function screenNote(page: Page, id: string): Promise<NoteOnScreen | undefined> {
  return (await screenNotes(page)).find((n) => n.id === id);
}

/** The text of a note in the board document (works while the note is being edited). */
export async function docText(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate((noteId) => {
    const obj = window.__vidi6!.doc.getMap('objects').get(noteId) as { get(k: string): unknown } | undefined;
    return obj ? String(obj.get('text')) : undefined;
  }, id);
}

// ---------------------------------------------------------------------------
// Latency: measured and logged, not asserted.

const latencies: { label: string; ms: number }[] = [];

export function recordLatency(label: string, ms: number, quiet = false): void {
  latencies.push({ label, ms });
  if (quiet) return;
  const verdict = ms <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'OVER';
  console.log(`[latency] ${label}: ${ms} ms (${verdict} budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Prints p50/p95/max of the latencies recorded so far (and clears them). */
export function printLatencyReport(title: string): void {
  const ms = latencies.splice(0).map((l) => l.ms).sort((a, b) => a - b);
  if (ms.length === 0) return;
  const over = ms.filter((m) => m > LIVE_UPDATE_LATENCY_BUDGET_MS).length;
  console.log(
    `[latency report] ${title}: n=${ms.length} p50=${percentile(ms, 50)} ms p95=${percentile(ms, 95)} ms ` +
      `max=${ms[ms.length - 1] ?? NaN} ms; ${over} over the ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms budget (reported, not asserted)`,
  );
}

export async function seenEvents(page: Page): Promise<SeenEvent[]> {
  return page.evaluate(() => window.__vidi6Seen ?? []);
}

/** When `key` of note `id` first showed `value` on this screen (epoch ms), if ever. */
export async function firstSeen(page: Page, id: string, key: SeenEvent['key'], value: string): Promise<number | undefined> {
  return (await seenEvents(page)).find((e) => e.id === id && e.key === key && e.value === value)?.t;
}

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) until `probe` holds on the receiver, then
 * logs how long after the sender's screen showed it the receiver's screen did.
 */
export async function expectEventually(
  label: string,
  probe: () => Promise<boolean>,
  latency?: { sender: Page; receiver: Page; id: string; key: SeenEvent['key']; value: string },
): Promise<void> {
  await expect.poll(probe, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [20, 50, 100] }).toBe(true);
  if (!latency) return;
  const sent = await firstSeen(latency.sender, latency.id, latency.key, latency.value);
  const received = await firstSeen(latency.receiver, latency.id, latency.key, latency.value);
  if (sent !== undefined && received !== undefined) recordLatency(label, Math.max(0, received - sent));
}

/** Waits until every participant's screen shows the same notes; returns that board. */
export async function expectSameBoards(participants: Participant[], timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<NoteOnScreen[]> {
  let board: NoteOnScreen[] = [];
  await expect
    .poll(
      async () => {
        const all = await Promise.all(participants.map((p) => screenNotes(p.page)));
        board = all[0];
        const first = JSON.stringify(all[0]);
        return all.every((b) => JSON.stringify(b) === first);
      },
      { timeout, intervals: [50, 100, 250] },
    )
    .toBe(true);
  return board;
}
