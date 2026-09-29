// Several people on one board: one isolated browser context per participant.
import { type Browser, type BrowserContext, type Page, type TestInfo, expect } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors, uncaught page errors and dialogs seen on this page. */
  problems: string[];
}

export interface Session {
  boardId: string;
  participants: Participant[];
  close(): Promise<void>;
}

/** Opens `names.length` isolated contexts on the same new board and waits until all are connected. */
export async function openParticipants(
  browser: Browser,
  testInfo: TestInfo,
  names: string[],
  boardId = newBoardId(),
): Promise<Session> {
  const { baseURL, viewport } = testInfo.project.use;
  const participants = await Promise.all(
    names.map(async (name) => {
      const context = await browser.newContext({ baseURL, viewport });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('dialog', (dialog) => {
        problems.push(`dialog: ${dialog.message()}`);
        void dialog.dismiss();
      });
      await page.goto(`/b/${boardId}`);
      await waitForConnected(page);
      return { name, context, page, problems };
    }),
  );
  return {
    boardId,
    participants,
    close: async () => {
      await Promise.all(participants.map((p) => p.context.close()));
    },
  };
}

export async function connectionState(page: Page) {
  return page.evaluate(() => window.__vidi6?.connectionState ?? null);
}

export async function waitForConnected(page: Page) {
  await expect
    .poll(() => connectionState(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

/** The connection badge (the zoom label is also a status, so match by class). */
export const connectionBadge = (page: Page) => page.locator('.connection-status[role="status"]');

interface Sample {
  label: string;
  ms: number;
}

/** Measured change-delivery times, reported against LIVE_UPDATE_LATENCY_BUDGET_MS (not asserted). */
export class LatencyLog {
  readonly samples: Sample[] = [];

  /**
   * Waits (up to E2E_EVENTUAL_TIMEOUT_MS) until `check` holds and records how long it took since
   * `since` (when the change appeared on the sender's screen).
   */
  async expectEventually(label: string, check: () => Promise<boolean>, since = Date.now()) {
    await expect
      .poll(check, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [10], message: label })
      .toBe(true);
    this.samples.push({ label, ms: Date.now() - since });
  }

  report(title: string): string {
    if (this.samples.length === 0) return `${title}: no latency samples`;
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
    const over = this.samples.filter((s) => s.ms > LIVE_UPDATE_LATENCY_BUDGET_MS);
    const lines = [
      `${title}: ${sorted.length} changes; p50 ${pct(50)} ms, p95 ${pct(95)} ms, max ${sorted[sorted.length - 1]} ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, reported not asserted; ${over.length} over budget)`,
      ...over.slice(0, 10).map((s) => `  over budget: ${s.label} ${s.ms} ms`),
    ];
    const text = lines.join('\n');
    console.log(text);
    return text;
  }
}
