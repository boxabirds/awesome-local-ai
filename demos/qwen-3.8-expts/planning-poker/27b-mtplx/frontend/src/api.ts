import type { GameState } from "../../src/types";

export interface GameClientHandlers {
  onState: (state: GameState) => void;
  onJoined: (playerId: string) => void;
  onJoinFailed: (message: string) => void;
  onError: (message: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

const MAX_RETRIES = 5;

interface ServerMessage {
  type: string;
  state?: GameState;
  playerId?: string;
  message?: string;
}

export class GameClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private joinFailed = false;
  private acked = false;
  private name = "";
  private playerId: string | null = null;
  private joinQueued = false;

  constructor(private readonly gameId: string, private readonly handlers: GameClientHandlers) {}

  /** Open the socket. A previously queued join is sent when it opens. */
  connect() {
    if (this.closed) return;
    if (!this.ws) this.open();
  }

  /**
   * Join the game with these credentials. Opens the socket if needed;
   * the join is sent immediately, or queued until the socket opens.
   */
  join(name: string, playerId: string | null) {
    this.name = name;
    this.playerId = playerId;
    this.joinQueued = true;
    this.joinFailed = false;
    this.closed = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.acked = false;
      this.send({ type: "join", name: this.name, playerId: this.playerId });
    } else {
      this.connect();
    }
  }

  private open() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/games/${this.gameId}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.acked = false;
      this.handlers.onOpen();
      if (this.joinQueued) {
        this.send({ type: "join", name: this.name, playerId: this.playerId });
      }
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "state" && msg.state) {
        this.handlers.onState(msg.state);
      } else if (msg.type === "joined" && msg.playerId) {
        this.acked = true;
        this.handlers.onJoined(msg.playerId);
      } else if (msg.type === "error" && msg.message) {
        if (!this.acked) {
          this.joinFailed = true;
          this.handlers.onJoinFailed(msg.message);
        } else {
          this.handlers.onError(msg.message);
        }
      }
    };

    ws.onclose = () => {
      this.handlers.onClose();
      this.ws = null;
      if (this.closed || this.joinFailed) return;
      if (this.retry < MAX_RETRIES) {
        this.retry += 1;
        window.setTimeout(() => this.open(), this.retry * 1000);
      }
    };

    ws.onerror = () => ws.close();
  }

  send(action: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(action));
    }
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

export async function createGame(): Promise<string> {
  const res = await fetch("/api/games", { method: "POST" });
  if (!res.ok) throw new Error("Failed to create game");
  const data = (await res.json()) as { gameId: string };
  return data.gameId;
}