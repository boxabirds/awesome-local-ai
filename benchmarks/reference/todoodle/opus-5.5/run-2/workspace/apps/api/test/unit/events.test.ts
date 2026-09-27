import { eventByteSize, isUuid, LIVE_EVENT_TYPES, LiveEvent } from '@todoodle/shared/events';
import { LIVE_MAX_EVENT_BYTES } from '@todoodle/shared/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcast, type BroadcastContext, originClientIdFrom } from '../../src/live/broadcast';
import { CLIENT_A, everyVariant, WS_ID, workspaceEvent } from '../live-fixtures';

afterEach(() => vi.restoreAllMocks());

/** A request context with a DO namespace whose stub records broadcast calls. */
function fakeContext(clientIdHeader: string | undefined) {
  const rpc = vi.fn(async () => ({ delivered: 0, failed: 0 }));
  const waits: Promise<unknown>[] = [];
  const idFromName = vi.fn((name: string) => ({ name }));
  const c = {
    env: { WORKSPACE_ROOM: { idFromName, get: () => ({ broadcast: rpc }) } },
    executionCtx: { waitUntil: (p: Promise<unknown>) => waits.push(p) },
    get: () => 'req-123',
    req: { header: (name: string) => (name === 'X-Todoodle-Client-Id' ? clientIdHeader : undefined), method: 'PATCH', path: `/api/w/${WS_ID}` },
  } as unknown as BroadcastContext;
  return { c, rpc, waits, idFromName };
}

/** A workspace.updated event whose JSON is exactly `bytes` long (padding the name). */
function eventOfSize(bytes: number): LiveEvent {
  const base = workspaceEvent({ originClientId: CLIENT_A });
  const pad = bytes - eventByteSize({ ...base, entity: { ...base.entity, name: '' } } as LiveEvent);
  return { ...base, entity: { ...base.entity, name: 'x'.repeat(pad) } } as LiveEvent;
}

describe('LiveEvent contract', () => {
  it('TC-E01 every variant in the union parses', () => {
    const variants = everyVariant();
    expect(variants.map((e) => e.type)).toEqual([...LIVE_EVENT_TYPES]);
    for (const event of variants) expect(LiveEvent.safeParse(event).success).toBe(true);
  });

  it('TC-E02 an unknown type fails', () => {
    expect(LiveEvent.safeParse({ ...workspaceEvent(), type: 'workspace.renamed' }).success).toBe(false);
  });

  it('TC-E03 an event without version fails', () => {
    const { version: _dropped, ...rest } = workspaceEvent();
    expect(LiveEvent.safeParse(rest).success).toBe(false);
  });
});

describe('broadcast helper (unit)', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a uuid', 'tab-1'],
    ['uuid with junk', `${CLIENT_A}x`],
  ])('TC-E04 X-Todoodle-Client-Id %s -> originClientId null', (_label, header) => {
    expect(originClientIdFrom(header)).toBeNull();
    expect(isUuid(header)).toBe(false);
  });

  it('TC-E04 a UUID header becomes the originClientId', () => {
    expect(originClientIdFrom(CLIENT_A)).toBe(CLIENT_A);
  });

  it('TC-E05 an event exactly LIVE_MAX_EVENT_BYTES is accepted and sent to the workspace room', async () => {
    const event = eventOfSize(LIVE_MAX_EVENT_BYTES);
    expect(eventByteSize(event)).toBe(LIVE_MAX_EVENT_BYTES);
    const { c, rpc, waits, idFromName } = fakeContext(CLIENT_A);
    const { originClientId: _o, ...input } = event;
    broadcast(c, WS_ID, input);
    await Promise.all(waits);
    expect(idFromName).toHaveBeenCalledWith(WS_ID);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(event);
  });

  it('TC-E06 one byte more is rejected and logged, with no RPC', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const event = eventOfSize(LIVE_MAX_EVENT_BYTES + 1);
    const { c, rpc, waits } = fakeContext(CLIENT_A);
    const { originClientId: _o, ...input } = event;
    expect(() => broadcast(c, WS_ID, input)).not.toThrow();
    await Promise.all(waits);
    expect(rpc).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls[0])).toContain('req-123');
    expect(JSON.stringify(error.mock.calls[0])).toContain('too large');
  });
});
