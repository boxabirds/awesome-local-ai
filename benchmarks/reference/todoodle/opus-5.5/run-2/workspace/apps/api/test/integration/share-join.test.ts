import { describe, expect, it } from 'vitest';
import { WORKSPACE_NOT_FOUND_BODY } from '../../src/lib/errors';
import { ORIGIN } from '../helpers';
import { cookieFor, cookieFrom, createWorkspace, entriesFrom, get, patch, post, rowById, seedDeletedWorkspace } from '../workspace-helpers';

const nowS = () => Math.floor(Date.now() / 1000);

describe('share.panel: GET /api/w/:id/link (story 2 endpoint the shared panel depends on)', () => {
  it('TC-S01 valid cookie -> 200, origin/w#<secret> equal to the created secret, no-store', async () => {
    const { workspace, secret, cookie } = await createWorkspace();
    const res = await get(`/api/w/${workspace.id}/link`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ link: `${ORIGIN}/w#${secret}` });
  });

  it('TC-S02 / TC-S03 no cookie, and a cookie for V only -> 404 not_found with identical bodies', async () => {
    const w = await createWorkspace();
    const v = await createWorkspace();
    const none = await get(`/api/w/${w.workspace.id}/link`);
    const other = await get(`/api/w/${w.workspace.id}/link`, v.cookie);
    expect(none.status).toBe(404);
    expect(other.status).toBe(404);
    const [a, b] = [await none.text(), await other.text()];
    expect(a).toBe(WORKSPACE_NOT_FOUND_BODY);
    expect(b).toBe(a);
  });

  it('TC-S04 W entry with a tampered secret -> 404', async () => {
    const { workspace, secret } = await createWorkspace();
    const tampered = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    const res = await get(`/api/w/${workspace.id}/link`, cookieFor([{ id: workspace.id, s: tampered, t: nowS() }]));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(secret);
  });

  it('TC-S05 W soft-deleted via /test seed -> 404', async () => {
    const { workspace, secret } = await seedDeletedWorkspace();
    const res = await get(`/api/w/${workspace.id}/link`, cookieFor([{ id: workspace.id, s: secret, t: nowS() }]));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });
});

describe('share.join: opening a shared link', () => {
  it('TC-J01 B has no cookie, W exists: POST open -> 200, Set-Cookie has the W entry first', async () => {
    const a = await createWorkspace();
    const res = await post('/api/workspaces/open', { body: { secret: a.secret } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspace: { id: a.workspace.id, name: 'My Todoodle' } });
    const entries = entriesFrom(res);
    expect(entries.map((e) => e.id)).toEqual([a.workspace.id]);
    expect(entries[0]!.s).toBe(a.secret);
  });

  it('TC-J02 B cookie holds V then W; open W again -> exactly one W entry, now first; V kept', async () => {
    const w = await createWorkspace();
    const v = await createWorkspace();
    const bCookie = cookieFor([
      { id: v.workspace.id, s: v.secret, t: nowS() },
      { id: w.workspace.id, s: w.secret, t: nowS() - 60 },
    ]);
    const res = await post('/api/workspaces/open', { body: { secret: w.secret }, cookie: bCookie });
    expect(res.status).toBe(200);
    const ids = entriesFrom(res).map((e) => e.id);
    expect(ids).toEqual([w.workspace.id, v.workspace.id]);
  });

  it('TC-J03 unknown secret -> 404, no Set-Cookie', async () => {
    const res = await post('/api/workspaces/open', { body: { secret: 'itKKlctGr1Pc2mTB8LWIXOvJOr8DrCDnOc0XzBmj5EQ' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
  });

  it('TC-J04 B joined W; PATCH rename with B’s cookie -> 200, D1 name changed', async () => {
    const a = await createWorkspace();
    const joined = await post('/api/workspaces/open', { body: { secret: a.secret } });
    // B's own cookie jar: only what the open set.
    const bCookie = cookieFrom(joined)!;
    const before = await rowById(a.workspace.id);
    const res = await patch(`/api/w/${a.workspace.id}`, { name: 'Shared chores' }, bCookie);
    expect(res.status).toBe(200);
    expect(before).toMatchObject({ name: 'My Todoodle', version: 1 });
    expect(await rowById(a.workspace.id)).toMatchObject({ name: 'Shared chores', version: 2 });
  });
});
