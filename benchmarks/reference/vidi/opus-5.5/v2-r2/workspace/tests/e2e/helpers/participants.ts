import { type Browser, type BrowserContext, type Page, type TestInfo, expect } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { openBoard } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors and dialogs seen on this page. */
  problems: string[];
}

const NAMES = ['Alex', 'Sam', 'Kim', 'Noor', 'Lee', 'Ravi', 'Ola'];

/** Creates a board through the real API (story 5), as New board does. */
export async function createBoardIn(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const response = await context.request.post('/api/boards');
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  } finally {
    await context.close();
  }
}

/** Opens `count` isolated browser contexts on the same (by default new) board and waits until each is live. */
export async function openParticipants(
  browser: Browser,
  count: number,
  boardId?: string,
  opts: { beforeOpen?(page: Page, index: number): Promise<void> } = {},
): Promise<Participant[]> {
  boardId ??= await createBoardIn(browser);
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      // Counts WebSocket connection attempts (reconnects show up as extra attempts).
      await context.addInitScript(() => {
        const Native = window.WebSocket;
        const w = window as unknown as { __wsAttempts: number };
        w.__wsAttempts = 0;
        window.WebSocket = new Proxy(Native, {
          construct(target, args: ConstructorParameters<typeof WebSocket>) {
            w.__wsAttempts++;
            return new target(...args);
          },
        });
      });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      page.on('dialog', (dialog) => {
        problems.push(`dialog: ${dialog.message()}`);
        void dialog.dismiss();
      });
      await opts.beforeOpen?.(page, i);
      await openBoard(page, `/b/${boardId}`);
      return { name: NAMES[i] ?? `P${i + 1}`, context, page, problems };
    }),
  );
}

export async function closeParticipants(participants: readonly Participant[]): Promise<void> {
  await Promise.all(participants.map((p) => p.context.close()));
}

export async function getNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getNotes?.() ?? [])]);
}

/**
 * Change-delivery latencies. The 1-second budget is reported, not asserted:
 * the browsers, the server and the tests share one machine.
 */
export class LatencyLog {
  readonly samples: { label: string; ms: number }[] = [];

  record(label: string, ms: number): void {
    this.samples.push({ label, ms });
  }

  summary(): string {
    if (this.samples.length === 0) return 'no latency samples';
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    const over = sorted.filter((ms) => ms > LIVE_UPDATE_LATENCY_BUDGET_MS).length;
    return (
      `${sorted.length} deliveries: p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${sorted[sorted.length - 1]} ms; ` +
      `${over} over the ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms budget (reported, not asserted)`
    );
  }

  async report(testInfo: TestInfo): Promise<void> {
    const summary = this.summary();
    console.log(`[latency] ${testInfo.title}: ${summary}`);
    for (const s of this.samples) console.log(`[latency]   ${s.label}: ${s.ms} ms`);
    await testInfo.attach('latency', { body: `${summary}\n${JSON.stringify(this.samples, null, 2)}`, contentType: 'text/plain' });
  }
}

/**
 * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) until `probe` returns `expected` on every
 * receiver page, and records how long each took since `sentAt`.
 */
export async function expectEventually<T>(
  log: LatencyLog,
  label: string,
  receivers: readonly Participant[],
  probe: (page: Page) => Promise<T>,
  expected: T,
  sentAt = Date.now(),
): Promise<void> {
  await Promise.all(
    receivers.map(async (r) => {
      await expect
        .poll(() => probe(r.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [15], message: `${label} → ${r.name}` })
        .toEqual(expected);
      log.record(`${label} → ${r.name}`, Date.now() - sentAt);
    }),
  );
}

/** Board content as every participant should see it (ids, text, colour, position). */
export function boardState(notes: readonly StickySnapshot[]) {
  return [...notes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ id, text, color, x, y }) => ({ id, text, color, x, y }));
}

export async function webSocketAttempts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __wsAttempts?: number }).__wsAttempts ?? 0);
}
