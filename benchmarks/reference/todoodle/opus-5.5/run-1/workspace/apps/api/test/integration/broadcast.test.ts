import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { LiveEvent } from '@todoodle/shared/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app.ts';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import { url } from '../support/http.ts';
import { connectLive, framesAfter } from '../support/live.ts';
import { Browser, JSON_CLIENT, rowById } from '../support/workspaces.ts';

const CLIENT_X = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';

async function member() {
  const browser = new Browser();
  const { workspace } = await browser.create();
  return { browser, id: workspace.id };
}

describe('live.broadcast: rename fans out workspace.updated', () => {
  afterEach(() => vi.restoreAllMocks());

  it('TC-B01 both sockets on W receive workspace.updated with the new version and origin X', async () => {
    const { browser, id } = await member();
    const [a, b] = await Promise.all([connectLive(browser, id), connectLive(browser, id)]);
    expect(await rowById(id)).toMatchObject({ name: 'My Todoodle', version: 1 });

    const res = await browser.rename(id, 'Groceries', { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_X });
    expect(res.status).toBe(200);
    expect(await rowById(id)).toMatchObject({ name: 'Groceries', version: 2 });

    for (const client of [a!, b!]) {
      const [frame] = await client.waitForFrames(1);
      const event = LiveEvent.parse(JSON.parse(frame!));
      expect(event).toEqual({
        type: 'workspace.updated',
        entity: { id, name: 'Groceries', version: 2, createdAt: expect.any(String) },
        version: 2,
        originClientId: CLIENT_X,
      });
      client.close();
    }
  });

  it('a client id that is not a UUID is sent as originClientId null', async () => {
    const { browser, id } = await member();
    const client = await connectLive(browser, id);
    await browser.rename(id, 'Groceries', { ...JSON_CLIENT, [CLIENT_ID_HEADER]: 'not-a-uuid' });
    const [frame] = await client.waitForFrames(1);
    expect(JSON.parse(frame!)).toMatchObject({ originClientId: null });
    client.close();
  });

  it('TC-B02 a rename of W is never delivered to sockets on V', async () => {
    const w = await member();
    const v = await member();
    const onW = await connectLive(w.browser, w.id);
    const onV = await connectLive(v.browser, v.id);
    await w.browser.rename(w.id, 'Only W');
    await onW.waitForFrames(1);
    expect(await framesAfter(onV, 300)).toEqual([]);
    onW.close();
    onV.close();
  });

  it('TC-B03 an empty name is 400 and no frame arrives within 500 ms', async () => {
    const { browser, id } = await member();
    const client = await connectLive(browser, id);
    const res = await browser.rename(id, '');
    expect(res.status).toBe(400);
    expect(await framesAfter(client, 500)).toEqual([]);
    expect(await rowById(id)).toMatchObject({ name: 'My Todoodle', version: 1 });
    client.close();
  });

  it('TC-B04 a throwing Durable Object never fails the write: 200, D1 updated, error logged with the request id', async () => {
    const { browser, id } = await member();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingRoom = {
      idFromName: (name: string) => env.WORKSPACE_ROOM.idFromName(name),
      get: () => ({
        broadcast: () => Promise.reject(new Error('room unavailable')),
      }),
    };
    const ctx = createExecutionContext();
    const body = JSON.stringify({ name: 'Still saved' });
    const request = new Request(url(`/api/w/${id}`), {
      method: 'PATCH',
      // app.fetch is called directly (not through the runtime), so Content-Length must be explicit.
      headers: { ...JSON_CLIENT, Cookie: browser.cookie!, 'Content-Length': String(body.length) },
      body,
    });
    const res = await app.fetch(request, { ...env, WORKSPACE_ROOM: throwingRoom as unknown as typeof env.WORKSPACE_ROOM }, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspace: { name: 'Still saved', version: 2 } });
    expect(await rowById(id)).toMatchObject({ name: 'Still saved', version: 2 });
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    expect(logged).toHaveBeenCalledWith(
      'live broadcast failed',
      expect.objectContaining({ requestId, reason: 'rpc_failed', errorMessage: 'room unavailable' }),
    );
  });

  it('TC-B05 with zero sockets the rename is 200 and nothing is logged', async () => {
    const { browser, id } = await member();
    const logged = vi.spyOn(console, 'error');
    const res = await browser.rename(id, 'Nobody listening');
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(logged).not.toHaveBeenCalled();
    expect(await rowById(id)).toMatchObject({ name: 'Nobody listening', version: 2 });
  });

  it('TC-B06 renaming to the current name is 200, keeps the version and sends no frame', async () => {
    const { browser, id } = await member();
    await browser.rename(id, 'X');
    const client = await connectLive(browser, id);
    const res = await browser.rename(id, 'X');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspace: { name: 'X', version: 2 } });
    expect(await rowById(id)).toMatchObject({ name: 'X', version: 2 });
    expect(await framesAfter(client, 300)).toEqual([]);
    client.close();
  });
});
