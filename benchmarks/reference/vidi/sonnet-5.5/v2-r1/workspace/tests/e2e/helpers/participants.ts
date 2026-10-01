import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { createBoardId } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

export interface NoteView {
  id: string;
  left: number;
  top: number;
  background: string;
  text: string;
}

const VIEWPORT = { width: 1280, height: 800 };

export const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });
/** The connection badge; the zoom label is also an `<output>` (role status), so match on text. */
export const badge = (page: Page) => page.getByRole('status').filter({ hasText: /connect/i });

/** Opens `count` isolated browser contexts on the same board and waits until each is synced. */
export async function openParticipants(
  browser: Browser,
  count: number,
  boardId?: string,
): Promise<Participant[]> {
  boardId ??= await createBoardId();
  const names = ['Alex', 'Sam', 'Robin', 'Kim', 'Jo', 'Pat', 'Lee'];
  const people: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL: 'http://localhost:8787' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/WebSocket|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text());
    });
    await page.goto(`/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor();
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    people.push({ name: names[i] ?? `P${i}`, context, page, errors });
  }
  return people;
}

/**
 * Lets a test cut one participant's network. `context.setOffline` does not close WebSockets that are already
 * open, so the board socket is proxied: going offline closes it and refuses reconnect attempts until restored.
 */
export async function controlNetwork(person: Participant) {
  let offline = false;
  const open = new Set<WebSocketRoute>();
  await person.page.routeWebSocket(/\/api\/rooms\//, (ws) => {
    if (offline) {
      void ws.close({ code: 1006 });
      return;
    }
    const server = ws.connectToServer();
    open.add(ws);
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    ws.onClose(() => open.delete(ws));
  });
  return {
    async setOffline(value: boolean) {
      offline = value;
      await person.context.setOffline(value);
      if (value) for (const ws of [...open]) await ws.close({ code: 1006 });
    },
  };
}

export async function closeAll(people: Participant[]) {
  await Promise.all(people.map((p) => p.context.close()));
}

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) for `probe` to return true, then logs how long it took against
 * LIVE_UPDATE_LATENCY_BUDGET_MS. The budget is reported, never asserted: browsers and server share one machine.
 */
export async function expectEventually(label: string, probe: () => Promise<boolean>, startedAt = Date.now()) {
  await expect.poll(probe, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [25, 50, 100, 250] }).toBe(true);
  const ms = Date.now() - startedAt;
  latencies.push(ms);
  console.log(`[latency] ${label}: ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms${ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ', OVER' : ''})`);
  return ms;
}

export const latencies: number[] = [];

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function logLatencyReport(label: string, values: number[]) {
  console.log(
    `[latency] ${label}: n=${values.length} p50=${percentile(values, 50)} ms p95=${percentile(values, 95)} ms max=${percentile(values, 100)} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, reported not asserted)`,
  );
}

export async function noteViews(page: Page): Promise<NoteView[]> {
  const views = await notes(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        id: e.dataset.noteId ?? '',
        left: parseFloat(e.style.left),
        top: parseFloat(e.style.top),
        background: e.style.background,
        text: e.querySelector('.sticky-text-inner')?.textContent ?? '',
      };
    }),
  );
  return views.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function noteView(page: Page, id: string): Promise<NoteView | undefined> {
  return (await noteViews(page)).find((n) => n.id === id);
}

export async function newNoteAt(page: Page, x: number, y: number): Promise<string> {
  const before = new Set((await noteViews(page)).map((n) => n.id));
  await page.mouse.dblclick(x, y);
  await expect(page.getByRole('textbox')).toBeFocused();
  const after = await noteViews(page);
  const created = after.find((n) => !before.has(n.id));
  if (!created) throw new Error('note was not created');
  return created.id;
}

export async function dragNote(page: Page, id: string, dx: number, dy: number) {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error('note not visible');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

export async function sameBoard(people: Participant[]): Promise<boolean> {
  const views = await Promise.all(people.map((p) => noteViews(p.page)));
  const first = JSON.stringify(views[0]);
  return views.every((v) => JSON.stringify(v) === first);
}
