import { DurableObject } from 'cloudflare:workers';
import { LIVE_PING, LIVE_PONG } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import type { Env } from '../env.ts';

/** WebSocket close code for a socket whose send failed. */
const CLOSE_SEND_FAILED = 1011;

export type BroadcastResult = { delivered: number; failed: number };

/**
 * One room per workspace (idFromName(workspaceId)). It holds no data of record, only hibernatable
 * sockets: the Worker authenticates the upgrade before forwarding it here, and mutation routes call
 * broadcast() over RPC after their D1 write commits. Clients never write through the socket.
 */
export class WorkspaceRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime, so they never wake a hibernated room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG));
  }

  /** Accepts an (already authenticated) upgrade with the Hibernation API. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends the event to every socket in the room. Serialised once; a socket that throws is closed. */
  async broadcast(event: LiveEvent): Promise<BroadcastResult> {
    const frame = JSON.stringify(event);
    let delivered = 0;
    let failed = 0;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(frame);
        delivered++;
      } catch {
        failed++;
        try {
          socket.close(CLOSE_SEND_FAILED, 'send failed');
        } catch {
          // Already closed.
        }
      }
    }
    return { delivered, failed };
  }

  /** Clients never write through the socket (pings are auto-answered): anything else is ignored. */
  override async webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  override async webSocketClose(socket: WebSocket): Promise<void> {
    closeQuietly(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    closeQuietly(socket);
  }
}

function closeQuietly(socket: WebSocket): void {
  try {
    socket.close();
  } catch {
    // Already closed: nothing else to clean up.
  }
}
