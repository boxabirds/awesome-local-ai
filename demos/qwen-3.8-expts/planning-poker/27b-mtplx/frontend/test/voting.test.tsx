import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App";
import { FakeRoom, FakeSocket, WS_OPEN, installFakeWebSocket } from "./fakeRoom";

const GAME_ID = "votegame1";
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

async function rawPlayer(name: string): Promise<FakeSocket> {
  const socket = new FakeSocket(`ws://localhost/api/games/${GAME_ID}/ws`, room);
  await waitFor(() => expect(socket.readyState).toBe(WS_OPEN));
  socket.send(JSON.stringify({ type: "join", name }));
  return socket;
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

describe("voting", () => {
  it("facilitator can start a quick vote without adding any issues", async () => {
    sessionStorage.setItem(NAME_KEY, "Alice");
    renderGame();

    const bob = await rawPlayer("Bob");
    await screen.findByText(/2 players/);

    const quickVote = screen.getByRole("button", { name: /quick vote/i });
    fireEvent.click(quickVote);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^vote \d+$/i })).toHaveLength(10);
    });

    fireEvent.click(screen.getByRole("button", { name: /^vote 3$/i }));
    bob.send(JSON.stringify({ type: "vote", value: 3 }));

    await screen.findByText(/consensus: 3/i);
  });

  it("completes a full quick-vote cycle and returns to waiting", async () => {
    sessionStorage.setItem(NAME_KEY, "Alice");
    renderGame();

    const bob = await rawPlayer("Bob");
    await screen.findByText(/2 players/);

    fireEvent.click(screen.getByRole("button", { name: /quick vote/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^vote \d+$/i })).toHaveLength(10);
    });

    fireEvent.click(screen.getByRole("button", { name: /^vote 5$/i }));
    bob.send(JSON.stringify({ type: "vote", value: 8 }));

    await screen.findByText(/no consensus/i);
    fireEvent.click(screen.getByRole("button", { name: /next issue/i }));

    await waitFor(() => {
      expect(room.state?.phase).toBe("waiting");
    });
  });
});