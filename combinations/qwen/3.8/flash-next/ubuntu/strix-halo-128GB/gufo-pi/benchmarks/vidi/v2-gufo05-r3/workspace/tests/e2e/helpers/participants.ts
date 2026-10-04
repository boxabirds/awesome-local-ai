import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';

import type { ConnectionState } from '../../../src/client/sync/connectBoard';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';

/**
 * Live-collaboration e2e helpers (task 8).
 *
 * One participant = one browser *context*: isolated storage, cookies and
 * sockets, so two participants really are two people on two machines. Every
 * functional wait goes through {@link expectEventually}, which waits up to
 * E2E_EVENTUAL_TIMEOUT_MS and logs the measured latency against
 * LIVE_UPDATE_LATENCY_BUDGET_MS without failing on it — the model, the browsers
 * and the server all share one machine here.
 */

export const PARTICIPANT_VIEWPORT = { width: 1280, height: 800 };

export interface Participant {
  readonly name: string;
  readonly boardId: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors and uncaught exceptions, for "nothing broke" assertions. */
  readonly consoleErrors: string[];
  /**
   * Present when the participant was opened with `controllableLink`: the test
   * harness sits on the socket, can pull it (the only reliable way to lose a
   * connection in a browser that is already offline) and can see every frame.
   */
  readonly link?: HarnessLink;
}

interface HarnessLink {
  /** Every connection the harness has seen, oldest first. */
  readonly routes: WebSocketRoute[];
  /** Timestamps of page-to-server frames; {@link takeFrameTimes} drains it. */
  takeFrameTimes(): number[];
  /** Timestamps of connections that closed, whoever closed them. */
  closedAt(): number[];
}

export interface OpenOptions {
  /**
   * Intercept the board socket so {@link simulateOutage} can close it. Traffic
   * is passed straight through, so nothing else changes.
   */
  controllableLink?: boolean;
}

/** A board nobody has opened yet. */
export function freshBoardId(): string {
  return newBoardId();
}

/**
 * Create a board through the API and return its id.
 *
 * Story 5 removed implicit creation: opening `/b/:id` for an id that was never
 * created shows Board not found, so a test that wants a real board must make one
 * first — exactly what the New board button does. Needs a `request` fixture.
 */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  if (!response.ok()) {
    throw new Error(`createBoard failed with HTTP ${response.status()}`);
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function openParticipant(
  browser: Browser,
  name: string,
  boardId: string,
  options: OpenOptions = {},
): Promise<Participant> {
  const context = await browser.newContext({ viewport: PARTICIPANT_VIEWPORT });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const routes: WebSocketRoute[] = [];
  const frames: number[] = [];
  const closes: number[] = [];
  if (options.controllableLink) {
    await page.routeWebSocket('**/api/rooms/**', (route) => {
      routes.push(route);
      // Attaching a message handler takes over the bridge, so both directions
      // are forwarded by hand - the only thing added is a record of when the
      // page sent something (proof of keepalives) and when a socket closed
      // (proof that a closed tab stays closed).
      const server = route.connectToServer();
      route.onMessage((message) => {
        frames.push(Date.now());
        server.send(message);
      });
      server.onMessage((message) => route.send(message));
      route.onClose(() => closes.push(Date.now()));
    });
  }

  const participant: Participant = {
    name,
    boardId,
    context,
    page,
    consoleErrors,
    link: options.controllableLink
      ? {
          routes,
          takeFrameTimes: () => frames.splice(0, frames.length),
          closedAt: () => [...closes],
        }
      : undefined,
  };
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-board-surface]');
  await waitForConnected(participant);
  return participant;
}

/** Open every participant on the same board, all in sync before the test starts. */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  names: string[],
  options: OpenOptions = {},
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (const name of names) {
    participants.push(await openParticipant(browser, name, boardId, options));
  }
  return participants;
}

export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const participant of participants) await participant.context.close();
}

export async function connectionState(participant: Participant): Promise<ConnectionState | ''> {
  return participant.page.evaluate(
    () => (window as unknown as { __vidi6?: { connectionState?: ConnectionState } }).__vidi6
      ?.connectionState ?? '',
  );
}

export interface LoggedState {
  state: ConnectionState;
  at: number;
}

export async function connectionLog(participant: Participant): Promise<LoggedState[]> {
  return participant.page.evaluate(
    () =>
      (window as unknown as { __vidi6?: { connectionLog?: LoggedState[] } }).__vidi6
        ?.connectionLog ?? [],
  );
}

/** The connection badge. Scoped by attribute: the page has other `role=status` live regions. */
export function badge(participant: Participant) {
  return participant.page.locator('[data-connection-state]');
}

export async function badgeText(participant: Participant): Promise<string> {
  const locator = badge(participant);
  return (await locator.count()) === 0 ? '' : ((await locator.textContent()) ?? '');
}

/** In sync means: the badge is hidden and the mapped state says so. */
export async function waitForConnected(participant: Participant): Promise<void> {
  await expectEventually(
    `${participant.name}: connected`,
    () => connectionState(participant),
    (state) => state === 'connected' || state === 'confirmed',
  );
}

/**
 * Kill this participant's link: the network is refused and the live socket is
 * closed by the harness. A browser with its network switched off does not
 * deliver a close event for a socket it already has, so the harness closes it
 * from its side - the app then behaves exactly as it does when a network dies:
 * badge, backoff, resync. {@link comeBackOnline} restores connectivity.
 */
export async function simulateOutage(participant: Participant): Promise<void> {
  const link = participant.link;
  if (!link) throw new Error('participant was opened without a controllableLink');
  await participant.context.setOffline(true);
  const live = link.routes[link.routes.length - 1];
  if (!live) throw new Error('the participant never opened a board socket');
  await live.close({ code: 1006, reason: 'simulated outage' });
}

export async function comeBackOnline(participant: Participant): Promise<void> {
  await participant.context.setOffline(false);
}

/** Everything this participant's badge has shown, sampled while waiting. */
export async function sampleBadge(participant: Participant): Promise<string> {
  const text = await badgeText(participant);
  badgeSightings.get(participant.name)?.add(text);
  return text;
}

const badgeSightings = new Map<string, Set<string>>();

export function trackBadge(participant: Participant): void {
  badgeSightings.set(participant.name, new Set());
}

export function badgeSightingsFor(participant: Participant): string[] {
  return [...(badgeSightings.get(participant.name) ?? [])];
}

export async function boardOf(participant: Participant): Promise<StickySnapshot[]> {
  await participant.page.waitForFunction(
    () => typeof (window as unknown as { __vidi6?: { getBoard?: unknown } }).__vidi6?.getBoard === 'function',
  );
  return participant.page.evaluate(
    () => (window as unknown as { __vidi6: { getBoard: () => StickySnapshot[] } }).__vidi6.getBoard(),
  );
}

/** Board state as one stable string, so snapshots can be compared directly. */
export function boardKey(notes: readonly StickySnapshot[]): string {
  return JSON.stringify(
    [...notes]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((n) => [n.id, n.x, n.y, n.z, n.color, n.text]),
  );
}

/** Latency samples collected by {@link expectEventually}, for the nightly report. */
const latencySamples: { label: string; ms: number }[] = [];

export function latencySamplesSnapshot(): { label: string; ms: number }[] {
  return [...latencySamples];
}

export function resetLatencySamples(): void {
  latencySamples.length = 0;
}

export function reportLatency(label: string, ms: number): void {
  const over = ms > LIVE_UPDATE_LATENCY_BUDGET_MS;
  console.log(
    `[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)${
      over ? ' — over budget, reported not asserted' : ''
    }`,
  );
}

/** Print p50 / p95 / max for the collected samples against the budget. */
export function printLatencyReport(title: string): void {
  if (latencySamples.length === 0) {
    console.log(`[latency] ${title}: no samples`);
    return;
  }
  const sorted = latencySamples.map((s) => s.ms).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(
    `[latency] ${title}: n=${sorted.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${at(1)}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
  );
}

/**
 * Wait for a functional outcome, measure how long it took and log that against
 * the budget. Only the outcome decides pass or fail.
 */
export async function expectEventually<T>(
  label: string,
  probe: () => Promise<T>,
  satisfied: (value: T) => boolean,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<number> {
  const started = Date.now();
  await expect
    .poll(async () => satisfied(await probe()), { timeout: timeoutMs, intervals: [20, 50, 100] })
    .toBe(true);
  const elapsed = Date.now() - started;
  latencySamples.push({ label, ms: elapsed });
  reportLatency(label, elapsed);
  return elapsed;
}

/** Wait for every participant's board to look the same. */
export async function waitForBoardsEqual(
  participants: Participant[],
  label: string,
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  await expectEventually(
    label,
    () => Promise.all(participants.map((p) => boardOf(p))),
    (boards) => boards.every((b) => boardKey(b) === boardKey(boards[0])),
    timeoutMs,
  );
}

/**
 * A test that waits out CATCH_UP_TEST_OUTAGE_MS needs room for the outage, the
 * reconnect backoff (up to RECONNECT_MAX_BACKOFF_MS) and the catch-up itself.
 */
export const CATCH_UP_TEST_TIMEOUT_MS =
  15_000 + 30_000 + 10_000 + E2E_EVENTUAL_TIMEOUT_MS;
