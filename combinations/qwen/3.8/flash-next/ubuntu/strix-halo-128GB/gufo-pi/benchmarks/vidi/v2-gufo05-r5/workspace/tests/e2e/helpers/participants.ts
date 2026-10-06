/**
 * E2E participants: one browser context per person on a board.
 *
 * A context is the smallest thing that really is "another person": its own WebSocket, its own
 * local Y.Doc, no shared storage or broadcast channel - and `setOffline` acts on exactly one of
 * them. Tests get a named participant per context, plus the handful of reads a live-collaboration
 * assertion needs (document state, connection badge, rendered DOM), and a latency log that the
 * story asks to be reported rather than asserted.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';

/** Names for the people in the story's scenarios, in the order the design uses them. */
export const PARTICIPANT_NAMES = ['Alex', 'Sam', 'Rio', 'Kim', 'Jordan'] as const;

export interface Participant {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught exceptions this participant saw (benign noise filtered out). */
  readonly consoleErrors: string[];
}

/** A board address is 22 characters; the page under test is `/b/<address>`. */
export function boardUrl(boardId: string): string {
  return `/b/${boardId}`;
}

/** Network noise that is a fact about this sandbox, not about the board. */
const BENIGN_CONSOLE = [
  /favicon/i,
  /Failed to load resource/i, // a WebSocket that could not connect while "offline"
  /net::ERR_(INTERNET_DISCONNECTED|FAILED|CONNECTION)/i,
];

/** Opens `count` isolated contexts on one board and waits for each board to be usable. */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: 2,
): Promise<[Participant, Participant]>;
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]>;
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  const participants = await Promise.all(
    Array.from({ length: count }, async (_unused, index) => {
      // the same laptop viewport the suite is configured with, per person
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const participant: Participant = {
        name: PARTICIPANT_NAMES[index] ?? `Person ${index + 1}`,
        context,
        page,
        consoleErrors: [],
      };
      page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' && !BENIGN_CONSOLE.some((pattern) => pattern.test(text))) {
          participant.consoleErrors.push(text);
        }
      });
      page.on('pageerror', (error) => {
        participant.consoleErrors.push(String(error));
      });
      return { participant, page };
    }),
  );

  // Navigate one at a time: a context that reaches the board while another is still loading is
  // exactly the late-joiner case, but the initial sync is what every test starts from.
  const opened: Participant[] = [];
  for (const { participant } of participants) {
    await participant.page.goto(boardUrl(boardId));
    await waitForBoard(participant);
    opened.push(participant);
  }
  return opened;
}

/** Waits until the app is up, the test hook is there and the board is live. */
export async function waitForBoard(participant: Participant): Promise<void> {
  await participant.page.waitForFunction(
    () => window.__vidi6 !== undefined && window.__vidi6.connectionState() !== 'connecting',
    undefined,
    { timeout: E2E_EVENTUAL_TIMEOUT_MS },
  );
  // the state above only says "not connecting any more"; give the first sync a moment to land
  await expect
    .poll(() => connectionState(participant), {
      message: `${participant.name} never got a live connection`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('connected');
}

/**
 * The person at `index`, or a clear failure - the tests run with strict index checks, and
 * "participant is undefined" says nothing about a board that lost a participant.
 */
export function personAt(participants: readonly Participant[], index: number): Participant {
  const found = participants[index];
  if (!found) throw new Error(`there is no participant number ${index + 1} on this board`);
  return found;
}

export type BoardConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export function connectionState(participant: Participant): Promise<BoardConnectionState> {
  return participant.page.evaluate(() => window.__vidi6?.connectionState() ?? 'connecting');
}

/** The badge's `data-state`, or null when no badge is drawn (the normal state). */
export function badgeState(participant: Participant): Promise<string | null> {
  return participant.page.evaluate(
    () => document.querySelector('[data-testid="connection-status"]')?.getAttribute('data-state') ?? null,
  );
}

export function badgeText(participant: Participant): Promise<string | null> {
  return participant.page.evaluate(
    () => document.querySelector('[data-testid="connection-status"]')?.textContent ?? null,
  );
}

export function notesOf(participant: Participant): Promise<readonly StickySnapshot[]> {
  return participant.page.evaluate(() => {
    if (!window.__vidi6) throw new Error('the client is not a test build (`vite build --mode test`)');
    return window.__vidi6.getNotes();
  });
}

/** The document's state vector: equal between participants means nobody is missing changes. */
export function stateVectorOf(participant: Participant): Promise<string> {
  return participant.page.evaluate(() => JSON.stringify(window.__vidi6?.stateVector() ?? []));
}

/** What a participant's board actually looks like, as one comparable string. */
export function domSnapshot(participant: Participant): Promise<string> {
  return participant.page.evaluate(
    () =>
      JSON.stringify(
        Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map((el) => ({
          id: el.getAttribute('data-note-id'),
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          background: getComputedStyle(el).backgroundColor,
          text: el.textContent ?? '',
        })),
      ),
  );
}

/** A short, human-readable form of a note list, for failure messages. */
export function describeNotes(notes: readonly StickySnapshot[]): string {
  return notes
    .map((note) => `${note.text || '(empty)'}@${Math.round(note.x)},${Math.round(note.y)}`)
    .join(' | ');
}

/**
 * Polls until every participant holds the same document and renders the same board.
 *
 * Two levels on purpose: the state vector says the CRDT merged everything, the DOM snapshot says
 * what people actually see agrees - a note that merged in the document but never re-rendered is
 * still a bug a user would report.
 */
export async function expectConverged(
  participants: readonly Participant[],
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const [first, ...rest] = participants;
  if (!first) return;
  await expect
    .poll(
      async () => {
        const vector = await stateVectorOf(first);
        const dom = await domSnapshot(first);
        for (const other of rest) {
          if ((await stateVectorOf(other)) !== vector) return 'state vectors differ';
          if ((await domSnapshot(other)) !== dom) return 'rendered boards differ';
        }
        return 'same';
      },
      { message: 'the participants never converged', timeout: timeoutMs, intervals: [100] },
    )
    .toBe('same');
}

/** A promise that resolves when `check()` passes, and that never rejects: for racing edits. */
export function eventually(check: () => Promise<boolean>, timeoutMs = E2E_EVENTUAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return async (): Promise<boolean> => {
    for (;;) {
      if (await check()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
}

/** One measured propagation: what changed, and how long the others took to see it. */
export interface LatencySample {
  label: string;
  ms: number;
}

/**
 * Records how long changes take to reach the rest of the board.
 *
 * The story says latency is *reported*, not asserted, because a shared CI runner decides it - so
 * `measure` fails only when a change never arrives, and every number is logged against
 * `LIVE_UPDATE_LATENCY_BUDGET_MS` at the end of the test.
 */
export class LatencyLog {
  readonly #samples: LatencySample[] = [];

  /**
   * Runs `change` and then times how long `waitFor` takes to hold. `change` may return the instant
   * the edit was made locally (the moment the keystroke or mouse release happened), so the number
   * is the trip through the room and not the mouse movement in front of it.
   */
  async measure(
    label: string,
    change: () => Promise<number | void>,
    waitFor: () => Promise<boolean>,
    timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
  ): Promise<void> {
    const returned = await change();
    const started = typeof returned === 'number' ? returned : Date.now();
    await expect
      .poll(waitFor, {
        message: `"${label}" never reached the other participants`,
        timeout: timeoutMs,
        intervals: [25],
      })
      .toBe(true);
    this.#samples.push({ label, ms: Date.now() - started });
  }

  get samples(): readonly LatencySample[] {
    return this.#samples;
  }

  /** Logs p50/p95/max (and the ones over budget) - the report the nightly run is after. */
  report(title = 'live update latency'): void {
    if (this.#samples.length === 0) return;
    const sorted = this.#samples.map((sample) => sample.ms).sort((a, b) => a - b);
    const at = (quantile: number) =>
      sorted[Math.min(sorted.length - 1, Math.round(quantile * (sorted.length - 1)))];
    const over = this.#samples.filter((sample) => sample.ms > LIVE_UPDATE_LATENCY_BUDGET_MS);
    console.log(
      `${title}: ${sorted.length} changes, p50=${at(0.5)}ms p95=${at(0.95)}ms max=${at(1)}ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ${over.length} over: ` +
        `${over.map((sample) => `${sample.label}=${sample.ms}ms`).join(', ') || 'none'})`,
    );
  }
}

/** Closes every context, keeping the failure output readable if a test throws. */
export async function closeParticipants(participants: readonly Participant[]): Promise<void> {
  await Promise.all(participants.map((participant) => participant.context.close()));
}
