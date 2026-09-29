import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './room-core';

export class BoardRoom extends DurableObject {
  private core = new RoomCore();

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.core.handleConnect(server);

    return new Response(null, {
      status: 101,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      body: client,
    } as unknown as ResponseInit);
  }
}
