import { env } from 'cloudflare:test';
import { MAX_REMEMBERED_WORKSPACES, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSecret, hashSecret } from '../../src/lib/crypto';
import { WORKSPACE_NOT_FOUND_BODY } from '../../src/lib/errors';
import { BASELINE_HEADERS, ORIGIN, UUID } from '../helpers';
import {
  cookieFor,
  cookieFrom,
  countWorkspaces,
  createWorkspace,
  entriesFrom,
  get,
  patch,
  post,
  randomHexId,
  rowById,
  seedDeletedWorkspace,
} from '../workspace-helpers';

const HEX32 = /^[0-9a-f]{32}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace storage', () => {
  it('TC-14 migrations create every column and a UNIQUE secret_hash', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(workspaces)').all<{ name: string; notnull: number; pk: number }>();
    expect(results.map((c) => c.name).sort()).toEqual(
      ['created_at', 'deleted', 'deleted_at', 'id', 'name', 'secret_hash', 'updated_at', 'version'].sort(),
    );
    expect(results.find((c) => c.name === 'id')?.pk).toBe(1);

    const insert = env.DB.prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?)');
    await insert.bind('a'.repeat(64), 'One').run();
    await expect(insert.bind('a'.repeat(64), 'Two').run()).rejects.toThrow(/UNIQUE/);
    const row = await env.DB.prepare('SELECT * FROM workspaces').first<Record<string, unknown>>();
    expect(row).toMatchObject({ name: 'One', version: 1, deleted: 0, deleted_at: null });
    expect(row?.id).toMatch(HEX32);
  });
});

describe('POST /api/workspaces', () => {
  it('TC-15 creates one row, returns the public workspace and secret; only the hash is stored', async () => {
    expect(await countWorkspaces()).toBe(0);
    const res = await post('/api/workspaces');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { workspace: Record<string, unknown>; secret: string; dropped: number };
    expect(await countWorkspaces()).toBe(1);
    expect(Object.keys(body.workspace).sort()).toEqual(['createdAt', 'id', 'name', 'version']);
    expect(body.workspace).toMatchObject({ name: 'My Todoodle', version: 1 });
    expect(body.workspace.id).toMatch(HEX32);
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.dropped).toBe(0);

    const row = await rowById(body.workspace.id as string);
    expect(row?.secret_hash).toBe(await hashSecret(body.secret));
    for (const value of Object.values(row ?? {})) expect(String(value)).not.toContain(body.secret);
  });

  it('TC-16 Set-Cookie tdl_ws holds exactly the new entry', async () => {
    const res = await post('/api/workspaces');
    const body = (await res.json()) as { workspace: { id: string }; secret: string };
    const entries = entriesFrom(res);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: body.workspace.id, s: body.secret });
    expect(Math.abs(entries[0]!.t - Date.now() / 1000)).toBeLessThan(60);
  });

  it('TC-17 at the cap: 50 entries, the new one first, the oldest gone, dropped = 1', async () => {
    let cookie: string | null = null;
    const created: string[] = [];
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES; i++) {
      const ws = await createWorkspace(cookie);
      expect(ws.dropped).toBe(0);
      cookie = ws.cookie;
      created.push(ws.workspace.id);
    }
    const res = await post('/api/workspaces', { cookie });
    const body = (await res.json()) as { workspace: { id: string }; dropped: number };
    const entries = entriesFrom(res);
    expect(entries).toHaveLength(MAX_REMEMBERED_WORKSPACES);
    expect(entries[0]!.id).toBe(body.workspace.id);
    expect(entries.map((e) => e.id)).not.toContain(created[0]);
    expect(entries.map((e) => e.id).slice(1)).toEqual(created.slice(1).reverse());
    expect(body.dropped).toBe(1);
  });

  it('TC-18 missing client header -> 403 forbidden_client, no row', async () => {
    const res = await post('/api/workspaces', { headers: { 'X-Todoodle-Client': '' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(await countWorkspaces()).toBe(0);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-19 a text/plain body is rejected (415, story 1 rule), no row', async () => {
    const res = await post('/api/workspaces', { body: '{}', headers: { 'Content-Type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' });
    expect(await countWorkspaces()).toBe(0);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-62 a bodyless create with only the client header -> 201', async () => {
    const res = await post('/api/workspaces');
    expect(res.status).toBe(201);
    expect(await countWorkspaces()).toBe(1);
    const withJson = await post('/api/workspaces', { body: {} });
    expect(withJson.status).toBe(201);
    expect(await countWorkspaces()).toBe(2);
  });
});

describe('POST /api/workspaces/open', () => {
  it('TC-20 a valid secret -> 200 workspace, cookie 0 -> 1 entry', async () => {
    const { workspace, secret } = await createWorkspace();
    const res = await post('/api/workspaces/open', { body: { secret } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace, dropped: 0 });
    expect(entriesFrom(res)).toMatchObject([{ id: workspace.id, s: secret }]);
  });

  it('TC-21 opening an entry that is not first moves it to the front and updates t (idempotent)', async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    const cookie = cookieFor([
      { id: b.workspace.id, s: b.secret, t: 2000 },
      { id: a.workspace.id, s: a.secret, t: 1000 },
    ]);
    const res = await post('/api/workspaces/open', { body: { secret: a.secret }, cookie });
    expect(res.status).toBe(200);
    const entries = entriesFrom(res);
    expect(entries.map((e) => e.id)).toEqual([a.workspace.id, b.workspace.id]);
    expect(entries[0]!.t).toBeGreaterThan(1000);
    expect(entries[1]!.t).toBe(2000);

    const again = await post('/api/workspaces/open', { body: { secret: a.secret }, cookie: cookieFrom(res) });
    expect(((await again.json()) as { workspace: unknown }).workspace).toEqual(a.workspace);
    expect(entriesFrom(again).map((e) => e.id)).toEqual([a.workspace.id, b.workspace.id]);
  });

  it('TC-22 an unknown well-formed secret -> 404 not_found, no Set-Cookie', async () => {
    await createWorkspace();
    const res = await post('/api/workspaces/open', { body: { secret: generateSecret() } });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(JSON.parse(WORKSPACE_NOT_FOUND_BODY)).toEqual({ error: 'not_found', message: 'Workspace not found' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['42 chars', 'a'.repeat(42)],
    ['44 chars', 'a'.repeat(44)],
    ['bad characters', `${'a'.repeat(42)}+`],
    ['empty', ''],
  ])('TC-23 a malformed secret (%s) -> the byte-identical 404, no Set-Cookie', async (_label, secret) => {
    const unknown = await (await post('/api/workspaces/open', { body: { secret: generateSecret() } })).text();
    const res = await post('/api/workspaces/open', { body: { secret } });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(unknown);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['missing secret', {}],
    ['secret not a string', { secret: 42 }],
    ['invalid JSON', '{"secret":'],
  ])('TC-24 %s -> 400 validation, no Set-Cookie', async (_label, body) => {
    const res = await post('/api/workspaces/open', { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-25 a deleted workspace -> the byte-identical 404', async () => {
    const { secret } = await seedDeletedWorkspace();
    const res = await post('/api/workspaces/open', { body: { secret } });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['garbage', 'tdl_ws=%%%garbage'],
    ['base64url of JSON', `tdl_ws=${btoa('[{"id":1}]').replace(/=+$/, '')}`],
  ])('TC-26 a malformed cookie (%s) is discarded and rebuilt with one entry', async (_label, cookie) => {
    const { workspace, secret } = await createWorkspace();
    const res = await post('/api/workspaces/open', { body: { secret }, cookie });
    expect(res.status).toBe(200);
    expect(entriesFrom(res)).toMatchObject([{ id: workspace.id, s: secret }]);
  });
});

describe('workspace-auth and GET /api/w/:id', () => {
  it('TC-27 a valid cookie entry -> 200 public workspace', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await get(`/api/w/${workspace.id}`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace: Record<string, unknown> };
    expect(body).toEqual({ workspace });
    expect(Object.keys(body.workspace).sort()).toEqual(['createdAt', 'id', 'name', 'version']);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('TC-28 no cookie -> 404 not_found', async () => {
    const { workspace } = await createWorkspace();
    const res = await get(`/api/w/${workspace.id}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it('TC-29 a tampered secret in the entry -> 404', async () => {
    const { workspace } = await createWorkspace();
    const cookie = cookieFor([{ id: workspace.id, s: generateSecret(), t: 1 }]);
    const res = await get(`/api/w/${workspace.id}`, cookie);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it("TC-30 a cookie for workspace A does not open workspace B", async () => {
    const a = await createWorkspace();
    const b = await createWorkspace();
    expect((await get(`/api/w/${b.workspace.id}`, a.cookie)).status).toBe(404);
    expect((await get(`/api/w/${a.workspace.id}`, a.cookie)).status).toBe(200);
  });

  it('TC-31 an entry for an id that does not exist -> the same 404 body as no cookie', async () => {
    const id = randomHexId();
    const noCookie = await (await get(`/api/w/${id}`)).text();
    const res = await get(`/api/w/${id}`, cookieFor([{ id, s: generateSecret(), t: 1 }]));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(noCookie);
  });

  it('TC-32 a deleted workspace -> 404 even with the right secret', async () => {
    const { workspace, secret } = await seedDeletedWorkspace();
    const res = await get(`/api/w/${workspace.id}`, cookieFor([{ id: workspace.id, s: secret, t: 1 }]));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });
});

describe('PATCH /api/w/:id (rename)', () => {
  it('TC-33 renames, bumps version 1 -> 2, updated_at increases', async () => {
    const { workspace, cookie } = await createWorkspace();
    await env.DB.prepare("UPDATE workspaces SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").bind(workspace.id).run();
    const res = await patch(`/api/w/${workspace.id}`, { name: 'Groceries' }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace: { ...workspace, name: 'Groceries', version: 2 } });
    const row = await rowById(workspace.id);
    expect(row).toMatchObject({ name: 'Groceries', version: 2 });
    expect(row!.updated_at > '2000-01-01 00:00:00').toBe(true);
  });

  it("TC-34 the name is trimmed ('  Home  ' -> 'Home')", async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await patch(`/api/w/${workspace.id}`, { name: '  Home  ' }, cookie);
    expect(((await res.json()) as { workspace: { name: string } }).workspace.name).toBe('Home');
    expect((await rowById(workspace.id))?.name).toBe('Home');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
  ])('TC-35 %s -> 400, name and version unchanged', async (_label, name) => {
    const { workspace, cookie } = await createWorkspace();
    const res = await patch(`/api/w/${workspace.id}`, { name }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await rowById(workspace.id)).toMatchObject({ name: 'My Todoodle', version: 1 });
  });

  it('TC-36 1 and 120 chars are accepted; 121 chars -> 400 unchanged', async () => {
    const { workspace, cookie } = await createWorkspace();
    expect((await patch(`/api/w/${workspace.id}`, { name: 'x' }, cookie)).status).toBe(200);
    const max = 'n'.repeat(WORKSPACE_NAME_MAX);
    expect(WORKSPACE_NAME_MAX).toBe(120);
    expect((await patch(`/api/w/${workspace.id}`, { name: max }, cookie)).status).toBe(200);
    expect(await rowById(workspace.id)).toMatchObject({ name: max, version: 3 });
    const res = await patch(`/api/w/${workspace.id}`, { name: `${max}n` }, cookie);
    expect(res.status).toBe(400);
    expect(await rowById(workspace.id)).toMatchObject({ name: max, version: 3 });
  });

  it('TC-37 without auth -> 404, row unchanged', async () => {
    const { workspace } = await createWorkspace();
    const res = await patch(`/api/w/${workspace.id}`, { name: 'Hijacked' });
    expect(res.status).toBe(404);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'My Todoodle', version: 1 });
  });

  it('TC-38 without the client header -> 403, row unchanged', async () => {
    const { workspace, cookie } = await createWorkspace();
    const res = await patch(`/api/w/${workspace.id}`, { name: 'Nope' }, cookie, {});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(await rowById(workspace.id)).toMatchObject({ name: 'My Todoodle', version: 1 });
  });
});

describe('GET /api/w/:id/link', () => {
  it('TC-59 returns origin/w#<cookie entry secret> with Cache-Control no-store', async () => {
    const { workspace, secret, cookie } = await createWorkspace();
    const res = await get(`/api/w/${workspace.id}/link`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: `${ORIGIN}/w#${secret}` });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('TC-60 without a cookie -> the byte-identical 404', async () => {
    const { workspace } = await createWorkspace();
    const res = await get(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it('TC-61 a tampered entry never gets the link back', async () => {
    const { workspace } = await createWorkspace();
    const fake = generateSecret();
    const res = await get(`/api/w/${workspace.id}/link`, cookieFor([{ id: workspace.id, s: fake, t: 1 }]));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(text).not.toContain(fake);
  });
});

describe('no link leakage', () => {
  it('TC-39 every workspace response carries the baseline headers and a request id', async () => {
    const created = await createWorkspace();
    const responses = [
      await post('/api/workspaces'),
      await post('/api/workspaces/open', { body: { secret: created.secret } }),
      await get(`/api/w/${created.workspace.id}`, created.cookie),
      await get(`/api/w/${created.workspace.id}/link`, created.cookie),
      await post('/api/workspaces/open', { body: {} }),
      await post('/api/workspaces/open', { body: { secret: generateSecret() } }),
      await get(`/api/w/${created.workspace.id}`),
    ];
    expect(responses.map((r) => r.status)).toEqual([201, 200, 200, 200, 400, 404, 404]);
    for (const res of responses) {
      for (const [name, value] of Object.entries(BASELINE_HEADERS)) expect(res.headers.get(name), name).toBe(value);
      expect(res.headers.get('x-request-id')).toMatch(UUID);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('TC-40 console output never contains a secret or the cookie value', async () => {
    const captured: unknown[][] = [];
    for (const level of ['error', 'log', 'warn', 'info', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args);
      });
    }
    const created = await createWorkspace();
    const unknownSecret = generateSecret();
    await post('/api/workspaces/open', { body: { secret: created.secret }, cookie: created.cookie });
    await post('/api/workspaces/open', { body: { secret: unknownSecret } });
    await get(`/api/w/${created.workspace.id}/link`, created.cookie);
    await patch(`/api/w/${created.workspace.id}`, { name: '' }, created.cookie);
    // A failing request is logged: it must still leave the cookie out.
    await get('/test/throw', created.cookie);
    const logged = JSON.stringify(captured);
    expect(captured.length).toBeGreaterThan(0);
    expect(logged).not.toContain(created.secret);
    expect(logged).not.toContain(unknownSecret);
    expect(logged).not.toContain(created.cookie.split('=')[1]!);
  });
});
