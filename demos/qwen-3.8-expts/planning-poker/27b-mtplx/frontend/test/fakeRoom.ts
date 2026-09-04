// A fake WebSocket server that speaks the real game protocol,
// driven by the actual reducer from src/rules.ts.
import { createInitialState, reducer } from "../../src/rules";
import type { Action, GameState } from "../../src/types";

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

let nextGenId = 1;

export class FakeSocket {
  readyState = WS_CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  playerId: string | null = null;
  url: string;
  private server: FakeRoom;

  constructor(url: string, server: FakeRoom) {
    this.url = url;
    this.server = server;
    server.add(this);
    setTimeout(() => {
      if (this.readyState !== WS_CONNECTING) return;
      this.readyState = WS_OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string) {
    if (this.readyState !== WS_OPEN) throw new Error("Sent before connected.");
    this.sent.push(data);
    this.server.receive(this, JSON.parse(data));
  }

  close() {
    if (this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSED;
    this.server.remove(this);
    this.onclose?.();
  }

  receive(message: unknown) {
    if (this.readyState === WS_OPEN) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  // Test helper: simulate a network drop.
  drop() {
    if (this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSED;
    this.onclose?.();
  }
}

function toAction(msg: Record<string, unknown>, playerId: string): Action | null {
  switch (msg.type) {
    case "vote":
      return { type: "vote", playerId, value: Number(msg.value) };
    case "clearVote":
      return { type: "clearVote", playerId };
    case "addIssue":
      return {
        type: "addIssue",
        playerId,
        title: String(msg.title ?? ""),
        description: String(msg.description ?? ""),
      };
    case "removeIssue":
      return { type: "removeIssue", playerId, issueId: String(msg.issueId ?? "") };
    case "startRound":
      return {
        type: "startRound",
        playerId,
        issueId: typeof msg.issueId === "string" ? msg.issueId : null,
      };
    case "nextIssue":
      return { type: "nextIssue", playerId };
    case "revote":
      return { type: "revote", playerId };
    default:
      return null;
  }
}

export class FakeRoom {
  state: GameState | null = null;
  sockets: FakeSocket[] = [];
  readonly gameId: string;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  add(socket: FakeSocket) {
    this.sockets.push(socket);
    if (!this.state) this.state = createInitialState(this.gameId);
  }

  remove(socket: FakeSocket) {
    this.sockets = this.sockets.filter((s) => s !== socket);
    if (!socket.playerId || !this.state) return;
    const result = reducer(this.state, { type: "leave", playerId: socket.playerId });
    if (result.state) {
      this.state = result.state;
      if (Object.keys(this.state.players).length === 0) {
        this.state = createInitialState(this.gameId);
      }
    }
    this.broadcast();
  }

  receive(socket: FakeSocket, msg: Record<string, unknown>) {
    if (!this.state) return;
    if (msg.type === "join") {
      const playerId =
        typeof msg.playerId === "string" && msg.playerId !== ""
          ? msg.playerId
          : `gen-${nextGenId++}`;
      const result = reducer(this.state, {
        type: "join",
        playerId,
        name: String(msg.name ?? ""),
      });
      if (result.error !== undefined) {
        socket.receive({ type: "error", message: result.error });
        socket.close();
        return;
      }
      this.state = result.state;
      socket.playerId = playerId;
      socket.receive({ type: "joined", playerId });
      this.broadcast();
      return;
    }
    if (!socket.playerId) return;
    const action = toAction(msg, socket.playerId);
    if (!action) return;
    const result = reducer(this.state, action);
    if (result.error !== undefined) {
      socket.receive({ type: "error", message: result.error });
      return;
    }
    this.state = result.state;
    this.broadcast();
  }

  broadcast() {
    if (!this.state) return;
    const payload = { type: "state", state: this.state };
    for (const socket of this.sockets) socket.receive(payload);
  }

  joinedNames(): string[] {
    if (!this.state) return [];
    return Object.values(this.state.players).map((p) => p.name);
  }
}

export function installFakeWebSocket(room: FakeRoom): () => void {
  class FakeWebSocket extends FakeSocket {
    constructor(url: string) {
      super(url, room);
    }
  }
  (FakeWebSocket as unknown as Record<string, number>).CONNECTING = WS_CONNECTING;
  (FakeWebSocket as unknown as Record<string, number>).OPEN = WS_OPEN;
  (FakeWebSocket as unknown as Record<string, number>).CLOSING = WS_CLOSING;
  (FakeWebSocket as unknown as Record<string, number>).CLOSED = WS_CLOSED;

  const previous = globalThis.WebSocket;
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  return () => {
    (globalThis as { WebSocket: unknown }).WebSocket = previous;
  };
}
