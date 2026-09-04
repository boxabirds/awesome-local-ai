import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { FakeRoom, installFakeWebSocket } from "./fakeRoom";

const GAME_ID = "testgame1";
const NAME_KEY = `pp-name-${GAME_ID}`;

let room: FakeRoom;
let restoreWebSocket: () => void;

function renderGame() {
  return render(
    <MemoryRouter initialEntries={[`/game/${GAME_ID}`]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  room = new FakeRoom(GAME_ID);
  restoreWebSocket = installFakeWebSocket(room);
});

afterEach(() => {
  restoreWebSocket();
  cleanup();
});

describe("join flow", () => {
  it("auto-joins when the landing page saved a name (bug repro)", async () => {
    // Landing saves the name under pp-name-<gameId> before navigating here.
    sessionStorage.setItem(NAME_KEY, "Alice");
    renderGame();

    await waitFor(
      () => {
        expect(room.joinedNames()).toContain("Alice");
      },
      { timeout: 2000 },
    );
    await screen.findByText(/alice/i);
  });

  it("lets a new visitor join via the form", async () => {
    renderGame();

    const input = await screen.findByPlaceholderText("e.g. Ada");
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(
      () => {
        expect(room.joinedNames()).toContain("Bob");
      },
      { timeout: 2000 },
    );
    await screen.findByText(/bob/i);
  });

  it("first joiner sees the facilitator UI", async () => {
    sessionStorage.setItem(NAME_KEY, "Alice");
    renderGame();

    await waitFor(
      () => {
        expect(room.joinedNames()).toContain("Alice");
      },
      { timeout: 2000 },
    );
    await screen.findByText("Facilitator");
  });

  it("rejoins with the stored player id", async () => {
    sessionStorage.setItem(NAME_KEY, "Alice");
    sessionStorage.setItem(`pp-player-${GAME_ID}`, "seat-1");
    renderGame();

    await waitFor(
      () => {
        expect(room.state?.players["seat-1"]).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });
});