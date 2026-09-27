import { LIVE_MAX_EVENT_BYTES } from '@todoodle/shared/limits';
import { LiveEvent } from '@todoodle/shared/events';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { WORKSPACE_NOT_FOUND_BODY } from '../../src/lib/errors';
import { CLIENT_HEADERS, ORIGIN } from '../helpers';
import { connectLive, type LiveClient, sleep, upgrade } from '../live-helpers';
import { cookieFor, createWorkspace, patch, randomHexId, rowById, seedDeletedWorkspace } from '../workspace-helpers';

const CLIENT_X = '6c1f7a52-3d4e-4f8a-9b0c-1d2e3f4a5b6c';
const nowS = () => Math.floor(Date.now() / 1000);

const open: LiveClient[] = [];
async function live(id: string, cookie: string) {
  const client = await connectLive(id, cookie);
  open.push(client);
  return client;
}
afterEach(() => {
  open.splice(0).forEach((c) => c.close());
  vi.restoreAllMocks();
});

function rename(id: string, name: string, cookie: string, clientId?: string) {
  return patch(`/api/w/${id}`, { name }, cookie, { ...CLIENT_HEADERS, ...(clientId ? { 'X-Todoodle-Client-Id': clientId } : {}) });
}

describe('GET /api/w/:id/live', () => {
  it('TC-L01 valid cookie, same origin, Upgrade -> 101', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await upgrade(workspace.id, { cookie });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });

  it('TC-L02 valid cookie, plain GET -> 426 upgrade_required', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await upgrade(workspace.id, { cookie, upgrade: false });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ error: 'upgrade_required' });
  });

  it('TC-L03 Origin evil.example -> 403 forbidden_client, no socket', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await upgrade(workspace.id, { cookie, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
  });

  it('TC-L04 no Origin -> 403', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await upgrade(workspace.id, { cookie, origin: null });
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeNull();
  });

  it('TC-L03 a hostile origin learns nothing about existence: same 403 for an unknown id', async () => {
    const res = await upgrade(randomHexId(), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('TC-L05 / TC-L06 / TC-L09 no cookie, cookie for V only, nonexistent id -> 404 with identical bodies', async () => {
    const w = await createWorkspace();
    const v = await createWorkspace();
    const noCookie = await upgrade(w.workspace.id);
    const otherCookie = await upgrade(w.workspace.id, { cookie: v.cookie });
    const missing = await upgrade(randomHexId(), { cookie: w.cookie });
    const bodies = [];
    for (const res of [noCookie, otherCookie, missing]) {
      expect(res.status).toBe(404);
      expect(res.webSocket).toBeNull();
      bodies.push(await res.text());
    }
    expect(bodies).toEqual([WORKSPACE_NOT_FOUND_BODY, WORKSPACE_NOT_FOUND_BODY, WORKSPACE_NOT_FOUND_BODY]);
  });

  it('TC-L07 tampered secret -> 404', async () => {
    const { workspace, secret } = await createWorkspace();
    const tampered = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    const res = await upgrade(workspace.id, { cookie: cookieFor([{ id: workspace.id, s: tampered, t: nowS() }]) });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it('TC-L08 soft-deleted workspace -> 404', async () => {
    const { workspace, secret } = await seedDeletedWorkspace();
    const res = await upgrade(workspace.id, { cookie: cookieFor([{ id: workspace.id, s: secret, t: nowS() }]) });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it('TC-L10 the 101 keeps its webSocket through finalizeResponse', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await upgrade(workspace.id, { cookie });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeInstanceOf(WebSocket);
    res.webSocket!.accept();
    res.webSocket!.close();
  });
});

describe('WorkspaceRoom fan-out', () => {
  it('TC-R03 10 sockets all receive a rename', async () => {
    const { workspace, cookie } = await createWorkspace();
    const clients = await Promise.all(Array.from({ length: 10 }, () => live(workspace.id, cookie)));
    expect((await rename(workspace.id, 'Team of ten', cookie)).status).toBe(200);
    const frames = await Promise.all(clients.map((c) => c.nextFrame(0)));
    for (const frame of frames) expect(JSON.parse(frame)).toMatchObject({ type: 'workspace.updated', version: 2 });
  });

  it('TC-R04 ping -> pong', async () => {
    const { workspace, cookie } = await createWorkspace();
    const client = await live(workspace.id, cookie);
    client.socket.send('ping');
    expect(await client.nextFrame(0)).toBe('pong');
  });

  it('TC-R05 socket A closed, rename -> the others receive, no error', async () => {
    const error = vi.spyOn(console, 'error');
    const { workspace, cookie } = await createWorkspace();
    const [a, b, c] = [await live(workspace.id, cookie), await live(workspace.id, cookie), await live(workspace.id, cookie)];
    a!.close();
    await sleep(50);
    expect((await rename(workspace.id, 'After A left', cookie)).status).toBe(200);
    for (const client of [b!, c!]) expect(JSON.parse(await client.nextFrame(0))).toMatchObject({ entity: { name: 'After A left' } });
    expect(error).not.toHaveBeenCalled();
  });

  it('TC-R06 a client JSON frame is not echoed to others', async () => {
    const { workspace, cookie } = await createWorkspace();
    const a = await live(workspace.id, cookie);
    const b = await live(workspace.id, cookie);
    a.socket.send(JSON.stringify({ type: 'workspace.updated', entity: { id: workspace.id, name: 'Forged' }, version: 99 }));
    await sleep(300);
    expect(b.frames).toEqual([]);
    expect(a.frames).toEqual([]);
  });
});

describe('broadcast on rename', () => {
  it('TC-B01 two sockets on W; rename with client id X -> both get workspace.updated with the new version and origin X', async () => {
    const { workspace, cookie } = await createWorkspace();
    const [a, b] = [await live(workspace.id, cookie), await live(workspace.id, cookie)];
    const before = await rowById(workspace.id);
    const res = await rename(workspace.id, 'Groceries 🛒', cookie, CLIENT_X);
    expect(res.status).toBe(200);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'Groceries 🛒', version: before!.version + 1 });
    for (const client of [a, b]) {
      const event = LiveEvent.parse(JSON.parse(await client.nextFrame(0)));
      expect(event).toEqual({
        type: 'workspace.updated',
        entity: { id: workspace.id, name: 'Groceries 🛒', version: 2, createdAt: workspace.createdAt },
        version: 2,
        originClientId: CLIENT_X,
      });
    }
  });

  it('a rename without a (valid) client id broadcasts originClientId null', async () => {
    const { workspace, cookie } = await createWorkspace();
    const a = await live(workspace.id, cookie);
    await rename(workspace.id, 'No id', cookie, 'not-a-uuid');
    expect(JSON.parse(await a.nextFrame(0))).toMatchObject({ originClientId: null });
  });

  it('TC-B02 sockets on W and V; rename W -> V receives nothing', async () => {
    const w = await createWorkspace();
    const v = await createWorkspace(w.cookie);
    const onW = await live(w.workspace.id, v.cookie);
    const onV = await live(v.workspace.id, v.cookie);
    await rename(w.workspace.id, 'Only W', v.cookie);
    await onW.nextFrame(0);
    await sleep(300);
    expect(onV.frames).toEqual([]);
  });

  it('TC-B03 rename with an empty name -> 400, no frame within 500 ms', async () => {
    const { workspace, cookie } = await createWorkspace();
    const a = await live(workspace.id, cookie);
    expect((await rename(workspace.id, '   ', cookie)).status).toBe(400);
    await sleep(500);
    expect(a.frames).toEqual([]);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'My Todoodle', version: 1 });
  });

  it('TC-B04 the DO call throws -> 200, D1 updated, error logged with the request id', async () => {
    const { workspace, cookie } = await createWorkspace();
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args));
    const throwing = {
      idFromName: (name: string) => env.WORKSPACE_ROOM.idFromName(name),
      get: () => ({
        broadcast: () => Promise.reject(new Error('room unavailable')),
      }),
    };
    const ctx = createExecutionContext();
    const req = new Request(`${ORIGIN}/api/w/${workspace.id}`, {
      method: 'PATCH',
      headers: { ...CLIENT_HEADERS, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Still saved' }),
    });
    const res = await app.fetch(req, { ...env, WORKSPACE_ROOM: throwing as unknown as typeof env.WORKSPACE_ROOM }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'Still saved', version: 2 });
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).toContain(requestId!);
    expect(JSON.stringify(logged[0])).toContain('room unavailable');
    // Nothing from the request (cookie, secret, body) is logged.
    expect(JSON.stringify(logged)).not.toContain(cookie.split('=')[1]!);
  });

  it('TC-B05 zero sockets, rename -> 200, no error', async () => {
    const error = vi.spyOn(console, 'error');
    const { workspace, cookie } = await createWorkspace();
    expect((await rename(workspace.id, 'Nobody listening', cookie)).status).toBe(200);
    await sleep(100);
    expect(error).not.toHaveBeenCalled();
  });

  it('TC-B06 name already X, rename to X -> 200, version unchanged, no frame', async () => {
    const { workspace, cookie } = await createWorkspace();
    await rename(workspace.id, 'Same', cookie);
    const a = await live(workspace.id, cookie);
    const res = await rename(workspace.id, 'Same', cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspace: { name: 'Same', version: 2 } });
    expect(await rowById(workspace.id)).toMatchObject({ name: 'Same', version: 2 });
    await sleep(500);
    expect(a.frames).toEqual([]);
  });

  it('events stay under LIVE_MAX_EVENT_BYTES for the longest name', async () => {
    const { workspace, cookie } = await createWorkspace();
    const a = await live(workspace.id, cookie);
    await rename(workspace.id, '🛒'.repeat(60), cookie);
    const frame = await a.nextFrame(0);
    expect(new TextEncoder().encode(frame).byteLength).toBeLessThan(LIVE_MAX_EVENT_BYTES);
  });
});
