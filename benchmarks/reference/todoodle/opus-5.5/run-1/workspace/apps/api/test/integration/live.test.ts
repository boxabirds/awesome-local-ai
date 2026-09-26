import { describe, expect, it } from 'vitest';
import { LiveEvent } from '@todoodle/shared/events';
import { connectLive, framesAfter, requestLive } from '../support/live.ts';
import { Browser, cookieFor, randomId, seedWorkspace } from '../support/workspaces.ts';

const NOT_FOUND_TEXT = JSON.stringify({ error: 'not_found', message: 'Workspace not found' });

async function member() {
  const browser = new Browser();
  const { workspace, secret } = await browser.create();
  return { browser, id: workspace.id, secret };
}

describe('live.room: GET /api/w/:id/live', () => {
  it('TC-L01 valid cookie, same origin, Upgrade -> 101 with a socket', async () => {
    const { browser, id } = await member();
    const res = await requestLive(id, browser.cookie);
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket?.accept();
    res.webSocket?.close(1000);
  });

  it('TC-L02 a plain GET (no Upgrade) is 426 upgrade_required', async () => {
    const { browser, id } = await member();
    const res = await requestLive(id, browser.cookie, { upgrade: false });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ error: 'upgrade_required' });
    expect(res.webSocket).toBeFalsy();
  });

  it('TC-L03 Origin evil.example is 403 forbidden_client with no socket', async () => {
    const { browser, id } = await member();
    const res = await requestLive(id, browser.cookie, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(res.webSocket).toBeFalsy();
  });

  it('TC-L04 no Origin header is 403', async () => {
    const { browser, id } = await member();
    const res = await requestLive(id, browser.cookie, { origin: null });
    expect(res.status).toBe(403);
    expect(res.webSocket).toBeFalsy();
  });

  it('the Origin check runs before auth: a hostile origin gets 403 for existing and missing workspaces alike', async () => {
    const { browser, id } = await member();
    const existing = await requestLive(id, browser.cookie, { origin: 'https://evil.example' });
    const missing = await requestLive(randomId(), undefined, { origin: 'https://evil.example' });
    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await existing.text()).toBe(await missing.text());
  });

  it('TC-L05 no cookie is 404 with the same body as TC-L06 and TC-L09', async () => {
    const { id } = await member();
    const noCookie = await requestLive(id, undefined);
    expect(noCookie.status).toBe(404);
    const noCookieBody = await noCookie.text();
    expect(noCookieBody).toBe(NOT_FOUND_TEXT);

    // TC-L06: cookie for V only
    const v = await member();
    const otherOnly = await requestLive(id, v.browser.cookie);
    expect(otherOnly.status).toBe(404);
    expect(await otherOnly.text()).toBe(noCookieBody);

    // TC-L09: nonexistent id, with a valid cookie for something else
    const nonexistent = await requestLive(randomId(), v.browser.cookie);
    expect(nonexistent.status).toBe(404);
    expect(await nonexistent.text()).toBe(noCookieBody);
    for (const res of [noCookie, otherOnly, nonexistent]) expect(res.webSocket).toBeFalsy();
  });

  it('TC-L07 a tampered secret is 404', async () => {
    const { id } = await member();
    const other = await member();
    const res = await requestLive(id, cookieFor([{ id, s: other.secret, t: 1 }]));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-L08 a soft-deleted workspace is 404', async () => {
    const { workspace, secret } = await seedWorkspace({ deleted: true });
    const res = await requestLive(workspace.id, cookieFor([{ id: workspace.id, s: secret, t: 1 }]));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-L10 the 101 keeps its webSocket: finalizeResponse passes it through untouched', async () => {
    const { browser, id } = await member();
    const res = await requestLive(id, browser.cookie);
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeInstanceOf(WebSocket);
    // Untouched: the security-header rebuild (which would drop webSocket) did not run.
    expect(res.headers.get('X-Request-Id')).toBeNull();
    const socket = res.webSocket!;
    socket.accept();
    socket.close(1000);
  });

  it('TC-R03 all 10 sockets in the room receive a rename', async () => {
    const { browser, id } = await member();
    const clients = await Promise.all(Array.from({ length: 10 }, () => connectLive(browser, id)));
    expect((await browser.rename(id, 'Trip to Lisbon ✈️')).status).toBe(200);
    for (const client of clients) {
      const [frame] = await client.waitForFrames(1);
      expect(LiveEvent.parse(JSON.parse(frame!))).toMatchObject({ type: 'workspace.updated', version: 2 });
      client.close();
    }
  });

  it('TC-R04 ping is answered with pong', async () => {
    const { browser, id } = await member();
    const client = await connectLive(browser, id);
    client.socket.send('ping');
    expect(await client.waitForFrames(1)).toEqual(['pong']);
    client.close();
  });

  it('TC-R05 after one socket closes, the others still receive and the rename succeeds', async () => {
    const { browser, id } = await member();
    const [a, b, c] = await Promise.all([connectLive(browser, id), connectLive(browser, id), connectLive(browser, id)]);
    a!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await browser.rename(id, 'Chores')).status).toBe(200);
    await b!.waitForFrames(1);
    await c!.waitForFrames(1);
    expect(a!.frames).toEqual([]);
    b!.close();
    c!.close();
  });

  it('TC-R06 a JSON frame from a client is not echoed to anyone', async () => {
    const { browser, id } = await member();
    const [a, b] = await Promise.all([connectLive(browser, id), connectLive(browser, id)]);
    const fake = { type: 'workspace.updated', entity: { id, name: 'Injected', version: 99, createdAt: '' }, version: 99, originClientId: null };
    a!.socket.send(JSON.stringify(fake));
    expect(await framesAfter(b!, 300)).toEqual([]);
    expect(a!.frames).toEqual([]);
    a!.close();
    b!.close();
  });

});
