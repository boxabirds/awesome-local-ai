import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { newBoardId } from "../../../src/shared/board-id";
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from "../../../src/shared/config";
import type { ConnectionState } from "../../../src/client/sync/connection-state";

/**
 * Story 3 e2e helpers: several isolated participants on one board.
 *
 * Each participant gets its own browser context — separate storage, separate
 * sockets, no shared cache — because two tabs of the *same* context would share
 * too much to prove that the server relays anything. Every participant opens
 * the same `/b/<boardId>`, which is how a real workshop shares a board: a link.
 *
 * Timing policy (see design.md): functional outcomes are asserted with
 * `expectEventually`, and the time each change took is **recorded and printed**
 * against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted — the model, the
 * browsers and the server all share this machine.
 */

export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors and uncaught exceptions this participant saw. */
  readonly problems: string[];
}

export interface Session {
  readonly boardId: string;
  readonly participants: Participant[];
  close(): Promise<void>;
}

/** One participant: isolated context, board open, problem collector installed. */
export async function openParticipant(browser: Browser, name: string, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await instrumentSockets(page);
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId("board-viewport")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => typeof window.__vidi6?.getCamera === "function"))
    .toBe(true);

  return { name, context, page, problems };
}

/** The connection state the badge is mapping from (`window.__vidi6`, test builds). */
export async function connectionStateOf(page: Page): Promise<ConnectionState | null> {
  return page.evaluate(() => window.__vidi6?.connectionState ?? null);
}

/** Waits until this participant is in sync with the room. */
export async function waitUntilConnected(participant: Participant, timeoutMs = 20_000): Promise<void> {
  await expect
    .poll(() => connectionStateOf(participant.page), { timeout: timeoutMs, intervals: [50, 100, 250] })
    .toBe("connected");
}

/** `names.length` isolated participants on one fresh board, all in sync. */
export async function openSession(browser: Browser, names: string[]): Promise<Session> {
  const boardId = newBoardId();
  const participants: Participant[] = [];
  try {
    for (const name of names) {
      participants.push(await openParticipant(browser, name, boardId));
    }
    for (const participant of participants) {
      await waitUntilConnected(participant);
    }
  } catch (error) {
    await closeAll(participants);
    throw error;
  }

  return {
    boardId,
    participants,
    close: () => closeAll(participants),
  };
}

async function closeAll(participants: Participant[]): Promise<void> {
  for (const participant of participants) {
    await participant.context.close().catch(() => undefined);
  }
}

/**
 * Waits for a functional outcome, and records how long it took.
 *
 * `probe` must return `true` when the change has arrived. The assertion is the
 * outcome; the duration is a measurement, reported by `reportLatencies`.
 */
export async function expectEventually(
  label: string,
  probe: () => Promise<boolean> | boolean,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<number> {
  const started = Date.now();
  await expect.poll(probe, { timeout: timeoutMs, intervals: [50, 100, 250] }).toBe(true);
  const tookMs = Date.now() - started;
  record(label, tookMs);
  return tookMs;
}

const samples: { label: string; ms: number }[] = [];

function record(label: string, ms: number): void {
  samples.push({ label, ms });
  const over = ms > LIVE_UPDATE_LATENCY_BUDGET_MS ? " OVER-BUDGET" : "";
  console.log(`[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)${over}`);
}

/** p50 / p95 / max of everything measured so far, against the budget. */
export function reportLatencies(): { p50: number; p95: number; max: number; count: number } {
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  const summary = { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0, count: sorted.length };
  console.log(
    `[latency report] n=${summary.count} p50=${summary.p50}ms p95=${summary.p95}ms max=${summary.max}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted)`,
  );
  return summary;
}

export function resetLatencies(): void {
  samples.length = 0;
}

/** The board as this participant's DOM shows it: geometry, text, colour, stacking. */
export interface BoardDomSnapshot {
  id: string;
  /** Screen box in CSS pixels: identical cameras make it comparable across pages. */
  box: { x: number; y: number; width: number; height: number };
  text: string;
  color: string;
  z: number;
  selected: boolean;
  editing: boolean;
}

export async function boardDomSnapshot(page: Page): Promise<BoardDomSnapshot[]> {
  return page.evaluate(() => {
    const out: BoardDomSnapshot[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']"))) {
      const box = node.getBoundingClientRect();
      const editor = node.querySelector("[data-testid='sticky-note-input']");
      const displayed = node.querySelector("[data-testid='sticky-note-text']");
      const textarea = editor as HTMLTextAreaElement | null;
      out.push({
        id: node.getAttribute("data-note-id") ?? "",
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        text: textarea ? textarea.value : (displayed?.textContent ?? ""),
        color: window.getComputedStyle(node).backgroundColor,
        z: Number(node.style.zIndex || "0"),
        selected: node.getAttribute("data-selected") === "true",
        editing: editor !== null,
      });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  });
}

/** Notes whose ids all exist on this page. */
export async function hasNoteIds(page: Page, ids: readonly string[]): Promise<boolean> {
  const present = new Set(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']")).map(
        (node) => node.getAttribute("data-note-id") ?? "",
      ),
    ),
  );
  return ids.every((id) => present.has(id));
}

export async function noteCount(page: Page): Promise<number> {
  return page.locator("[data-testid='sticky-note']").count();
}

/** Asserts no participant logged a console error or an uncaught exception. */
export function expectNoProblems(participants: readonly Participant[]): void {
  const found = participants.flatMap((participant) =>
    participant.problems.map((problem) => `${participant.name}: ${problem}`),
  );
  expect(found).toEqual([]);
}

/**
 * Counts the sockets this page opens, from the very first one.
 *
 * A reconnect is a new socket, so the count is a direct record of how often the
 * client had to reconnect — including "not once", which is what an idle
 * connection (TC-29) and a clean teardown (TC-30) are about.
 */
export async function instrumentSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counters = window as unknown as { __vidi6Sockets?: number };
    counters.__vidi6Sockets = 0;
    const Native = window.WebSocket;
    class CountedWebSocket extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        counters.__vidi6Sockets = (counters.__vidi6Sockets ?? 0) + 1;
      }
    }
    window.WebSocket = CountedWebSocket as unknown as typeof WebSocket;
  });
}

export async function socketCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __vidi6Sockets?: number }).__vidi6Sockets ?? 0);
}

/** Watches every state the badge renders, so a two-second window cannot be missed. */
export async function startBadgeRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __vidi6BadgeLog?: (string | null)[] };
    const log: (string | null)[] = [];
    target.__vidi6BadgeLog = log;
    const read = () => {
      const badge = document.querySelector<HTMLElement>('[role="status"]');
      const text = badge?.textContent ?? null;
      if (log[log.length - 1] !== text) log.push(text);
    };
    read();
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
}

export async function badgeLog(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => (window as unknown as { __vidi6BadgeLog?: (string | null)[] }).__vidi6BadgeLog ?? []);
}
