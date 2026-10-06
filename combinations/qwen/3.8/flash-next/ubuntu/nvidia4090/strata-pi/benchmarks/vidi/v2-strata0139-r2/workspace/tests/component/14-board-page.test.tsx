/**
 * Board page component tests (`share.pages`) — TC-19, TC-20, TC-21.
 *
 * The existence check is injected, so the three answers the page can get are all
 * decided here: exists, not_found, and "could not ask". What each answer *must
 * not* produce is asserted alongside it — no board, no Share button, no socket,
 * no board-creation request — because `share.not_found` is really a promise that
 * an unknown link never touches the board.
 *
 * `WebSocket` is replaced by a counting fake: a board page that renders a board
 * opens a socket, and a board page that says "not found" must not.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { newBoardId } from "../../src/shared/board-id";
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from "../../src/shared/config";
import { BoardPage } from "../../src/client/pages/BoardPage";
import {
  boardCheckRetryDelayMs,
  initialBoardPageState,
  nextBoardPageState,
  type BoardPageState,
} from "../../src/client/pages/state";
import type { BoardCheckOutcome } from "../../src/client/api";

const VALID_ID = "aB3-_x9A8b7C6d5E4f3G2h";

/** Counts socket constructions, and never talks to a network. */
class FakeWebSocket {
  static sockets: FakeWebSocket[] = [];
  static constructed(): number {
    return FakeWebSocket.sockets.length;
  }

  readonly url: string;
  readyState = 0;
  binaryType = "arraybuffer";
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.sockets.push(this);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

type Check = (boardId: string, options: { signal: AbortSignal }) => Promise<BoardCheckOutcome>;

function answering(outcome: BoardCheckOutcome): Check {
  return async () => outcome;
}

function statusAttribute(): string | null {
  return screen.getByTestId("board-page").getAttribute("data-board-status");
}

beforeEach(() => {
  FakeWebSocket.sockets = [];
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a board that exists (`share.pages`)", () => {
  it("renders the board screen, including the Share button, and connects", async () => {
    const check = vi.fn<Check>(async (boardId) => (boardId === VALID_ID ? "exists" : "not_found"));
    render(<BoardPage boardId={VALID_ID} check={check} />);

    expect(statusAttribute()).toBe("checking");
    expect(screen.getByTestId("board-page").textContent).toContain("Opening board\u2026");
    expect(screen.queryByTestId("board-viewport")).toBeNull();

    await screen.findByTestId("share-button");

    expect(screen.getByTestId("board-viewport")).toBeTruthy();
    expect(screen.getByTestId("share-button").textContent).toBe("Share");
    // The board page connects to *this* board.
    expect(FakeWebSocket.constructed()).toBeGreaterThan(0);
    expect(FakeWebSocket.sockets[0]!.url).toContain(`/api/rooms/${VALID_ID}`);
    expect(check).toHaveBeenCalledWith(VALID_ID, { signal: expect.any(AbortSignal) });
  });

  it("asks exactly once for a board that exists", async () => {
    const check = vi.fn<Check>(answering("exists"));
    render(<BoardPage boardId={VALID_ID} check={check} />);
    await screen.findByTestId("share-button");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("a board that does not exist (TC-20)", () => {
  it("shows Board not found, with the address it was asked about (TC-20)", async () => {
    const boardId = newBoardId();
    render(<BoardPage boardId={boardId} check={answering("not_found")} />);

    const page = await screen.findByTestId("not-found-page");
    expect(page).toBeTruthy();
    expect(screen.getByTestId("board-address").textContent).toBe(`/b/${boardId}`);
    expect(screen.getByTestId("not-found-page").textContent).toContain("Board not found");
  });

  it("renders no board, no Share button, and opens no socket (TC-20 negative)", async () => {
    render(<BoardPage boardId={newBoardId()} check={answering("not_found")} />);

    await screen.findByTestId("not-found-page");

    expect(screen.queryByTestId("board-viewport")).toBeNull();
    expect(screen.queryByTestId("share-button")).toBeNull();
    expect(screen.queryByTestId("share-panel")).toBeNull();
    expect(screen.queryByTestId("sticky-note")).toBeNull();
    expect(FakeWebSocket.constructed()).toBe(0);
  });

  it("does not create a board while looking for one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<BoardPage boardId={newBoardId()} check={answering("not_found")} />);
    await screen.findByTestId("not-found-page");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers New board and a way home", async () => {
    const navigate = vi.fn();
    const create = vi.fn(async () => ({ ok: true as const, id: newBoardId() }));
    render(
      <BoardPage
        boardId={newBoardId()}
        check={answering("not_found")}
        navigate={navigate}
        create={create}
      />,
    );

    const home = await screen.findByTestId("new-board-button");
    fireEvent.click(home);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate.mock.calls[0]![0]).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);

    expect(screen.getByTestId("home-link").getAttribute("href")).toBe("/");
  });
});

describe("a server that cannot be reached (TC-21)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Lets the microtasks React and the injected check leave behind settle without
   * moving the clock: the phase becomes what it will be, and no retry timer fires.
   */
  async function settle() {
    for (let round = 0; round < 6; round += 1) await vi.advanceTimersByTimeAsync(0);
  }

  it("says it could not reach vidi6, and asks again with 1s/2s/4s then the cap", async () => {
    const attempts: number[] = [];
    const check: Check = async () => {
      attempts.push(Date.now());
      throw new Error("connection refused");
    };

    render(<BoardPage boardId={VALID_ID} check={check} />);
    await settle();

    expect(statusAttribute()).toBe("unreachable");
    expect(screen.getByTestId("board-page").textContent).toContain("Couldn\u2019t reach vidi6. Retrying\u2026");
    // Not "not found": an outage must not look like a board that is gone.
    expect(screen.queryByTestId("not-found-page")).toBeNull();
    expect(statusAttribute()).not.toBe("not_found");
    expect(screen.queryByTestId("board-viewport")).toBeNull();
    expect(FakeWebSocket.constructed()).toBe(0);

    // Each retry is measured by asking "had it asked yet, just before the delay
    // elapses, and then just after?" — which is what "retry after 1 s, then 2 s"
    // means, and what a timer that fired too early or too late would break.
    const schedule = [1_000, 2_000, 4_000, 8_000, RECONNECT_MAX_BACKOFF_MS];
    const observed: number[] = [];
    for (const delay of schedule) {
      const before = attempts.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(attempts.length, `no re-check before ${delay} ms have passed`).toBe(before);

      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(attempts.length, `re-check at ${delay} ms`).toBe(before + 1);
      observed.push(attempts[attempts.length - 1]! - attempts[before - 1]!);
    }

    console.log(
      `TC-21 board-check retry delays (ms): ${observed.join(", ")} (cap ${RECONNECT_MAX_BACKOFF_MS})`,
    );
    expect(observed).toEqual([1_000, 2_000, 4_000, 8_000, RECONNECT_MAX_BACKOFF_MS]);
  });

  it("a check that answers 'unreachable' is an outage, not a missing board", async () => {
    const check: Check = async () => "unreachable";
    render(<BoardPage boardId={VALID_ID} check={check} />);
    await settle();

    expect(statusAttribute()).toBe("unreachable");
    expect(screen.queryByTestId("not-found-page")).toBeNull();
    expect(screen.queryByTestId("board-viewport")).toBeNull();
  });

  it("recovers: the first answer that arrives ends the retrying", async () => {
    let attempt = 0;
    const check: Check = async () => {
      attempt += 1;
      return attempt === 1 ? "unreachable" : "exists";
    };

    render(<BoardPage boardId={VALID_ID} check={check} />);
    await settle();
    expect(statusAttribute()).toBe("unreachable");

    await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    await settle();

    expect(screen.queryByTestId("board-page")).toBeNull(); // the status page is gone
    expect(screen.getByTestId("share-button")).toBeTruthy();
    expect(screen.getByTestId("board-viewport")).toBeTruthy();
    expect(FakeWebSocket.constructed()).toBeGreaterThan(0);
    expect(attempt).toBe(2);
  });

  it("TC-21 boundary: unreachable twice, then exists — 3 checks, at 1 s then 2 s", async () => {
    const attempts: number[] = [];
    let attempt = 0;
    const check: Check = async () => {
      attempt += 1;
      attempts.push(Date.now());
      return attempt <= 2 ? "unreachable" : "exists";
    };

    render(<BoardPage boardId={VALID_ID} check={check} />);
    await settle();
    expect(statusAttribute()).toBe("unreachable");
    expect(attempts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(attempts).toHaveLength(2);
    expect(statusAttribute()).toBe("unreachable");

    // The second delay has doubled.
    await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS - 1);
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(attempts).toHaveLength(3); // exactly three asks, no more
    expect(screen.queryByTestId("board-page")).toBeNull();
    expect(screen.getByTestId("share-button")).toBeTruthy();
    expect(screen.getByTestId("board-viewport")).toBeTruthy();
  });

  it("stops retrying when the page goes away", async () => {
    let calls = 0;
    const check: Check = async () => {
      calls += 1;
      throw new Error("connection refused");
    };

    const view = render(<BoardPage boardId={VALID_ID} check={check} />);
    await settle();
    expect(calls).toBe(1);

    view.unmount();
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_BACKOFF_MS * 4);
    expect(calls).toBe(1);
  });
});

describe("the board page state machine (`share.pages`)", () => {
  const checking: BoardPageState = initialBoardPageState(VALID_ID);

  it("starts by checking", () => {
    expect(checking.phase).toBe("checking");
    expect(checking.failedChecks).toBe(0);
  });

  it("checking -> board on exists, and -> not_found on not_found", () => {
    expect(nextBoardPageState(checking, { type: "checked", outcome: "exists" }).phase).toBe("board");
    expect(nextBoardPageState(checking, { type: "checked", outcome: "not_found" }).phase).toBe("not_found");
  });

  it("checking -> unreachable on a check that could not be made", () => {
    const next = nextBoardPageState(checking, { type: "check-failed" });
    expect(next.phase).toBe("unreachable");
    expect(next.failedChecks).toBe(1);
    expect(next.retryDelayMs).toBe(BOARD_CHECK_RETRY_BASE_MS);
  });

  it("unreachable -> checking only on recheck, and never from board or not_found", () => {
    const unreachable = nextBoardPageState(checking, { type: "check-failed" });
    expect(nextBoardPageState(unreachable, { type: "recheck" }).phase).toBe("checking");

    const board = nextBoardPageState(checking, { type: "checked", outcome: "exists" });
    expect(nextBoardPageState(board, { type: "recheck" })).toEqual(board);

    const missing = nextBoardPageState(checking, { type: "checked", outcome: "not_found" });
    expect(nextBoardPageState(missing, { type: "recheck" })).toEqual(missing);
  });

  it("an outage backs off over the whole retry, and a check that answers clears it", () => {
    let state = checking;
    const delays: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      state = nextBoardPageState(state, { type: "check-failed" });
      delays.push(state.retryDelayMs);
      state = nextBoardPageState(state, { type: "recheck" });
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);

    // Answered: the count is cleared, so the next outage starts at 1 s again.
    state = nextBoardPageState(state, { type: "checked", outcome: "exists" });
    expect(state.failedChecks).toBe(0);
    expect(boardCheckRetryDelayMs(state.failedChecks + 1)).toBe(BOARD_CHECK_RETRY_BASE_MS);
  });

  it("the delay doubles from BOARD_CHECK_RETRY_BASE_MS and never exceeds the cap", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map(boardCheckRetryDelayMs);
    console.log(`board check backoff (ms): ${delays.join(", ")} (cap ${RECONNECT_MAX_BACKOFF_MS})`);
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });

  it("boardId is carried through every phase, so the page can name the link", () => {
    const unreachable = nextBoardPageState(checking, { type: "check-failed" });
    for (const state of [checking, unreachable, nextBoardPageState(unreachable, { type: "recheck" })]) {
      expect(state.boardId).toBe(VALID_ID);
    }
  });
});
