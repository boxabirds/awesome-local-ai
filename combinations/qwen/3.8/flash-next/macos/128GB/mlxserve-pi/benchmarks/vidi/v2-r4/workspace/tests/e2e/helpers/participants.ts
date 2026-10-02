import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../../src/shared/config';
import { newBoardId } from '../../../src/shared/board-id';
import type { ConnectionState } from '../../../src/client/sync/connectBoard';
import type { Vidi6TestApi } from '../../../src/client/canvas/testHooks';
import { readNotes, type NoteState } from './notes';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './board';

/**
 * One person on the board: a browser of their own, with nothing shared with
 * anybody else, which is what makes these tests about the board rather than
 * about one browser's memory.
 */
export interface Participant {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Console errors and uncaught exceptions, in order. */
  readonly consoleErrors: string[];
  /** Every socket this browser has opened, in order. One per connection attempt. */
  readonly sockets: string[];
  /** How many of them have closed. */
  socketsClosed: number;
}

/** What one change took to reach another browser. */
export interface LatencySample {
  readonly change: string;
  readonly ms: number;
}

/** The spread of the measured latencies. */
export interface LatencySummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/**
 * How long a change took to show up, kept so a run can say so out loud. The
 * budget is reported against, never asserted: a slow machine is not a broken
 * board (PRD: "latency is reported").
 */
export class LatencyLog {
  readonly samples: LatencySample[] = [];

  record(change: string, ms: number): void {
    this.samples.push({ change, ms });
  }

  summary(): LatencySummary {
    const times = this.samples.map((sample) => sample.ms).sort((a, b) => a - b);
    const at = (fraction: number) =>
      times.length === 0 ? 0 : times[Math.min(times.length - 1, Math.floor(fraction * times.length))];
    return { count: times.length, p50: at(0.5), p95: at(0.95), max: times.at(-1) ?? 0 };
  }

  /** Says the numbers out loud, and whether they fit inside the budget. */
  report(label: string): LatencySummary {
    const summary = this.summary();
    const over = this.samples.filter((sample) => sample.ms > LIVE_UPDATE_LATENCY_BUDGET_MS);
    console.log(
      `[latency] ${label}: ${summary.count} changes, p50 ${summary.p50}ms, p95 ${summary.p95}ms, ` +
        `max ${summary.max}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ` +
        `${over.length} over — reported, not asserted)`,
    );
    return summary;
  }
}

/** The part of a note that the board is responsible for sharing. */
export interface NoteStateOnBoard {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly text: string;
}

/** Two browsers' boards are the same when these agree. */
export const onBoard = (note: NoteState): NoteStateOnBoard => ({
  id: note.id,
  x: note.x,
  y: note.y,
  z: note.z,
  color: note.color,
  text: note.text,
});

export const boardOf = (notes: readonly NoteState[]): NoteStateOnBoard[] => notes.map(onBoard);

export const connectionStateOf = (page: Page): Promise<ConnectionState | undefined> =>
  page.evaluate(() => (window.__vidi6 as Vidi6TestApi | undefined)?.connectionState);

/** The little line about the connection; there is one per connection. */
export const connectionStatus = (page: Page) => page.getByTestId('connection-status');

/**
 * Wait for something that a change has to do: to show up in another browser, at
 * the board's own pace rather than on a timer. Times out at
 * E2E_EVENTUAL_TIMEOUT_MS, and records how long it took against the latency
 * budget, which is reported and not asserted.
 *
 * @param what what is being waited for, for the log line
 * @param assertion throws while the change has not appeared yet
 * @param log collects the measurement; the run's latency report comes from here
 * @param timeoutMs how long to wait; a change that has to cross a dead network is
 *   not as fast as a change that is merely being relayed
 */
export async function expectEventually(
  what: string,
  assertion: () => Promise<void>,
  log: LatencyLog = new LatencyLog(),
  timeoutMs = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<number> {
  const started = Date.now();
  let lastError: unknown;
  try {
    await expect
      .poll(
        async () => {
          try {
            await assertion();
            return true;
          } catch (error) {
            lastError = error;
            return false;
          }
        },
        { timeout: timeoutMs, intervals: [25, 50, 100, 250] },
      )
      .toBe(true);
  } catch {
    throw new Error(`${what} did not happen within ${timeoutMs}ms: ${String(lastError)}`);
  }
  const ms = Date.now() - started;
  log.record(what, ms);
  return ms;
}

export class BoardSession {
  /** Still on the board; somebody who closes their browser is taken out. */
  participants: Participant[];
  readonly log = new LatencyLog();
  #closed = false;

  private constructor(
    readonly boardId: string,
    participants: Participant[],
  ) {
    this.participants = participants;
  }

  /**
   * Open `names`, one browser each, all on the same empty board, and wait until
   * every one of them is connected and showing the same board.
   */
  static async open(browser: Browser, names: readonly string[]): Promise<BoardSession> {
    const boardId = newBoardId();
    const participants: Participant[] = [];
    for (const name of names) {
      const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
      const page = await context.newPage();
      const participant: Participant = {
        name,
        context,
        page,
        consoleErrors: [],
        sockets: [],
        socketsClosed: 0,
      };
      page.on('console', (message) => {
        if (message.type() === 'error') participant.consoleErrors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => participant.consoleErrors.push(`uncaught: ${String(error)}`));
      page.on('websocket', (socket) => {
        participant.sockets.push(socket.url());
        socket.on('close', () => {
          participant.socketsClosed += 1;
        });
      });
      await page.goto(`/b/${boardId}`);
      participants.push(participant);
    }

    const session = new BoardSession(boardId, participants);
    // Everyone is connected before anybody changes anything, so a test's first
    // change cannot race the connection of the person meant to see it. 'confirmed'
    // counts too: it is what 'connected' is called in its first two seconds.
    for (const participant of participants) {
      await expect
        .poll(
          async () => {
            const state = await connectionStateOf(participant.page);
            return state === 'connected' || state === 'confirmed';
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBe(true);
    }
    await session.everybodySeesTheSameBoard('everyone starts on the same empty board');
    return session;
  }

  named(name: string): Participant {
    const participant = this.participants.find((candidate) => candidate.name === name);
    if (participant === undefined) throw new Error(`no participant named ${name} on this board`);
    return participant;
  }

  /** Everybody else than the one who is making the change. */
  others(name: string): Participant[] {
    return this.participants.filter((participant) => participant.name !== name);
  }

  async notesOf(name: string): Promise<NoteState[]> {
    return readNotes(this.named(name).page);
  }

  /** The board as one comparable value, so two browsers can be compared. */
  async board(name: string): Promise<NoteStateOnBoard[]> {
    return boardOf(await this.notesOf(name));
  }

  /** Wait for `name`'s browser to show `want` notes. */
  async expectNoteCount(name: string, want: number): Promise<void> {
    const participant = this.named(name);
    await expect
      .poll(async () => (await readNotes(participant.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(want);
  }

  /** Wait until every browser shows the very same board. */
  async everybodySeesTheSameBoard(
    what: string,
    log?: LatencyLog,
    timeoutMs?: number,
  ): Promise<NoteStateOnBoard[]> {
    const first = this.participants[0];
    let seen: NoteStateOnBoard[] = [];
    await expectEventually(
      what,
      async () => {
        seen = await this.board(first.name);
        for (const participant of this.participants.slice(1)) {
          expect(await this.board(participant.name)).toEqual(seen);
        }
      },
      log ?? this.log,
      timeoutMs,
    );
    return seen;
  }

  /**
   * Wait until a change made by `by` shows on everybody else's screen, and say
   * how long that took. `describe` is the change, for the log.
   *
   * `timeoutMs` is for a change that has to cross a network that was broken and
   * has only just come back.
   */
  async changeReachesEverybody(
    by: string,
    describe: string,
    matches: (notes: NoteStateOnBoard[]) => boolean,
    timeoutMs?: number,
  ): Promise<void> {
    for (const participant of this.others(by)) {
      await expectEventually(
        `${describe} on ${participant.name}'s screen`,
        async () => {
          expect(matches(await this.board(participant.name))).toBe(true);
        },
        this.log,
        timeoutMs,
      );
    }
  }

  /**
   * The board as it is painted on this person's screen, in paint order: where
   * each note is, on top of which, in what colour, saying what. Which note this
   * person has selected, is dragging, or has open for typing is deliberately not
   * in it — that is nobody else's business (TC-28).
   */
  async paintedBoard(name: string): Promise<string> {
    return this.named(name).page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="sticky-note"]'))
        .map((element) => {
          const note = element as HTMLElement;
          const typed = note.querySelector('textarea');
          const shown = typed ?? note.querySelector('[data-sticky-text-box]');
          const text = typed !== null ? typed.value : (shown?.textContent ?? '');
          return `${note.dataset.noteId} @${note.dataset.x},${note.dataset.y} z${note.dataset.z} ${note.dataset.color} "${text}"`;
        })
        .join('\n'),
    );
  }

  /** Wait until every screen paints the same board. */
  async expectSamePaintedBoard(what: string, timeoutMs?: number): Promise<string> {
    const first = this.participants[0];
    await expectEventually(
      what,
      async () => {
        const painted = await this.paintedBoard(first.name);
        for (const participant of this.participants.slice(1)) {
          expect(await this.paintedBoard(participant.name)).toBe(painted);
        }
      },
      this.log,
      timeoutMs,
    );
    return this.paintedBoard(first.name);
  }

  /**
   * One person's browser closes. The others have to let go of it rather than try
   * to bring it back (TC-29).
   */
  async leave(name: string): Promise<void> {
    const participant = this.named(name);
    this.participants = this.participants.filter((other) => other !== participant);
    await participant.context.close();
  }

  /** Cut one browser off from the network, or bring it back. */
  async setOffline(name: string, offline: boolean): Promise<void> {
    await this.named(name).context.setOffline(offline);
  }

  /** How this browser's board says the connection is, straight from the board. */
  async connectionState(name: string): Promise<ConnectionState | undefined> {
    return connectionStateOf(this.named(name).page);
  }

  /** How many connections this browser has had to make. One is the most there should be. */
  async socketsOpened(name: string): Promise<number> {
    return this.named(name).sockets.length;
  }

  /** How many of them have closed. */
  async socketsClosed(name: string): Promise<number> {
    return this.named(name).socketsClosed;
  }

  /** What this browser's console complained about. */
  async consoleErrors(name: string): Promise<string[]> {
    return [...this.named(name).consoleErrors];
  }

  /**
   * Do nothing for `ms`, saying so every so often, so a run that spends three
   * quarters of a minute being quiet can be seen to be quiet and not stuck.
   */
  async waitIdle(ms: number, every = 15_000): Promise<void> {
    const page = this.participants[0]?.page;
    if (page === undefined) return;
    let done = 0;
    while (done < ms) {
      const step = Math.min(every, ms - done);
      await page.waitForTimeout(step);
      done += step;
      console.log(`[idle] ${done}ms of ${ms}ms; ${await this.whyStillConnected()}`);
    }
  }

  private async whyStillConnected(): Promise<string> {
    const states = await Promise.all(
      this.participants.map(async (participant) => `${participant.name}=${await this.connectionState(participant.name) ?? 'none'}`),
    );
    return states.join(' ');
  }

  /** The connection line as the person sees it: its text, or null for hidden. */
  async statusText(name: string): Promise<string | null> {
    const badge = connectionStatus(this.named(name).page);
    return (await badge.isVisible()) ? ((await badge.textContent()) ?? '') : null;
  }

  async close(): Promise<{ socketsOpened: number; consoleErrors: string[] }> {
    const opened = this.participants.reduce((total, p) => total + p.sockets.length, 0);
    const errors = this.participants.flatMap((participant) => participant.consoleErrors);
    if (this.#closed) return { socketsOpened: opened, consoleErrors: errors };
    this.#closed = true;
    for (const participant of this.participants) {
      // Closing the browser runs the component's destroy(), which is the only way
      // to test that closing does not leave a reconnection behind.
      await participant.context.close();
    }
    return { socketsOpened: opened, consoleErrors: errors };
  }
}
