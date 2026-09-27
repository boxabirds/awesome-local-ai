import type { LiveEvent } from '@todoodle/shared/events';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

export type BroadcastResult = { delivered: number; failed: number };

/** Closing an already-closed socket throws; nothing else is left to clean up. */
function closeQuietly(ws: WebSocket, code?: number, reason?: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

/**
 * One room per workspace (idFromName(workspaceId)). Holds only hibernatable sockets, never data
 * of record. Clients never write through the socket: changes arrive through broadcast().
 */
export class WorkspaceRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime and never wake the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The /live route has already checked Upgrade, Origin and workspace access. */
  override async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Serialises once and sends to every socket; a socket that throws is closed with 1011. */
  async broadcast(event: LiveEvent): Promise<BroadcastResult> {
    const frame = JSON.stringify(event);
    let delivered = 0;
    let failed = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame);
        delivered++;
      } catch {
        failed++;
        closeQuietly(ws, 1011, 'send failed');
      }
    }
    return { delivered, failed };
  }

  /** Clients only ever send `ping` (auto-answered); anything else is ignored. */
  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are reserved and can't be sent back.
    closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    closeQuietly(ws, 1011, 'error');
  }
}
