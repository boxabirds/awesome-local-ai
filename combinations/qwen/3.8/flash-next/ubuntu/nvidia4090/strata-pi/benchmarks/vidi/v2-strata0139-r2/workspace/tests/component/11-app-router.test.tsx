/**
 * Router component tests (`share.pages`) — routing, TC-19, TC-20.
 *
 * `parseRoute` is asserted as a pure function (the route model is the contract),
 * and `AppRouter` is asserted as the thing that renders exactly one page for it.
 * The negatives matter as much as the positives: a board address must not render
 * the home page, and a non-board path must not render a board.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { newBoardId } from "../../src/shared/board-id";
import { AppRouter, HOME_PATH, boardPath, parseRoute, useRoute } from "../../src/client/router";

const VALID_ID = "aB3-_x9A8b7C6d5E4f3G2h";

/** A fetch that never answers, so a board page stays in its "checking" phase. */
function pendingFetch() {
  return vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
}

describe("parseRoute (`share.pages` routing)", () => {
  it("maps / to home", () => {
    expect(parseRoute(HOME_PATH)).toEqual({ name: "home" });
  });

  it("maps /b/<valid id> to that board", () => {
    expect(parseRoute(`/b/${VALID_ID}`)).toEqual({ name: "board", boardId: VALID_ID });
    const fresh = newBoardId();
    expect(parseRoute(`/b/${fresh}`)).toEqual({ name: "board", boardId: fresh });
  });

  it("maps a malformed board address to not_found", () => {
    for (const path of [
      "/b/not-an-id",
      `/b/${VALID_ID}x`,
      VALID_ID.slice(0, 21),
      "/b/",
      "/b/../secret",
      `/b/${VALID_ID}%20`,
    ]) {
      expect(parseRoute(path), path).toEqual({ name: "not_found" });
    }
  });

  it("maps any other path to not_found", () => {
    for (const path of ["/settings", "/b", "/boards", "/join/room", "/favicon.ico"]) {
      expect(parseRoute(path), path).toEqual({ name: "not_found" });
    }
  });
});

describe("AppRouter (`share.pages` routing)", () => {
  function at(pathname: string) {
    window.history.replaceState(null, "", pathname);
  }

  it("renders the home page for /, with a New board button and no board", () => {
    at(HOME_PATH);
    render(<AppRouter />);

    expect(screen.getByTestId("home-page")).toBeTruthy();
    expect(screen.getByTestId("new-board-button")).toBeTruthy();
    expect(screen.queryByTestId("board-viewport")).toBeNull();
    expect(screen.queryByTestId("share-button")).toBeNull();
  });

  it("renders the board page for /b/<id>, starting from the existence check", () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal("fetch", fetchMock);
    at(`/b/${VALID_ID}`);

    render(<AppRouter />);

    // The page asks before it shows anything: no board content yet.
    const status = screen.getByTestId("board-page");
    expect(status.getAttribute("data-board-status")).toBe("checking");
    expect(screen.queryByTestId("board-viewport")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("renders Board not found for a path that names no board", () => {
    at("/settings");
    render(<AppRouter />);

    expect(screen.getByTestId("not-found-page")).toBeTruthy();
    expect(screen.getByTestId("board-address").textContent).toBe("/settings");
  });

  it("renders Board not found for a malformed board address, and never asks about it (TC-19)", () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal("fetch", fetchMock);
    at("/b/not-an-id");

    render(<AppRouter />);

    expect(screen.getByTestId("not-found-page")).toBeTruthy();
    expect(screen.getByTestId("board-address").textContent).toBe("/b/not-an-id");
    // Negative half: an address that is not a board id is not worth asking about.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("board-viewport")).toBeNull();
    expect(screen.queryByTestId("share-button")).toBeNull();

    vi.unstubAllGlobals();
  });

  it("renders the same Board not found page for an unknown-but-valid board id (TC-20)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    at(`/b/${newBoardId()}`);

    render(<AppRouter />);

    expect(await screen.findByTestId("not-found-page")).toBeTruthy();
    expect(screen.queryByTestId("share-button")).toBeNull();
    expect(screen.queryByTestId("board-viewport")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("changes page when the URL changes (Back)", () => {
    at(HOME_PATH);
    render(<AppRouter />);
    expect(screen.getByTestId("home-page")).toBeTruthy();

    window.history.pushState(null, "", `/b/${VALID_ID}`);
    fireEvent.popState(window);

    expect(screen.getByTestId("board-page")).toBeTruthy();
    expect(screen.queryByTestId("home-page")).toBeNull();
  });
});

describe("useRoute().navigate (`share.pages` navigation)", () => {
  function Navigator() {
    const { route, navigate } = useRoute();
    return (
      <div>
        <span data-testid="route-name">{route.name}</span>
        <button type="button" data-testid="push" onClick={() => navigate(boardPath(VALID_ID))}>
          push
        </button>
        <button type="button" data-testid="replace" onClick={() => navigate(HOME_PATH, { replace: true })}>
          replace
        </button>
      </div>
    );
  }

  it("writes history and re-parses", () => {
    window.history.replaceState(null, "", HOME_PATH);
    render(<Navigator />);

    fireEvent.click(screen.getByTestId("push"));

    expect(window.location.pathname).toBe(`/b/${VALID_ID}`);
    expect(screen.getByTestId("route-name").textContent).toBe("board");
  });

  it("replace replaces the current entry instead of stacking a new one", () => {
    window.history.replaceState(null, "", HOME_PATH);
    const before = window.history.length;
    render(<Navigator />);

    fireEvent.click(screen.getByTestId("push"));
    const pushed = window.history.length;
    fireEvent.click(screen.getByTestId("replace"));

    expect(pushed).toBe(before + 1);
    expect(window.history.length).toBe(pushed);
    expect(window.location.pathname).toBe(HOME_PATH);
  });
});
