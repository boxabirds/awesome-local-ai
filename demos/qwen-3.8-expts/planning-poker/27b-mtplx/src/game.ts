import { DurableObject } from "cloudflare:workers";
import { toAction, type ClientMsg } from "./actions";
import { createInitialState, randomId, reducer } from "./rules";
import type { Action, GameState, Result } from "./types";

export interface GameRoomEnv {}

export class GameRoom extends DurableObject<GameRoomEnv> {
  private state: GameState | null = null;
  private sockets = new Map<WebSocket, string>();

  constructor(ctx: DurableObjectState, env: GameRoomEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const persisted = await this.ctx.storage.get<GameState>("state");
      this.state = persisted ?? null;
    });
  }

  async init(gameId: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.state) {
        this.state = createInitialState(gameId);
        await this.persist();
      }
    });
  }

  private async persist(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put("state", JSON.stringify(this.state));
    }
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener("message", (event) => {
      void this.handleMessage(server, String(event.data));
    });
    server.addEventListener("close", () => {
      void this.handleClose(server);
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendTo(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private broadcast(): void {
    if (!this.state) return;
    const payload = JSON.stringify({ type: "state", state: this.state });
    for (const ws of this.sockets.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  async submit(action: Action): Promise<Result> {
    if (!this.state) return { error: "Game not initialized" };
    const result = reducer(this.state, action);
    if (result.state) {
      this.state = result.state;
      await this.persist();
      this.broadcast();
    }
    return result;
  }

  async handleMessage(ws: WebSocket, message: string): Promise<void> {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      return;
    }

    if (msg.type === "join") {
      const playerId = msg.playerId ?? randomId(10);
      const result = await this.submit({
        type: "join",
        playerId,
        name: String(msg.name ?? ""),
      });
      if (result.error) {
        this.sendTo(ws, { type: "error", message: result.error });
        ws.close();
        return;
      }
      this.sockets.set(ws, playerId);
      this.sendTo(ws, { type: "joined", playerId });
      this.broadcast();
      return;
    }

    const playerId = this.sockets.get(ws);
    if (!playerId) return;
    const action = toAction(msg, playerId);
    if (!action) return;
    const result = await this.submit(action);
    if (result.error) {
      this.sendTo(ws, { type: "error", message: result.error });
    }
  }

  async handleClose(ws: WebSocket): Promise<void> {
    const playerId = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (!playerId || !this.state) return;

    const result = reducer(this.state, { type: "leave", playerId });
    if (result.state) {
      this.state = result.state;
      await this.persist();
      this.broadcast();
      if (Object.keys(this.state.players).length === 0) {
        this.state = createInitialState(this.state.gameId);
        await this.persist();
      }
    }
  }
}
