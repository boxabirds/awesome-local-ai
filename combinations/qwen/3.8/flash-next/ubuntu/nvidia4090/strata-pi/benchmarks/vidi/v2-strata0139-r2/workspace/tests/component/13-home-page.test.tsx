/**
 * Home page component tests (`share.pages`) — TC-16, TC-17.
 *
 * Creation is injected: these tests assert *what the page does with* a created
 * board (navigate to its link) and what it does when creation fails (say so, and
 * stay put). No network, no server.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { newBoardId } from "../../src/shared/board-id";
import { isValidBoardId } from "../../src/shared/board-id";
import { boardPath, HOME_PATH } from "../../src/client/routing";
import { HomePage } from "../../src/client/pages/HomePage";
import type { CreateBoardFn } from "../../src/client/api";

function home(create: CreateBoardFn, navigate = vi.fn()) {
  render(<HomePage navigate={navigate} create={create} />);
  return navigate;
}

const button = () => screen.getByTestId("new-board-button") as HTMLButtonElement;

describe("home page (`share.pages`)", () => {
  it("shows a New board button, the story title line, and nothing else to decode", () => {
    home(async () => ({ ok: false, reason: "network" }));

    expect(screen.getByTestId("home-page")).toBeTruthy();
    expect(button().textContent).toBe("New board");
    expect(screen.getByRole("heading", { name: /vidi6/ })).toBeTruthy();
  });

  it("offers no board list and no field for typing an address (negative)", () => {
    home(async () => ({ ok: false, reason: "network" }));

    // A link is how a board is shared; the home page has no list of boards and
    // no place to type one.
    expect(document.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(screen.queryByRole("list")).toBeNull();
    expect(document.querySelectorAll("[data-testid='share-button']")).toHaveLength(0);
  });

  it("is the page the / route renders", () => {
    window.history.replaceState(null, "", HOME_PATH);
    home(async () => ({ ok: false, reason: "network" }));
    expect(window.location.pathname).toBe(HOME_PATH);
  });
});

describe("creating a board from home (TC-16)", () => {
  it("clicking New board asks for a board and goes to it", async () => {
    const id = newBoardId();
    const create = vi.fn<CreateBoardFn>(async () => ({ ok: true, id }));
    const navigate = home(create);

    fireEvent.click(button());

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(boardPath(id), { replace: true });
  });

  it("the board navigated to is the id the server returned, unchanged", async () => {
    const id = newBoardId();
    const navigate = home(async () => ({ ok: true, id }));

    fireEvent.click(button());
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

    const path = navigate.mock.calls[0]![0];
    expect(path).toBe(`/b/${id}`);
    expect(isValidBoardId(path.slice("/b/".length))).toBe(true);
  });

  it("the button is busy while the board is being created", async () => {
    let release: () => void = () => undefined;
    const create = vi.fn<CreateBoardFn>(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, id: newBoardId() }))),
    );
    home(create);

    fireEvent.click(button());
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Creating…");

    release();
    await vi.waitFor(() => expect(button().disabled).toBe(false));
  });

  it("a second click while creating does not create a second board", async () => {
    let release: () => void = () => undefined;
    const create = vi.fn<CreateBoardFn>(
      () => new Promise((resolve) => (release = () => resolve({ ok: true, id: newBoardId() }))),
    );
    home(create);

    fireEvent.click(button());
    fireEvent.click(button());
    expect(create).toHaveBeenCalledTimes(1);

    release();
  });
});

describe("creation failure (TC-17)", () => {
  it("a failed creation says so and stays on home (TC-17)", async () => {
    const navigate = home(async () => ({ ok: false, reason: "network" }));

    fireEvent.click(button());

    await vi.waitFor(() => expect(screen.getByTestId("create-error")).toBeTruthy());
    // The spec's wording, verbatim (TC-17).
    expect(screen.getByTestId("create-error").textContent).toBe(
      "Couldn\u2019t create a board. Please try again.",
    );
    // Negative half: no navigation, and still on the home page.
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-page")).toBeTruthy();
    expect(screen.queryByTestId("board-page")).toBeNull();
    expect(screen.queryByTestId("board-viewport")).toBeNull();
  });

  it("a server that answers create_failed says so the same way", async () => {
    home(async () => ({ ok: false, reason: "create_failed" }));

    fireEvent.click(button());

    await vi.waitFor(() => expect(screen.getByTestId("create-error")).toBeTruthy());
  });

  it("the button works again after a failure", async () => {
    let attempt = 0;
    const id = newBoardId();
    const navigate = home(async () => {
      attempt += 1;
      return attempt === 1 ? { ok: false, reason: "network" } : { ok: true, id };
    });

    fireEvent.click(button());
    await vi.waitFor(() => expect(screen.getByTestId("create-error")).toBeTruthy());

    fireEvent.click(button());
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(boardPath(id), { replace: true });
    expect(screen.queryByTestId("create-error")).toBeNull();
  });

  it("a creation that throws is reported, not swallowed", async () => {
    const navigate = home(async () => {
      throw new Error("boom");
    });

    fireEvent.click(button());

    await vi.waitFor(() => expect(screen.getByTestId("create-error")).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });
});
