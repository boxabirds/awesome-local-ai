import { LIVE_EVENT_TYPES, LiveEvent, type LiveEventInput, eventByteSize, isUuid } from '@todoodle/shared/events';
import { LIVE_MAX_EVENT_BYTES } from '@todoodle/shared/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AppContext, broadcast, originClientIdFrom, prepareEvent } from '../../src/live/broadcast.ts';

// Realistic fixtures: 16-byte uppercase hex ids (as D1 makes them) and UUID client ids.
const WS_ID = '0123456789ABCDEF0123456789ABCDEF';
const TASK_ID = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
const PROJECT_ID = 'FEDCBA9876543210FEDCBA9876543210';
const CLIENT = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';

const workspace = { id: WS_ID, name: 'Trip to Lisbon ✈️', version: 3, createdAt: '2026-09-26 10:00:00' };

const VALID: LiveEvent[] = [
  { type: 'workspace.updated', entity: workspace, version: 3, originClientId: CLIENT },
  { type: 'project.upserted', entity: { id: PROJECT_ID, version: 2, name: 'Home' }, version: 2, originClientId: null },
  { type: 'project.restored', entity: { id: PROJECT_ID, version: 4 }, version: 4, originClientId: CLIENT },
  { type: 'project.deleted', entity: { id: PROJECT_ID }, version: 5, originClientId: CLIENT },
  { type: 'task.upserted', entity: { id: TASK_ID, version: 7, title: 'Buy milk' }, version: 7, originClientId: CLIENT },
  { type: 'task.restored', entity: { id: TASK_ID, version: 8 }, version: 8, originClientId: null },
  { type: 'task.deleted', entity: { id: TASK_ID }, version: 9, originClientId: CLIENT },
  { type: 'tasks.bulk', entity: { ids: [TASK_ID, 'B1B2C3D4E5F60718293A4B5C6D7E8F90'] }, version: 10, originClientId: null },
];

/** A workspace.updated event whose serialised size (with originClientId null) is exactly `bytes`. */
function eventOfSize(bytes: number): LiveEventInput {
  const base = { type: 'workspace.updated' as const, entity: { ...workspace, name: '' }, version: 3 };
  const overhead = eventByteSize({ ...base, originClientId: null });
  return { ...base, entity: { ...workspace, name: 'x'.repeat(bytes - overhead) } };
}

afterEach(() => vi.restoreAllMocks());

describe('live.broadcast: LiveEvent contract', () => {
  it('TC-E01 every valid variant parses (one per event type)', () => {
    expect(VALID.map((event) => event.type)).toEqual(LIVE_EVENT_TYPES);
    for (const event of VALID) expect(LiveEvent.parse(event)).toEqual(event);
  });

  it('TC-E02 an unknown type fails', () => {
    expect(LiveEvent.safeParse({ ...VALID[0], type: 'workspace.exploded' }).success).toBe(false);
  });

  it('TC-E03 an event without version fails', () => {
    const { version: _version, ...withoutVersion } = VALID[4]!;
    expect(LiveEvent.safeParse(withoutVersion).success).toBe(false);
  });

  it('TC-E04 a client-id header that is not a UUID derives originClientId null', () => {
    for (const bad of [undefined, null, '', 'client-1', `${CLIENT}x`, '6f1c2a4e9b3d4c7a8e215d0f9a7b3c11']) {
      expect(originClientIdFrom(bad)).toBeNull();
    }
    expect(originClientIdFrom(CLIENT)).toBe(CLIENT);
    expect(isUuid(CLIENT.toUpperCase())).toBe(true);
  });

  it('eventByteSize counts UTF-8 bytes (multi-byte names)', () => {
    expect(eventByteSize('é')).toBe(4); // quotes + 2 bytes
    expect(eventByteSize('✈')).toBe(5);
    expect(eventByteSize('😀')).toBe(6);
  });
});

describe('live.broadcast: size limit', () => {
  function fakeContext(clientId?: string) {
    const rpc = vi.fn(() => Promise.resolve({ delivered: 0, failed: 0 }));
    const waitUntil = vi.fn((promise: Promise<unknown>) => void promise);
    const c = {
      get: () => 'req-123',
      req: { header: (name: string) => (name === 'X-Todoodle-Client-Id' ? clientId : undefined) },
      env: { WORKSPACE_ROOM: { idFromName: (name: string) => name, get: () => ({ broadcast: rpc }) } },
      executionCtx: { waitUntil },
    } as unknown as AppContext;
    return { c, rpc, waitUntil };
  }

  it('TC-E05 an event of exactly LIVE_MAX_EVENT_BYTES is accepted and sent', async () => {
    const event = eventOfSize(LIVE_MAX_EVENT_BYTES);
    expect(eventByteSize({ ...event, originClientId: null })).toBe(LIVE_MAX_EVENT_BYTES);
    expect(prepareEvent(event, null, 'req-1')).not.toBeNull();

    const { c, rpc, waitUntil } = fakeContext();
    broadcast(c, WS_ID, event);
    await waitUntil.mock.calls[0]![0];
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual([{ ...event, originClientId: null }]);
  });

  it('TC-E06 one byte more is rejected and logged with the request id, and no RPC is made', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = eventOfSize(LIVE_MAX_EVENT_BYTES + 1);
    const { c, rpc, waitUntil } = fakeContext();
    broadcast(c, WS_ID, event);
    expect(rpc).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('live broadcast failed', expect.objectContaining({ requestId: 'req-123', reason: 'event_too_large' }));
  });

  it('stamps the request client id as originClientId', async () => {
    const { c, rpc, waitUntil } = fakeContext(CLIENT);
    broadcast(c, WS_ID, { type: 'workspace.updated', entity: workspace, version: 3 });
    await waitUntil.mock.calls[0]![0];
    expect(rpc).toHaveBeenCalledWith({ type: 'workspace.updated', entity: workspace, version: 3, originClientId: CLIENT });
  });

  it('an invalid event is logged and never sent (never throws into the caller)', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { c, rpc } = fakeContext();
    expect(() => broadcast(c, WS_ID, { type: 'workspace.updated', entity: { id: WS_ID } as never, version: 3 })).not.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('live broadcast failed', expect.objectContaining({ reason: 'invalid_event' }));
  });
});
