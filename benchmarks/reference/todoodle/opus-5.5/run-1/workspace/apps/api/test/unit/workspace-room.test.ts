import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '@todoodle/shared/events';
import { WorkspaceRoom } from '../../src/live/WorkspaceRoom.ts';

const EVENT: LiveEvent = {
  type: 'workspace.updated',
  entity: { id: '0123456789ABCDEF0123456789ABCDEF', name: 'Groceries', version: 2, createdAt: '2026-09-26 10:00:00' },
  version: 2,
  originClientId: '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11',
};

function fakeSocket(opts: { throws?: boolean } = {}) {
  return {
    send: vi.fn(() => {
      if (opts.throws) throw new Error('socket gone');
    }),
    close: vi.fn(),
  };
}

/**
 * The room's methods against a fake ctx. workerd only lets the runtime construct a DurableObject, so the
 * instance is a prototype-linked object carrying the fake ctx (the methods only use this.ctx).
 */
function roomWith(sockets: ReturnType<typeof fakeSocket>[]) {
  const ctx = {
    getWebSockets: vi.fn(() => sockets),
    acceptWebSocket: vi.fn(),
  };
  const room = Object.assign(Object.create(WorkspaceRoom.prototype) as WorkspaceRoom, { ctx });
  return { room, ctx };
}

describe('live.room: WorkspaceRoom', () => {
  it('registers ping/pong as an auto-response so heartbeats never wake the room', async () => {
    const stub = env.WORKSPACE_ROOM.get(env.WORKSPACE_ROOM.idFromName('0123456789ABCDEF0123456789ABCDEF'));
    await runInDurableObject(stub, (_instance: WorkspaceRoom, state) => {
      const pair = state.getWebSocketAutoResponse();
      expect(pair?.request).toBe('ping');
      expect(pair?.response).toBe('pong');
    });
  });

  it('TC-R01 3 sockets, one throws: delivered 2, failed 1, the thrower is closed with 1011', async () => {
    const [a, b, c] = [fakeSocket(), fakeSocket({ throws: true }), fakeSocket()];
    const { room } = roomWith([a, b, c]);
    expect(await room.broadcast(EVENT)).toEqual({ delivered: 2, failed: 1 });
    const frame = JSON.stringify(EVENT);
    expect(a.send).toHaveBeenCalledWith(frame);
    expect(c.send).toHaveBeenCalledWith(frame);
    expect(b.close).toHaveBeenCalledWith(1011, expect.any(String));
    expect(a.close).not.toHaveBeenCalled();
    expect(c.close).not.toHaveBeenCalled();
  });

  it('zero sockets: delivered 0, failed 0', async () => {
    const { room } = roomWith([]);
    expect(await room.broadcast(EVENT)).toEqual({ delivered: 0, failed: 0 });
  });

  it('TC-R02 an arbitrary client message is ignored: nothing sent, nothing closed', async () => {
    const [a, b] = [fakeSocket(), fakeSocket()];
    const { room, ctx } = roomWith([a, b]);
    await room.webSocketMessage(a as unknown as WebSocket, JSON.stringify(EVENT));
    await room.webSocketMessage(a as unknown as WebSocket, 'hello');
    for (const socket of [a, b]) {
      expect(socket.send).not.toHaveBeenCalled();
      expect(socket.close).not.toHaveBeenCalled();
    }
    expect(ctx.getWebSockets).not.toHaveBeenCalled();
  });

  it('a plain request (no Upgrade) to the room is refused with 426', async () => {
    const { room, ctx } = roomWith([]);
    const res = await room.fetch(new Request('https://todoodle.test/api/w/x/live'));
    expect(res.status).toBe(426);
    expect(ctx.acceptWebSocket).not.toHaveBeenCalled();
  });
});
