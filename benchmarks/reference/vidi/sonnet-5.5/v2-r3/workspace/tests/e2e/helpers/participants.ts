import { expect, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';
import { setCamera } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  /** Simulates losing (or regaining) the network, including already-open WebSockets. */
  setOffline(offline: boolean): Promise<void>;
}

export interface NoteState {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

export const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

/** Opens N isolated browser contexts on one board and waits until each is synced. */
export async function openParticipants(
  browser: Browser,
  names: string[],
  opts: { boardId?: string; zoom?: number } = {},
): Promise<{ boardId: string; people: Participant[] }> {
  const boardId = opts.boardId ?? newBoardId();
  const people: Participant[] = [];
  for (const name of names) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    // Sockets go through a proxy so an outage can also cut connections that are already open
    // (context.setOffline alone does not close an established WebSocket in Chromium).
    const net = { down: false, open: [] as WebSocketRoute[] };
    await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
      if (net.down) {
        void ws.close();
        return;
      }
      ws.connectToServer();
      net.open.push(ws);
    });
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    if (opts.zoom) await setCamera(page, 0, 0, opts.zoom);
    people.push({
      name,
      context,
      page,
      consoleErrors,
      setOffline: async (offline) => {
        net.down = offline;
        await context.setOffline(offline);
        if (offline) await Promise.all(net.open.splice(0).map((ws) => ws.close()));
      },
    });
  }
  return { boardId, people };
}

export async function closeAll(people: Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.context.close()));
}

export async function waitConnected(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

/** Every note as the user sees it, sorted by id. */
export async function boardState(page: Page): Promise<NoteState[]> {
  const list = await notes(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      const area = e.querySelector('textarea');
      return {
        id: e.dataset.id ?? '',
        x: parseFloat(e.style.left),
        y: parseFloat(e.style.top),
        color: e.dataset.color ?? '',
        text: area ? area.value : (e.querySelector('.sticky-text')?.textContent ?? ''),
      };
    }),
  );
  return list.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const latencies: number[] = [];

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) for `read` to equal `expected`, and logs how long it took against
 * LIVE_UPDATE_LATENCY_BUDGET_MS. The budget is reported, never asserted: browsers and server share one machine.
 */
export async function expectEventually<T>(label: string, read: () => Promise<T>, expected: T): Promise<number> {
  const start = Date.now();
  await expect.poll(read, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [25, 50, 100, 250] }).toEqual(expected);
  const ms = Date.now() - start;
  latencies.push(ms);
  const flag = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ' (over budget, not asserted)' : '';
  console.log(`[latency] ${label}: ${ms} ms / budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms${flag}`);
  return ms;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function logLatencyReport(values: number[]): void {
  console.log(
    `[latency] n=${values.length} p50=${percentile(values, 50)} ms p95=${percentile(values, 95)} ms ` +
      `max=${Math.max(0, ...values)} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, not asserted)`,
  );
}
