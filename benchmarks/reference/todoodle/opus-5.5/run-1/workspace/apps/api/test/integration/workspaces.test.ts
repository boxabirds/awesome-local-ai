import { SELF, env } from 'cloudflare:test';
import { MAX_REMEMBERED_WORKSPACES, WORKSPACE_NAME_MAX } from '@todoodle/shared/limits';
import { describe, expect, it, vi } from 'vitest';
import { hashSecret } from '../../src/lib/crypto.ts';
import { CLIENT, expectBaselineHeaders, url } from '../support/http.ts';
import { Browser, JSON_CLIENT, cookieFor, countWorkspaces, randomId, rowById, seedWorkspace } from '../support/workspaces.ts';

const NOT_FOUND_TEXT = JSON.stringify({ error: 'not_found', message: 'Workspace not found' });

describe('workspace.schema', () => {
  it('TC-14 migrations create every column and a UNIQUE secret_hash', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(workspaces)').all<{ name: string; notnull: number; pk: number }>();
    expect(results.map((c) => c.name)).toEqual([
      'id',
      'secret_hash',
      'name',
      'version',
      'created_at',
      'updated_at',
      'deleted',
      'deleted_at',
    ]);
    expect(results.find((c) => c.name === 'id')?.pk).toBe(1);

    const insert = (hash: string) => env.DB.prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?)').bind(hash, 'x').run();
    await insert('a'.repeat(64));
    await expect(insert('a'.repeat(64))).rejects.toThrow(/UNIQUE/);
    expect(await countWorkspaces()).toBe(1);

    const row = await env.DB.prepare('SELECT * FROM workspaces').first<Record<string, unknown>>();
    expect(row).toMatchObject({ version: 1, deleted: 0, deleted_at: null });
    expect(row?.id).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe('workspace.create', () => {
  it('TC-15 creates one row with the default name; only the SHA-256 of the secret is stored', async () => {
    expect(await countWorkspaces()).toBe(0);
    const res = await new Browser().fetch('/api/workspaces', { method: 'POST', headers: JSON_CLIENT, body: '{}' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { workspace: Record<string, unknown>; secret: string; dropped: number };
    expect(body).toEqual({
      workspace: { id: expect.stringMatching(/^[0-9A-F]{32}$/), name: 'My Todoodle', version: 1, createdAt: expect.any(String) },
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      dropped: 0,
    });
    expect(await countWorkspaces()).toBe(1);
    const row = await rowById(body.workspace.id as string);
    expect(row?.secret_hash).toBe(await hashSecret(body.secret));
    for (const value of Object.values(row ?? {})) expect(String(value)).not.toContain(body.secret);
  });

  it('TC-16 Set-Cookie tdl_ws decodes to [{id: new, s: secret}]', async () => {
    const browser = new Browser();
    const { workspace, secret } = await browser.create();
    expect(browser.entries()).toEqual([{ id: workspace.id, s: secret, t: expect.any(Number) }]);
  });

  it('TC-17 at the cap of 50: cookie keeps 50, new first, oldest gone, dropped=1', async () => {
    const browser = new Browser();
    const created: string[] = [];
    for (let i = 0; i < MAX_REMEMBERED_WORKSPACES; i++) created.push((await browser.create()).workspace.id);
    expect(browser.entries()).toHaveLength(50);

    const newest = await browser.create();
    expect(newest.dropped).toBe(1);
    const ids = browser.entries().map((e) => e.id);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe(newest.workspace.id);
    expect(ids).not.toContain(created[0]);
    expect(ids).toContain(created[1]);
  });

  it('TC-18 a missing client header is 403 forbidden_client and creates nothing', async () => {
    const res = await SELF.fetch(url('/api/workspaces'), { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await countWorkspaces()).toBe(0);
  });

  it('TC-19 a text/plain body is rejected before the handler and creates nothing', async () => {
    // Story 1's validate rule answers a non-JSON body with 415 (see NOTES.md); the design's TC-19 says 403.
    const res = await SELF.fetch(url('/api/workspaces'), {
      method: 'POST',
      headers: { ...CLIENT, 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await countWorkspaces()).toBe(0);
  });

  it('TC-62 a bodyless POST with only the client header is 201 (relaxed rule)', async () => {
    const res = await SELF.fetch(url('/api/workspaces'), { method: 'POST', headers: CLIENT });
    expect(res.status).toBe(201);
    expect(await countWorkspaces()).toBe(1);
  });
});

describe('workspace.open', () => {
  it('TC-20 a valid secret returns the workspace and adds a cookie entry', async () => {
    const { workspace, secret } = await new Browser().create();
    const browser = new Browser();
    const res = await browser.open(secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace, dropped: 0 });
    expect(browser.entries()).toEqual([{ id: workspace.id, s: secret, t: expect.any(Number) }]);
  });

  it('TC-21 re-opening moves the entry to the front and updates t; count unchanged (idempotent)', async () => {
    const browser = new Browser();
    const first = await browser.create();
    const second = await browser.create();
    // Age the first entry so the refreshed t is observably newer.
    browser.cookie = cookieFor(browser.entries().map((e) => ({ ...e, t: e.t - 1000 })));
    const before = browser.entries();
    expect(before.map((e) => e.id)).toEqual([second.workspace.id, first.workspace.id]);

    for (let i = 0; i < 2; i++) {
      const res = await browser.open(first.secret);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { workspace: unknown }).workspace).toEqual(first.workspace);
    }
    const after = browser.entries();
    expect(after.map((e) => e.id)).toEqual([first.workspace.id, second.workspace.id]);
    expect(after[0]!.t).toBeGreaterThan(before[1]!.t);
    expect(await countWorkspaces()).toBe(2);
  });

  it('TC-22 an unknown well-formed secret is 404 with no Set-Cookie', async () => {
    const res = await new Browser().open('A'.repeat(43));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('TC-23 a malformed secret is a 404 byte-identical to TC-22', async () => {
    const unknown = await (await new Browser().open('A'.repeat(43))).text();
    for (const secret of ['short', 'A'.repeat(44), `${'A'.repeat(42)}+`, '']) {
      const res = await new Browser().open(secret);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(unknown);
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
  });

  it('TC-24 a missing secret or invalid JSON is 400 validation with no Set-Cookie', async () => {
    const browser = new Browser();
    const bodies = ['{}', '{"secret": 42}', 'not json', '[]'];
    for (const body of bodies) {
      const res = await browser.fetch('/api/workspaces/open', { method: 'POST', headers: JSON_CLIENT, body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
    const bodyless = await browser.fetch('/api/workspaces/open', { method: 'POST', headers: CLIENT });
    expect(bodyless.status).toBe(400);
  });

  it('TC-25 a deleted workspace secret is a 404 identical to TC-22', async () => {
    const { secret } = await seedWorkspace({ deleted: true });
    const res = await new Browser().open(secret);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('TC-26 a malformed cookie is discarded and rebuilt with one entry', async () => {
    const { workspace, secret } = await new Browser().create();
    const browser = new Browser(`tdl_ws=${btoa('{broken json')}`);
    const res = await browser.open(secret);
    expect(res.status).toBe(200);
    expect(browser.entries()).toEqual([{ id: workspace.id, s: secret, t: expect.any(Number) }]);
  });
});

describe('workspace.auth and workspace.get', () => {
  it('TC-27 a valid cookie entry reads the workspace', async () => {
    const browser = new Browser();
    const { workspace } = await browser.create();
    const res = await browser.get(workspace.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace: { id: workspace.id, name: 'My Todoodle', version: 1, createdAt: workspace.createdAt } });
  });

  it('TC-28 no cookie is 404', async () => {
    const { workspace } = await new Browser().create();
    const res = await new Browser().get(workspace.id);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-29 a tampered secret for the id is 404', async () => {
    const owner = new Browser();
    const { workspace } = await owner.create();
    const other = await new Browser().create();
    const tampered = new Browser(cookieFor([{ id: workspace.id, s: other.secret, t: 1 }]));
    const res = await tampered.get(workspace.id);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-30 a cookie for workspace A cannot read workspace B', async () => {
    const a = new Browser();
    await a.create();
    const b = await new Browser().create();
    const res = await a.get(b.workspace.id);
    expect(res.status).toBe(404);
  });

  it('TC-31 an entry for an id that does not exist is 404 identical to TC-28', async () => {
    const { secret } = await new Browser().create();
    const id = randomId();
    const noCookie = await new Browser().get(id);
    const res = await new Browser(cookieFor([{ id, s: secret, t: 1 }])).get(id);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(await noCookie.text());
  });

  it('TC-32 a deleted workspace is 404 even with its valid secret', async () => {
    const { workspace, secret } = await seedWorkspace({ deleted: true });
    const res = await new Browser(cookieFor([{ id: workspace.id, s: secret, t: 1 }])).get(workspace.id);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('auth does not refresh the cookie', async () => {
    const browser = new Browser();
    const { workspace } = await browser.create();
    const res = await browser.get(workspace.id);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('workspace.rename', () => {
  async function created() {
    const browser = new Browser();
    const { workspace } = await browser.create();
    // Backdate updated_at so the rename's new timestamp is observably later.
    await env.DB.prepare("UPDATE workspaces SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").bind(workspace.id).run();
    return { browser, id: workspace.id };
  }

  it('TC-33 renames, bumps version 1 -> 2 and updated_at increases', async () => {
    const { browser, id } = await created();
    const before = await rowById(id);
    const res = await browser.rename(id, 'Groceries');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspace: { id, name: 'Groceries', version: 2, createdAt: before!.created_at } });
    const after = await rowById(id);
    expect(after).toMatchObject({ name: 'Groceries', version: 2 });
    expect(after!.updated_at > before!.updated_at).toBe(true);
  });

  it('TC-34 the name is trimmed', async () => {
    const { browser, id } = await created();
    await browser.rename(id, '  Home  ');
    expect((await rowById(id))?.name).toBe('Home');
  });

  it("TC-35 '' and '   ' are 400 and change nothing", async () => {
    const { browser, id } = await created();
    for (const name of ['', '   ']) {
      const res = await browser.rename(id, name);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'validation' });
    }
    expect(await rowById(id)).toMatchObject({ name: 'My Todoodle', version: 1 });
  });

  it('TC-36 120 chars is accepted; 121 chars is 400 and changes nothing', async () => {
    const { browser, id } = await created();
    const ok = await browser.rename(id, 'x'.repeat(WORKSPACE_NAME_MAX));
    expect(ok.status).toBe(200);
    expect(await rowById(id)).toMatchObject({ name: 'x'.repeat(120), version: 2 });
    const tooLong = await browser.rename(id, 'y'.repeat(WORKSPACE_NAME_MAX + 1));
    expect(tooLong.status).toBe(400);
    expect(await rowById(id)).toMatchObject({ name: 'x'.repeat(120), version: 2 });
    const oneChar = await browser.rename(id, 'z');
    expect(oneChar.status).toBe(200);
  });

  it('TC-37 without auth it is 404 and the row is unchanged', async () => {
    const { id } = await created();
    const before = await rowById(id);
    const res = await new Browser().rename(id, 'Hijacked');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
    expect(await rowById(id)).toEqual(before);
  });

  it('TC-38 without the client header it is 403 and the row is unchanged', async () => {
    const { browser, id } = await created();
    const before = await rowById(id);
    const res = await browser.rename(id, 'Nope', { 'Content-Type': 'application/json' });
    expect(res.status).toBe(403);
    expect(await rowById(id)).toEqual(before);
  });
});

describe('security.no_leak', () => {
  it('TC-39 every workspace response carries the baseline headers', async () => {
    const browser = new Browser();
    const create = await browser.fetch('/api/workspaces', { method: 'POST', headers: CLIENT });
    const { workspace, secret } = (await create.clone().json()) as { workspace: { id: string }; secret: string };
    const responses = [
      create,
      await browser.open(secret),
      await browser.get(workspace.id),
      await browser.rename(workspace.id, ''),
      await new Browser().get(workspace.id),
      await new Browser().open('A'.repeat(43)),
    ];
    expect(responses.map((r) => r.status)).toEqual([201, 200, 200, 400, 404, 404]);
    for (const res of responses) {
      expectBaselineHeaders(res);
      expect(res.headers.get('Content-Security-Policy')).toMatch(/^default-src 'self'/);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('TC-40 console output never contains the secret or the cookie value', async () => {
    const logged: string[] = [];
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    const browser = new Browser();
    const { workspace, secret } = await browser.create();
    const cookie = browser.cookie!;
    await new Browser().open(secret);
    await browser.open(secret);
    await new Browser().open('B'.repeat(43));
    await browser.get(workspace.id);
    await browser.rename(workspace.id, 'Renamed');
    await browser.fetch('/test/throw');

    const output = logged.join('\n');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(cookie.split('=')[1]!);
  });
});

describe('workspace.link', () => {
  it('TC-59 returns origin/w#<cookie secret> with Cache-Control no-store', async () => {
    const browser = new Browser();
    const { workspace, secret } = await browser.create();
    const res = await browser.fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: `https://todoodle.test/w#${secret}` });
    expect(browser.entries()[0]!.s).toBe(secret);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expectBaselineHeaders(res);
  });

  it('TC-60 without a cookie it is a 404 byte-identical to the other misses', async () => {
    const { workspace } = await new Browser().create();
    const res = await new Browser().fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-61 a tampered cookie entry never gets the link', async () => {
    const { workspace } = await new Browser().create();
    const other = await new Browser().create();
    const res = await new Browser(cookieFor([{ id: workspace.id, s: other.secret, t: 1 }])).fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe(NOT_FOUND_TEXT);
    expect(text).not.toContain(other.secret);
  });
});
