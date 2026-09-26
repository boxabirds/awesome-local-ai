import { SELF } from 'cloudflare:test';
import { MAX_REMEMBERED_WORKSPACES, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { RememberedListResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { type RememberedEntry, encodeRemembered, readRemembered } from '../../src/lib/cookie.ts';
import { generateSecret } from '../../src/lib/crypto.ts';
import { CLIENT, url } from '../support/http.ts';
import { Browser, JSON_CLIENT, type Workspace, cookieFor, randomId, rowById, seedWorkspace } from '../support/workspaces.ts';

type Listed = { id: string; name: string | null; lastOpenedAt: string; available: boolean };

const NOW_S = () => Math.floor(Date.now() / 1000);
const LONG_NAME = 'ü'.repeat(WORKSPACE_NAME_MAX);

function base64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function list(browser: Browser): Promise<{ res: Response; raw: string; workspaces: Listed[] }> {
  const res = await browser.fetch('/api/remembered');
  const raw = await res.text();
  const workspaces = res.status === 200 ? RememberedListResponse.parse(JSON.parse(raw)).workspaces : [];
  return { res, raw, workspaces };
}

function forget(browser: Browser, id: string, headers: Record<string, string> = CLIENT): Promise<Response> {
  return browser.fetch(`/api/remembered/${id}`, { method: 'DELETE', headers });
}

function touch(browser: Browser, id: string, headers: Record<string, string> = CLIENT): Promise<Response> {
  return browser.fetch(`/api/remembered/${id}/touch`, { method: 'POST', headers });
}

/** A browser that created three workspaces with distinct names (unicode, emoji, max length). Newest first. */
async function browserWithThree() {
  const browser = new Browser();
  const created = [];
  const names = ['Groceries 🛒', LONG_NAME, 'Café Work'];
  for (const name of names) {
    const c = await browser.create();
    expect((await browser.rename(c.workspace.id, name)).status).toBe(200);
    created.push({ ...c, workspace: { ...c.workspace, name } });
  }
  return { browser, created: created.reverse() };
}

/** Seeds `count` remembered workspaces into a fresh browser through the test route. */
async function browserWithSeeded(count: number) {
  const browser = new Browser();
  const res = await browser.fetch('/test/remembered-seed', { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify({ count }) });
  expect(res.status).toBe(201);
  const { workspaces } = (await res.json()) as { workspaces: Workspace[] };
  return { browser, workspaces, setCookie: res.headers.get('Set-Cookie') };
}

function expectCookieAttributes(setCookie: string | null) {
  expect(setCookie).not.toBeNull();
  const parts = setCookie!.split('; ');
  expect(parts).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/api']));
  expect(new TextEncoder().encode(setCookie!).byteLength).toBeLessThan(4096);
}

describe('remembered.list_api', () => {
  it('TC-20 no cookie -> 200 {workspaces: []}, no Set-Cookie', async () => {
    const { res, workspaces } = await list(new Browser());
    expect(res.status).toBe(200);
    expect(workspaces).toEqual([]);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('TC-21 three valid entries -> names, stored order, available, exact keys; no secret in the body', async () => {
    const { browser, created } = await browserWithThree();
    const { res, raw, workspaces } = await list(browser);
    expect(res.status).toBe(200);
    expect(workspaces.map((w) => w.id)).toEqual(created.map((c) => c.workspace.id));
    expect(workspaces.map((w) => w.name)).toEqual(created.map((c) => c.workspace.name));
    for (const w of workspaces) {
      expect(Object.keys(w).sort()).toEqual(['available', 'id', 'lastOpenedAt', 'name']);
      expect(w.available).toBe(true);
      expect(new Date(w.lastOpenedAt).toISOString()).toBe(w.lastOpenedAt);
    }
    for (const c of created) expect(raw).not.toContain(c.secret);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('TC-22 hash mismatch -> available false, name null', async () => {
    const seeded = await seedWorkspace({ name: 'Secret plans' });
    const browser = new Browser(cookieFor([{ id: seeded.workspace.id, s: generateSecret(), t: NOW_S() }]));
    const { raw, workspaces } = await list(browser);
    expect(workspaces).toEqual([{ id: seeded.workspace.id, name: null, lastOpenedAt: expect.any(String), available: false }]);
    expect(raw).not.toContain('Secret plans');
  });

  it('TC-23 soft-deleted workspace -> available false, name null', async () => {
    const seeded = await seedWorkspace({ name: 'Old', deleted: true });
    const browser = new Browser(cookieFor([{ id: seeded.workspace.id, s: seeded.secret, t: NOW_S() }]));
    const { raw, workspaces } = await list(browser);
    expect(workspaces).toEqual([{ id: seeded.workspace.id, name: null, lastOpenedAt: expect.any(String), available: false }]);
    expect(raw).not.toContain(seeded.secret);
  });

  it('TC-24 unknown id -> available false, name null; indistinguishable from a hash mismatch', async () => {
    const t = NOW_S();
    const seeded = await seedWorkspace();
    const mismatchId = seeded.workspace.id;
    const unknownId = randomId();
    const mismatch = await list(new Browser(cookieFor([{ id: mismatchId, s: generateSecret(), t }])));
    const unknown = await list(new Browser(cookieFor([{ id: unknownId, s: generateSecret(), t }])));
    expect(unknown.workspaces).toEqual([{ id: unknownId, name: null, lastOpenedAt: expect.any(String), available: false }]);
    expect(unknown.raw.replace(unknownId, 'ID')).toBe(mismatch.raw.replace(mismatchId, 'ID'));
  });

  it.each([
    ['bad base64', '%%%not-base64%%%'],
    ['bad JSON', base64url('{not json')],
    ['schema failure', base64url(JSON.stringify([{ id: 'x', s: 'y', t: 'z' }]))],
  ])('TC-25 malformed cookie (%s) -> 200 [], Set-Cookie clears tdl_ws', async (_label, value) => {
    const { res, workspaces } = await list(new Browser(`tdl_ws=${value}`));
    expect(res.status).toBe(200);
    expect(workspaces).toEqual([]);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie.startsWith('tdl_ws=;')).toBe(true);
    expect(setCookie.split('; ')).toEqual(expect.arrayContaining(['Max-Age=0', 'Path=/api', 'HttpOnly']));
  });

  it('TC-26 fifty valid entries -> all fifty returned in order', async () => {
    const { browser, workspaces: seeded } = await browserWithSeeded(MAX_REMEMBERED_WORKSPACES);
    const { workspaces } = await list(browser);
    expect(workspaces).toHaveLength(50);
    expect(workspaces.map((w) => w.id)).toEqual(seeded.map((w) => w.id));
    expect(workspaces.map((w) => w.name)).toEqual(seeded.map((_, i) => `Seeded ${i + 1}`));
    expect(workspaces.every((w) => w.available)).toBe(true);
  });
});

describe('remembered.forget_api', () => {
  it('TC-27 DELETE a remembered id -> 204 + Set-Cookie without it; GET excludes it; D1 row unchanged', async () => {
    const { browser, created } = await browserWithThree();
    const target = created[1]!.workspace.id;
    const rowBefore = await rowById(target);
    const res = await forget(browser, target);
    expect(res.status).toBe(204);
    expectCookieAttributes(res.headers.get('Set-Cookie'));
    expect(browser.entries().map((e) => e.id)).toEqual([created[0]!.workspace.id, created[2]!.workspace.id]);
    const { workspaces } = await list(browser);
    expect(workspaces.map((w) => w.id)).not.toContain(target);
    const rowAfter = await rowById(target);
    expect(rowAfter).toEqual(rowBefore);
    expect(rowAfter).toMatchObject({ name: LONG_NAME, deleted: 0 });
  });

  it('TC-28 DELETE an id that is not remembered -> 204, no Set-Cookie', async () => {
    const { browser } = await browserWithThree();
    const before = browser.cookie;
    const res = await forget(browser, randomId());
    expect(res.status).toBe(204);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(browser.cookie).toBe(before);
  });

  it('TC-29 DELETE without X-Todoodle-Client -> 403 forbidden_client, no Set-Cookie', async () => {
    const { browser, created } = await browserWithThree();
    const res = await forget(browser, created[0]!.workspace.id, {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_client');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(browser.entries()).toHaveLength(3);
  });

  it('TC-30 forgetting the last entry -> Set-Cookie holds an empty list; GET returns []', async () => {
    const browser = new Browser();
    const created = await browser.create();
    const res = await forget(browser, created.workspace.id);
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie.split(';')[0]).toBe(`tdl_ws=${encodeRemembered([])}`);
    expect(readRemembered(setCookie.split(';')[0]!)).toEqual([]);
    expect((await list(browser)).workspaces).toEqual([]);
  });

  it('TC-36 forgetting in one browser leaves the workspace remembered and available in another', async () => {
    const seeded = await seedWorkspace({ name: 'Shared list' });
    const a: RememberedEntry = { id: seeded.workspace.id, s: seeded.secret, t: NOW_S() };
    const x = new Browser(cookieFor([a]));
    const y = new Browser(cookieFor([a]));
    expect((await forget(x, a.id)).status).toBe(204);
    expect((await list(x)).workspaces).toEqual([]);
    expect((await list(y)).workspaces).toEqual([{ id: a.id, name: 'Shared list', lastOpenedAt: expect.any(String), available: true }]);
    expect((await y.get(a.id)).status).toBe(200);
  });
});

describe('remembered.touch', () => {
  it('TC-31 touch A in [B, A] -> 204; cookie order [A, B]; A.t refreshed', async () => {
    const a = await seedWorkspace({ name: 'A' });
    const b = await seedWorkspace({ name: 'B' });
    const old = NOW_S() - 1000;
    const browser = new Browser(
      cookieFor([
        { id: b.workspace.id, s: b.secret, t: old + 10 },
        { id: a.workspace.id, s: a.secret, t: old },
      ]),
    );
    const res = await touch(browser, a.workspace.id);
    expect(res.status).toBe(204);
    expectCookieAttributes(res.headers.get('Set-Cookie'));
    const entries = browser.entries();
    expect(entries.map((e) => e.id)).toEqual([a.workspace.id, b.workspace.id]);
    expect(entries[0]!.t).toBeGreaterThan(old);
    expect(entries[0]!.s).toBe(a.secret);
    expect(entries[1]!.t).toBe(old + 10);
  });

  it('TC-32 touch an id not in the cookie -> 404 not_found, no Set-Cookie, nothing added', async () => {
    const b = await seedWorkspace();
    const other = await seedWorkspace();
    const browser = new Browser(cookieFor([{ id: b.workspace.id, s: b.secret, t: NOW_S() }]));
    const res = await touch(browser, other.workspace.id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('not_found');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(browser.entries().map((e) => e.id)).toEqual([b.workspace.id]);
  });

  it('TC-33 touch with a mismatched secret -> 404, cookie unchanged', async () => {
    const a = await seedWorkspace();
    const cookie = cookieFor([{ id: a.workspace.id, s: generateSecret(), t: NOW_S() - 50 }]);
    const browser = new Browser(cookie);
    const res = await touch(browser, a.workspace.id);
    expect(res.status).toBe(404);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(browser.cookie).toBe(cookie);
  });

  it('TC-34 touch without X-Todoodle-Client -> 403 forbidden_client', async () => {
    const browser = new Browser();
    const created = await browser.create();
    const res = await touch(browser, created.workspace.id, {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_client');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('remembered.cap_notice', () => {
  it('TC-35 open at the cap -> 200 dropped 1; cookie keeps 50 and loses the oldest', async () => {
    const { browser, workspaces: seeded } = await browserWithSeeded(MAX_REMEMBERED_WORKSPACES);
    const fresh = await seedWorkspace({ name: 'Fresh' });
    const res = await browser.open(fresh.secret);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dropped: number }).dropped).toBe(1);
    const ids = browser.entries().map((e) => e.id);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe(fresh.workspace.id);
    expect(ids).not.toContain(seeded[49]!.id);
    expect(ids.slice(1)).toEqual(seeded.slice(0, 49).map((w) => w.id));
  });
});

describe('remembered.cookie_attributes', () => {
  it('TC-37 every Set-Cookie path at 50 entries stays under 4096 bytes with HttpOnly, SameSite=Lax, Path=/api', async () => {
    const { browser, workspaces: seeded, setCookie } = await browserWithSeeded(MAX_REMEMBERED_WORKSPACES);
    expectCookieAttributes(setCookie);

    const touched = await touch(browser, seeded[10]!.id);
    expect(touched.status).toBe(204);
    expectCookieAttributes(touched.headers.get('Set-Cookie'));

    const created = await browser.fetch('/api/workspaces', { method: 'POST', headers: CLIENT });
    expect(created.status).toBe(201);
    expectCookieAttributes(created.headers.get('Set-Cookie'));

    const fresh = await seedWorkspace();
    const opened = await browser.open(fresh.secret);
    expect(opened.status).toBe(200);
    expectCookieAttributes(opened.headers.get('Set-Cookie'));
    expect(browser.entries()).toHaveLength(50);

    const forgotten = await forget(browser, fresh.workspace.id);
    expect(forgotten.status).toBe(204);
    expectCookieAttributes(forgotten.headers.get('Set-Cookie'));

    const malformed = await SELF.fetch(url('/api/remembered'), { headers: { Cookie: 'tdl_ws=%%%' } });
    expectCookieAttributes(malformed.headers.get('Set-Cookie'));
  });
});
