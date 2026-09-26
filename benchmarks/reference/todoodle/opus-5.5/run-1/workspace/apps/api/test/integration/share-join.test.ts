import { describe, expect, it } from 'vitest';
import { Browser, cookieFor, rowById, seedWorkspace } from '../support/workspaces.ts';

const NOT_FOUND_TEXT = JSON.stringify({ error: 'not_found', message: 'Workspace not found' });

// share.panel: story 2's GET /api/w/:id/link, which the single SharePanel depends on.
describe('share.panel: GET /api/w/:id/link', () => {
  it('TC-S01 valid cookie -> 200, link origin/w#<secret> equal to the created secret, Cache-Control no-store', async () => {
    const browser = new Browser();
    const { workspace, secret } = await browser.create();
    const res = await browser.fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link: `https://todoodle.test/w#${secret}` });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('TC-S02 / TC-S03 no cookie, or a cookie for V only -> 404 with byte-identical bodies', async () => {
    const { workspace } = await new Browser().create();
    const noCookie = await new Browser().fetch(`/api/w/${workspace.id}/link`);
    const other = new Browser();
    await other.create();
    const otherOnly = await other.fetch(`/api/w/${workspace.id}/link`);
    expect(noCookie.status).toBe(404);
    expect(otherOnly.status).toBe(404);
    const [a, b] = [await noCookie.text(), await otherOnly.text()];
    expect(a).toBe(NOT_FOUND_TEXT);
    expect(b).toBe(a);
  });

  it('TC-S04 a W entry with a tampered secret -> 404', async () => {
    const { workspace } = await new Browser().create();
    const { secret: otherSecret } = await new Browser().create();
    const res = await new Browser(cookieFor([{ id: workspace.id, s: otherSecret, t: 1 }])).fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });

  it('TC-S05 W soft-deleted (via /test seed) -> 404', async () => {
    const { workspace, secret } = await seedWorkspace({ deleted: true });
    const res = await new Browser(cookieFor([{ id: workspace.id, s: secret, t: 1 }])).fetch(`/api/w/${workspace.id}/link`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_TEXT);
  });
});

describe('share.join: opening a shared link', () => {
  it('TC-J01 B has no cookie, W exists -> 200 and Set-Cookie has the W entry first', async () => {
    const a = new Browser();
    const { workspace, secret } = await a.create();
    const b = new Browser();
    expect(b.entries()).toEqual([]);
    const res = await b.open(secret);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspace: { id: workspace.id, name: 'My Todoodle', version: 1 } });
    expect(b.entries()).toEqual([{ id: workspace.id, s: secret, t: expect.any(Number) }]);
  });

  it('TC-J02 B remembers V then W; opening W again -> exactly one W entry, now first; V kept', async () => {
    const owner = new Browser();
    const w = await owner.create();
    const b = new Browser();
    const v = await b.create();
    await b.open(w.secret);
    // Put V first (as if opened most recently), W second.
    await b.open(v.secret);
    expect(b.entries().map((e) => e.id)).toEqual([v.workspace.id, w.workspace.id]);

    const res = await b.open(w.secret);
    expect(res.status).toBe(200);
    const ids = b.entries().map((e) => e.id);
    expect(ids).toEqual([w.workspace.id, v.workspace.id]);
    expect(ids.filter((id) => id === w.workspace.id)).toHaveLength(1);
  });

  it('TC-J03 an unknown secret -> 404 and no Set-Cookie', async () => {
    const b = new Browser();
    const res = await b.open('A'.repeat(43));
    expect(res.status).toBe(404);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(b.entries()).toEqual([]);
  });

  it("TC-J04 B has joined W -> renaming with B's cookie is 200 and D1 changes", async () => {
    const a = new Browser();
    const { workspace, secret } = await a.create();
    const b = new Browser();
    await b.open(secret);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'My Todoodle', version: 1 });
    const res = await b.rename(workspace.id, 'Our trip');
    expect(res.status).toBe(200);
    expect(await rowById(workspace.id)).toMatchObject({ name: 'Our trip', version: 2 });
  });
});
