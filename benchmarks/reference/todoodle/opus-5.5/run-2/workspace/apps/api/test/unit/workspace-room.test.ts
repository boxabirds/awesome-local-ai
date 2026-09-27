import { describe, expect, it, vi } from 'vitest';
import { WorkspaceRoom } from '../../src/live/WorkspaceRoom';
import { workspaceEvent } from '../live-fixtures';

type FakeSocket = { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

function fakeSocket(throws = false): FakeSocket {
  return {
    send: vi.fn(() => {
      if (throws) throw new Error('socket gone');
    }),
    close: vi.fn(),
  };
}

/**
 * The runtime refuses to construct a DurableObject with anything but a real DurableObjectState,
 * so the methods under test run against a fake `ctx` (`this`). The constructor's ping/pong
 * auto-response is covered by the integration test TC-R04.
 */
function room(sockets: FakeSocket[]) {
  const ctx = { getWebSockets: vi.fn(() => sockets) };
  const self = { ctx } as unknown as WorkspaceRoom;
  return {
    room: {
      broadcast: (event: Parameters<WorkspaceRoom['broadcast']>[0]) => WorkspaceRoom.prototype.broadcast.call(self, event),
      webSocketMessage: (ws: WebSocket, message: string) => WorkspaceRoom.prototype.webSocketMessage.call(self, ws, message),
    },
    ctx,
  };
}

describe('WorkspaceRoom (fake ctx)', () => {
  it('TC-R01 3 sockets, one throws: delivered 2, failed 1, the thrower closed with 1011', async () => {
    const good1 = fakeSocket();
    const bad = fakeSocket(true);
    const good2 = fakeSocket();
    const { room: r } = room([good1, bad, good2]);
    const event = workspaceEvent();
    expect(await r.broadcast(event)).toEqual({ delivered: 2, failed: 1 });
    const frame = JSON.stringify(event);
    expect(good1.send).toHaveBeenCalledWith(frame);
    expect(good2.send).toHaveBeenCalledWith(frame);
    expect(bad.close).toHaveBeenCalledWith(1011, expect.any(String));
    expect(good1.close).not.toHaveBeenCalled();
  });

  it('TC-R01 zero sockets: nothing delivered, no error', async () => {
    expect(await room([]).room.broadcast(workspaceEvent())).toEqual({ delivered: 0, failed: 0 });
  });

  it('TC-R02 a client message is ignored: nothing sent, nothing closed', async () => {
    const a = fakeSocket();
    const b = fakeSocket();
    const { room: r } = room([a, b]);
    await r.webSocketMessage(a as unknown as WebSocket, JSON.stringify(workspaceEvent()));
    await r.webSocketMessage(a as unknown as WebSocket, 'hello');
    for (const s of [a, b]) {
      expect(s.send).not.toHaveBeenCalled();
      expect(s.close).not.toHaveBeenCalled();
    }
  });
});
