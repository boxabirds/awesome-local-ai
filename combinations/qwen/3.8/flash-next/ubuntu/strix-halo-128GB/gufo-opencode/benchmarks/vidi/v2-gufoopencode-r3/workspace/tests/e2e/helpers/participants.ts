import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS
} from '../../../src/shared/config';
import { getNotes, type NoteState } from './board';

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
}

// One isolated browser context per participant: no shared storage, no
// BroadcastChannel shortcut — everything goes through the BoardRoom.
export async function openParticipants(
  browser: Browser,
  names: string[],
  boardId = newBoardId()
): Promise<Participant[]> {
  const participants = await Promise.all(
    names.map(async (name) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(`/b/${boardId}`);
      await expect(page.getByTestId('board-viewport')).toBeVisible();
      return { name, context, page };
    })
  );
  await Promise.all(participants.map(waitForSynced));
  return participants;
}

export async function connectionState(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6?.connectionState() ?? 'missing');
}

export async function waitForSynced(participant: Participant): Promise<void> {
  await expect
    .poll(() => connectionState(participant.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('connected');
}

// Records every measured change so latency is reported (never asserted): the
// model, browsers and server share one machine, so wall-clock timing there is
// not a reliable pass/fail signal. Functional success is the assert.
export class LatencyRecorder {
  readonly samples: { label: string; ms: number }[] = [];

  async measure(label: string, action: () => Promise<void>, seen: () => Promise<boolean>): Promise<void> {
    const start = Date.now();
    await action();
    await expect.poll(seen, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
    const ms = Date.now() - start;
    this.samples.push({ label, ms });
    const flag = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? ' OVER-BUDGET (reported only)' : '';
    console.log(`[latency] ${label}: ${ms}ms vs budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms${flag}`);
  }

  report(title: string): void {
    const times = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    if (times.length === 0) return;
    const at = (q: number): number => times[Math.min(times.length - 1, Math.round(q * (times.length - 1)))];
    console.log(
      `[latency] ${title}: n=${times.length} p50=${at(0.5)}ms p95=${at(0.95)}ms ` +
        `max=${times[times.length - 1]}ms budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms (reported, not asserted)`
    );
  }
}

export function snapshotKey(notes: readonly NoteState[]): string {
  return JSON.stringify(
    [...notes]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((n) => [n.id, Math.round(n.x), Math.round(n.y), n.color, n.text, n.z])
  );
}

export async function snapshotsAgree(pages: Page[]): Promise<boolean> {
  const keys = await Promise.all(pages.map(async (p) => snapshotKey(await getNotes(p))));
  return keys.every((k) => k === keys[0]);
}

// The change for "note id created" is seen when id exists on every observer.
export function noteAppears(observers: Participant[], id: string): () => Promise<boolean> {
  return async () => {
    for (const o of observers) {
      const notes = await getNotes(o.page);
      if (!notes.some((n) => n.id === id)) return false;
    }
    return true;
  };
}

export function noteMatches(
  observer: Participant,
  id: string,
  check: (n: NoteState) => boolean
): () => Promise<boolean> {
  return async () => {
    const notes = await getNotes(observer.page);
    const note = notes.find((n) => n.id === id);
    return note !== undefined && check(note);
  };
}
