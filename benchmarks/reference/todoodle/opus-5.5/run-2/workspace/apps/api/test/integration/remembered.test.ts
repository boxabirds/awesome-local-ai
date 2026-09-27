import { MAX_REMEMBERED_WORKSPACES, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { RememberedListResponse } from '@todoodle/shared/schemas';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { RememberedEntry } from '../../src/lib/cookie';
import { generateSecret } from '../../src/lib/crypto';
import { WORKSPACE_NOT_FOUND_BODY } from '../../src/lib/errors';
import { ORIGIN } from '../helpers';
import {
  cookieFor,
  cookieFrom,
  createWorkspace,
  del,
  entriesFrom,
  get,
  post,
  randomHexId,
  rowById,
  seedDeletedWorkspace,
  seedNamedWorkspace,
} from '../workspace-helpers';

const nowS = () => Math.floor(Date.now() / 1000);
const LONG_NAME = 'L'.repeat(WORKSPACE_NAME_MAX);
const NAMES = ['Groceries 🛒', 'Ünïcødé — Küche', LONG_NAME];

type Seeded = { id: string; name: string; secret: string };

async function seedNamed(names: string[]): Promise<Seeded[]> {
  const out: Seeded[] = [];
  for (const name of names) {
    const { workspace, secret } = await seedNamedWorkspace(name);
    out.push({ id: workspace.id, name, secret });
  }
  return out;
}

/** Entries most recent first, t one minute apart. */
function entriesOf(list: { id: string; secret: string }[], newest = nowS() - 60): RememberedEntry[] {
  return list.map((w, i) => ({ id: w.id, s: w.secret, t: newest - 60 * i }));
}

async function list(cookie?: string | null) {
  const res = await get('/api/remembered', cookie);
  const raw = await res.text();
  return { res, raw, body: RememberedListResponse.parse(JSON.parse(raw)) };
}

function attrs(res: Response): string[] {
  return (res.headers.get('set-cookie') ?? '')
    .split(';')
    .slice(1)
    .map((a) => a.trim());
}

describe('GET /api/remembered', () => {
  it('TC-20 no cookie -> 200 empty list, no Set-Cookie', async () => {
    const { res, body } = await list(null);
    expect(res.status).toBe(200);
    expect(body).toEqual({ workspaces: [] });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-21 three valid entries -> names, stored order, available, exactly four keys, no secrets', async () => {
    const seeded = await seedNamed(NAMES);
    const entries = entriesOf(seeded);
    const { res, raw, body } = await list(cookieFor(entries));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(body.workspaces).toEqual(
      seeded.map((w, i) => ({
        id: w.id,
        name: w.name,
        lastOpenedAt: new Date(entries[i]!.t * 1000).toISOString(),
        available: true,
      })),
    );
    for (const w of JSON.parse(raw).workspaces as object[]) {
      expect(Object.keys(w).sort()).toEqual(['available', 'id', 'lastOpenedAt', 'name']);
    }
    for (const w of seeded) expect(raw).not.toContain(w.secret);
    for (const w of seeded) expect(raw).not.toContain((await rowById(w.id))!.secret_hash);
  });

  it('TC-22 hash mismatch -> available false, name null', async () => {
    const [ws] = await seedNamed(['Mine']);
    const { body, raw } = await list(cookieFor([{ id: ws!.id, s: generateSecret(), t: nowS() }]));
    expect(body.workspaces).toEqual([expect.objectContaining({ id: ws!.id, name: null, available: false })]);
    expect(raw).not.toContain('Mine');
  });

  it('TC-23 soft-deleted workspace -> available false, name null', async () => {
    const { workspace, secret } = await seedDeletedWorkspace();
    const { body } = await list(cookieFor([{ id: workspace.id, s: secret, t: nowS() }]));
    expect(body.workspaces).toEqual([expect.objectContaining({ id: workspace.id, name: null, available: false })]);
  });

  it('TC-24 unknown id -> available false, name null; same shape as a mismatch', async () => {
    const [ws] = await seedNamed(['Mine']);
    const t = nowS();
    const unknown = randomHexId();
    const unknownBody = (await list(cookieFor([{ id: unknown, s: generateSecret(), t }]))).body;
    const mismatchBody = (await list(cookieFor([{ id: ws!.id, s: generateSecret(), t }]))).body;
    expect(unknownBody.workspaces).toEqual([{ id: unknown, name: null, lastOpenedAt: new Date(t * 1000).toISOString(), available: false }]);
    expect({ ...unknownBody.workspaces[0], id: 'x' }).toEqual({ ...mismatchBody.workspaces[0], id: 'x' });
  });

  const toBase64url = (text: string) => btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

  it.each([
    ['bad base64', 'tdl_ws=%%%not-base64%%%'],
    ['bad JSON', `tdl_ws=${toBase64url('[{"id":"abc",')}`],
    ['schema failure', `tdl_ws=${toBase64url(JSON.stringify({ id: 'x' }))}`],
  ])('TC-25 malformed cookie (%s) -> 200 [], Set-Cookie clears tdl_ws', async (_label, cookie) => {
    const { res, body } = await list(cookie);
    expect(res.status).toBe(200);
    expect(body).toEqual({ workspaces: [] });
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie.startsWith('tdl_ws=;')).toBe(true);
    expect(attrs(res)).toEqual(expect.arrayContaining(['Max-Age=0', 'Path=/api', 'HttpOnly', 'SameSite=Lax']));
  });

  it('TC-26 50 valid entries -> all 50 in order', async () => {
    let cookie: string | null = null;
    const ids: string[] = [];
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES; i++) {
      const ws = await createWorkspace(cookie);
      cookie = ws.cookie;
      ids.unshift(ws.workspace.id);
    }
    const { body } = await list(cookie);
    expect(body.workspaces.map((w) => w.id)).toEqual(ids);
    expect(body.workspaces.every((w) => w.available && w.name === 'My Todoodle')).toBe(true);
  });
});

describe('DELETE /api/remembered/:id', () => {
  it('TC-27 id present -> 204, Set-Cookie without it, GET excludes it, D1 row unchanged', async () => {
    const seeded = await seedNamed(['A', 'B', 'C']);
    const cookie = cookieFor(entriesOf(seeded));
    const before = await rowById(seeded[1]!.id);
    const res = await del(`/api/remembered/${seeded[1]!.id}`, cookie);
    expect(res.status).toBe(204);
    expect(entriesFrom(res).map((e) => e.id)).toEqual([seeded[0]!.id, seeded[2]!.id]);
    expect(attrs(res)).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/api']));
    const { body } = await list(cookieFrom(res));
    expect(body.workspaces.map((w) => w.id)).toEqual([seeded[0]!.id, seeded[2]!.id]);
    const after = await rowById(seeded[1]!.id);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ name: 'B', version: 1, deleted: 0 });
  });

  it('TC-28 id absent -> 204, no Set-Cookie', async () => {
    const seeded = await seedNamed(['A', 'B', 'C']);
    const res = await del(`/api/remembered/${randomHexId()}`, cookieFor(entriesOf(seeded)));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-29 missing X-Todoodle-Client -> 403 forbidden_client, no Set-Cookie', async () => {
    const seeded = await seedNamed(['A', 'B', 'C']);
    const res = await del(`/api/remembered/${seeded[0]!.id}`, cookieFor(entriesOf(seeded)), {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_client');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-30 the last entry -> 204, Set-Cookie holds an empty list, GET returns []', async () => {
    const seeded = await seedNamed(['Only']);
    const res = await del(`/api/remembered/${seeded[0]!.id}`, cookieFor(entriesOf(seeded)));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).not.toBeNull();
    expect(entriesFrom(res)).toEqual([]);
    expect((await list(cookieFrom(res))).body).toEqual({ workspaces: [] });
  });

  it('TC-36 forgetting in cookie X leaves A available in cookie Y', async () => {
    const [a, b] = await seedNamed(['A', 'B']);
    const x = cookieFor(entriesOf([a!, b!]));
    const y = cookieFor(entriesOf([b!, a!]));
    const res = await del(`/api/remembered/${a!.id}`, x);
    expect(res.status).toBe(204);
    expect((await list(cookieFrom(res))).body.workspaces.map((w) => w.id)).toEqual([b!.id]);
    const other = (await list(y)).body.workspaces;
    expect(other.find((w) => w.id === a!.id)).toMatchObject({ available: true, name: 'A' });
  });
});

describe('POST /api/remembered/:id/touch', () => {
  it('TC-31 [B, A] touch A -> 204, cookie [A, B], A.t newer', async () => {
    const [a, b] = await seedNamed(['A', 'B']);
    const old = nowS() - 3600;
    const cookie = cookieFor([
      { id: b!.id, s: b!.secret, t: old + 60 },
      { id: a!.id, s: a!.secret, t: old },
    ]);
    const res = await post(`/api/remembered/${a!.id}/touch`, { cookie });
    expect(res.status).toBe(204);
    const entries = entriesFrom(res);
    expect(entries.map((e) => e.id)).toEqual([a!.id, b!.id]);
    expect(entries[0]!.s).toBe(a!.secret);
    expect(entries[0]!.t).toBeGreaterThan(old);
    expect(entries[1]!.t).toBe(old + 60);
  });

  it('TC-32 id absent -> 404 not_found, no Set-Cookie, nothing added', async () => {
    const [a, b] = await seedNamed(['A', 'B']);
    const res = await post(`/api/remembered/${a!.id}/touch`, { cookie: cookieFor(entriesOf([b!])) });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-33 hash mismatch -> 404 not_found, cookie unchanged', async () => {
    const [a] = await seedNamed(['A']);
    const res = await post(`/api/remembered/${a!.id}/touch`, {
      cookie: cookieFor([{ id: a!.id, s: generateSecret(), t: nowS() - 60 }]),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-33 soft-deleted workspace -> 404, cookie unchanged', async () => {
    const { workspace, secret } = await seedDeletedWorkspace();
    const res = await post(`/api/remembered/${workspace.id}/touch`, {
      cookie: cookieFor([{ id: workspace.id, s: secret, t: nowS() - 60 }]),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-34 missing X-Todoodle-Client -> 403 forbidden_client', async () => {
    const [a] = await seedNamed(['A']);
    const res = await SELF.fetch(`${ORIGIN}/api/remembered/${a!.id}/touch`, {
      method: 'POST',
      headers: { Cookie: cookieFor(entriesOf([a!])) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden_client');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('cap and cookie size', () => {
  async function fiftyEntries(): Promise<{ cookie: string; oldest: string }> {
    let cookie: string | null = null;
    let oldest = '';
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES; i++) {
      const ws = await createWorkspace(cookie);
      if (i === 0) oldest = ws.workspace.id;
      cookie = ws.cookie;
    }
    return { cookie: cookie!, oldest };
  }

  it('TC-35 open at the cap -> 200 dropped 1; cookie has 50, the oldest gone', async () => {
    const { cookie, oldest } = await fiftyEntries();
    const [fresh] = await seedNamed(['Fresh']);
    const res = await post('/api/workspaces/open', { body: { secret: fresh!.secret }, cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dropped: number }).dropped).toBe(1);
    const entries = entriesFrom(res);
    expect(entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(entries[0]!.id).toBe(fresh!.id);
    expect(entries.some((e) => e.id === oldest)).toBe(false);
  });

  it('TC-37 every Set-Cookie path at 50 entries: under 4096 bytes, HttpOnly, SameSite=Lax, Path=/api', async () => {
    const { cookie } = await fiftyEntries();
    const ids = readIds(cookie);
    const [fresh] = await seedNamed(['Fresh']);
    const responses = [
      await post('/api/workspaces', { cookie }),
      await post('/api/workspaces/open', { body: { secret: fresh!.secret }, cookie }),
      await post(`/api/remembered/${ids[10]}/touch`, { cookie }),
      await del(`/api/remembered/${ids[20]}`, cookie),
      await get('/api/remembered', 'tdl_ws=%%%'),
    ];
    for (const res of responses) {
      expect(res.status).toBeLessThan(300);
      const setCookie = res.headers.get('set-cookie')!;
      expect(new TextEncoder().encode(setCookie).byteLength).toBeLessThan(4096);
      expect(attrs(res)).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/api']));
    }
  });
});

function readIds(cookie: string): string[] {
  const res = new Response(null, { headers: { 'set-cookie': cookie } });
  return entriesFrom(res).map((e) => e.id);
}
