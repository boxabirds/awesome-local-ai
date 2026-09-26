import { applyD1Migrations, env, reset } from 'cloudflare:test';
import { LiveEvent } from '@todoodle/shared/events';
import { MAX_PROJECTS_PER_WORKSPACE, PROJECT_COLORS, PROJECT_NAME_MAX } from '@todoodle/shared/limits';
import { CountsSchema, ProjectListResponse, ProjectResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_NOT_FOUND_BODY } from '../../src/lib/errors.ts';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import { type LiveClient, connectLive, framesAfter } from '../support/live.ts';
import {
  FIRST_COLOR,
  SECOND_COLOR,
  activeProjectCount,
  createProject,
  createTaskIn,
  deleteProject,
  listProjects,
  markCompletedAt,
  markDeletedAlone,
  newProjectId,
  patchProject,
  postProject,
  projectRow,
  projectRows,
  seedProjects,
} from '../support/projects.ts';
import { getCounts, member } from '../support/tasks.ts';
import { Browser, JSON_CLIENT, randomId } from '../support/workspaces.ts';

// Story 7, projects.schema + projects.api_crud: migration 0003, list, counts, create (idempotent, limit) and
// update through SELF.fetch (real Hono, workspace-auth, Miniflare D1 and WorkspaceRoom). State is checked
// with direct SQL before and after; broadcasts with a real live socket.

const NO_EVENT_WAIT_MS = 300;
const CLIENT_X = '6f1c2a4e-9b3d-4c7a-8e21-5d0f9a7b3c11';

async function nextEvent(socket: LiveClient): Promise<LiveEvent> {
  const [frame] = await socket.waitForFrames(1);
  return LiveEvent.parse(JSON.parse(frame!));
}

async function expectNoEvent(socket: LiveClient) {
  expect(await framesAfter(socket, NO_EVENT_WAIT_MS)).toEqual([]);
}

describe('projects.schema: migration 0003', () => {
  it('TC-01 applies on a 0001-0002 database holding Inbox tasks, which stay in the Inbox', async () => {
    await reset();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 2));
    await env.DB.prepare("INSERT INTO workspaces (id, secret_hash, name) VALUES ('W0', 'hash', 'Before 0003')").run();
    for (const [index, name] of ['Buy milk', 'Call Mum 📞'].entries()) {
      await env.DB.prepare('INSERT INTO tasks (id, workspace_id, name, sort_order) VALUES (?, ?, ?, ?)')
        .bind(newProjectId(), 'W0', name, index + 1)
        .run();
    }

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    const { results: projectColumns } = await env.DB.prepare('PRAGMA table_info(projects)').all<{ name: string; pk: number; dflt_value: string | null }>();
    expect(projectColumns.map((c) => c.name)).toEqual([
      'id',
      'workspace_id',
      'name',
      'color',
      'sort_order',
      'version',
      'created_at',
      'updated_at',
      'deleted',
      'deleted_at',
      'delete_batch_id',
    ]);
    // Client-generated ids: no DEFAULT on the primary key.
    expect(projectColumns.find((c) => c.name === 'id')).toMatchObject({ pk: 1, dflt_value: null });
    const { results: taskColumns } = await env.DB.prepare('PRAGMA table_info(tasks)').all<{ name: string }>();
    expect(taskColumns.map((c) => c.name)).toEqual(expect.arrayContaining(['project_id', 'delete_batch_id']));

    const indexCols = async (name: string) =>
      (await env.DB.prepare(`PRAGMA index_info(${name})`).all<{ name: string }>()).results.map((c) => c.name);
    expect(await indexCols('idx_projects_ws')).toEqual(['workspace_id', 'deleted', 'sort_order']);
    expect(await indexCols('idx_tasks_project')).toEqual(['workspace_id', 'project_id', 'deleted', 'completed_at', 'sort_order']);
    expect(await indexCols('idx_tasks_batch')).toEqual(['delete_batch_id']);

    const { results: tasks } = await env.DB.prepare('SELECT project_id, delete_batch_id FROM tasks').all();
    expect(tasks).toEqual([
      { project_id: null, delete_batch_id: null },
      { project_id: null, delete_batch_id: null },
    ]);
    const table = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projects'").first<{ sql: string }>();
    expect(table?.sql).not.toMatch(/CHECK/i);
  });
});

describe('projects.api_crud: list and counts', () => {
  it('TC-03 a workspace with no projects and no tasks: {projects: []} and {inbox: 0, projects: {}}', async () => {
    const { browser, id } = await member();
    const list = await listProjects(browser, id);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ projects: [] });
    const counts = await getCounts(browser, id);
    expect(counts.status).toBe(200);
    expect(await counts.json()).toEqual({ inbox: 0, projects: {} });
  });

  it('TC-04 counts: open/total per active project, deleted projects absent, inbox excludes project tasks', async () => {
    const { browser, id } = await member();
    const p1 = await createProject(browser, id, 'Work');
    const p2 = await createProject(browser, id, 'Trip to Lisbon');
    const p3 = await createProject(browser, id, 'Café ☕ plans');
    const p1Tasks = [];
    for (const name of ['Draft Q3 plan', 'Email Sam re: invoice #4411', 'Book room', 'File expenses', 'Review PR', 'Old ticket']) {
      p1Tasks.push(await createTaskIn(browser, id, p1, name));
    }
    await markCompletedAt(p1Tasks[3]!, '2026-09-24T17:30:00.000Z');
    await markCompletedAt(p1Tasks[4]!, '2026-09-25T08:00:00.000Z');
    await markDeletedAlone(p1Tasks[5]!);
    for (const name of ['Pack', 'Check in']) await createTaskIn(browser, id, p2, name);
    expect((await deleteProject(browser, id, p2)).status).toBe(200);
    for (const name of ['Buy milk', 'Call Mum 📞', 'Water the plants', 'Renew passport']) await createTaskIn(browser, id, null, name);

    const counts = CountsSchema.parse(await (await getCounts(browser, id)).json());
    expect(counts).toEqual({ inbox: 4, projects: { [p1]: { open: 3, total: 5 }, [p3]: { open: 0, total: 0 } } });
    // Counts are requested without any date (the counts key carries none); the shape has no other fields.
    expect(Object.keys(counts).sort()).toEqual(['inbox', 'projects']);
  });

  it('TC-05 a browser whose cookie lacks the workspace gets the unknown-workspace 404 for both', async () => {
    const { id } = await member();
    const stranger = new Browser();
    for (const res of [await listProjects(stranger, id), await getCounts(stranger, id), await listProjects(stranger, randomId())]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(WORKSPACE_NOT_FOUND_BODY);
    }
  });

  it('lists active projects in creation order with the public shape only', async () => {
    const { browser, id } = await member();
    const a = await createProject(browser, id, 'Work', FIRST_COLOR);
    const b = await createProject(browser, id, 'Home', SECOND_COLOR);
    const c = await createProject(browser, id, 'Woodwork');
    expect((await deleteProject(browser, id, b)).status).toBe(200);
    const { projects } = ProjectListResponse.parse(await (await listProjects(browser, id)).json());
    expect(projects.map((p) => p.id)).toEqual([a, c]);
    expect(Object.keys(projects[0]!).sort()).toEqual(['color', 'createdAt', 'id', 'name', 'sortOrder', 'updatedAt', 'version']);
  });
});

describe('projects.api_crud: POST /projects', () => {
  it('TC-06 creates with the first palette key: 201, one row, sort_order 1, version 1, project.upserted', async () => {
    const { browser, id } = await member();
    const socket = await connectLive(browser, id);
    const projectId = newProjectId();
    expect(await projectRows(id)).toEqual([]);
    const res = await postProject(browser, id, { id: projectId, name: 'A', color: PROJECT_COLORS[0].key });
    expect(res.status).toBe(201);
    const { project } = ProjectResponse.parse(await res.json());
    expect(project).toMatchObject({ id: projectId, name: 'A', color: PROJECT_COLORS[0].key, sortOrder: 1, version: 1 });
    const rows = await projectRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: projectId, color: PROJECT_COLORS[0].key, sort_order: 1, version: 1, deleted: 0 });
    expect(await nextEvent(socket)).toMatchObject({ type: 'project.upserted', version: 1, entity: { id: projectId, name: 'A' } });
    socket.close();
  });

  it('TC-07 a name of exactly PROJECT_NAME_MAX characters is stored unchanged', async () => {
    const { browser, id } = await member();
    const name = `${'Café ☕ plans '.repeat(20)}`.slice(0, PROJECT_NAME_MAX);
    expect(name).toHaveLength(PROJECT_NAME_MAX);
    const projectId = newProjectId();
    expect((await postProject(browser, id, { id: projectId, name, color: FIRST_COLOR })).status).toBe(201);
    expect((await projectRow(projectId))?.name).toBe(name);
  });

  it.each([
    ['TC-08 121 characters', { name: 'n'.repeat(PROJECT_NAME_MAX + 1), color: FIRST_COLOR }],
    ['TC-09 an empty name', { name: '', color: FIRST_COLOR }],
    ['TC-10 three spaces', { name: '   ', color: FIRST_COLOR }],
    ['TC-12 a colour that is not a palette key', { name: 'Work', color: '#ff0000' }],
    ['a missing colour', { name: 'Work' }],
  ])('%s -> 400 validation, no row', async (_label, body) => {
    const { browser, id } = await member();
    const res = await postProject(browser, id, { id: newProjectId(), ...body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect(await projectRows(id)).toEqual([]);
  });

  it('TC-12 a malformed id -> 400 validation, no row', async () => {
    const { browser, id } = await member();
    const res = await postProject(browser, id, { id: 'xyz', name: 'Work', color: FIRST_COLOR });
    expect(res.status).toBe(400);
    expect(await projectRows(id)).toEqual([]);
  });

  it("TC-11 '  Work  ' is stored trimmed", async () => {
    const { browser, id } = await member();
    const projectId = newProjectId();
    const res = await postProject(browser, id, { id: projectId, name: '  Work  ', color: FIRST_COLOR });
    expect(res.status).toBe(201);
    expect((await projectRow(projectId))?.name).toBe('Work');
  });

  it('TC-13 with 299 active projects the 300th is created', async () => {
    const { browser, id } = await member();
    await seedProjects(id, MAX_PROJECTS_PER_WORKSPACE - 1);
    expect(await activeProjectCount(id)).toBe(299);
    expect((await postProject(browser, id, { id: newProjectId(), name: 'Last one', color: FIRST_COLOR })).status).toBe(201);
    expect(await activeProjectCount(id)).toBe(300);
  });

  it('TC-14 with 300 active projects a new id -> 409 limit_reached, count stays 300', async () => {
    const { browser, id } = await member();
    await seedProjects(id, MAX_PROJECTS_PER_WORKSPACE);
    const res = await postProject(browser, id, { id: newProjectId(), name: 'One too many', color: FIRST_COLOR });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'limit_reached' });
    expect(await activeProjectCount(id)).toBe(300);
  });

  it('TC-15 300 projects of which 1 is deleted: deleted ones do not count, so 201', async () => {
    const { browser, id } = await member();
    await seedProjects(id, MAX_PROJECTS_PER_WORKSPACE, { deleted: 1 });
    expect(await activeProjectCount(id)).toBe(299);
    expect((await postProject(browser, id, { id: newProjectId(), name: 'Fits again', color: FIRST_COLOR })).status).toBe(201);
    expect(await activeProjectCount(id)).toBe(300);
  });

  it('TC-16 without the X-Todoodle-Client header -> 403 forbidden_client, no row', async () => {
    const { browser, id } = await member();
    const res = await postProject(browser, id, { id: newProjectId(), name: 'Work', color: FIRST_COLOR }, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_client' });
    expect(await projectRows(id)).toEqual([]);
  });

  it("TC-17 duplicate names are allowed: two 'Work' projects", async () => {
    const { browser, id } = await member();
    await createProject(browser, id, 'Work');
    await createProject(browser, id, 'Work');
    expect((await projectRows(id)).map((r) => r.name)).toEqual(['Work', 'Work']);
  });

  it('TC-76 a retried create (same id, different name) -> 200 with the stored name; one row; one broadcast', async () => {
    const { browser, id } = await member();
    const socket = await connectLive(browser, id);
    const projectId = newProjectId();
    expect((await postProject(browser, id, { id: projectId, name: 'Work', color: FIRST_COLOR })).status).toBe(201);
    const replay = await postProject(browser, id, { id: projectId, name: 'Job', color: SECOND_COLOR });
    expect(replay.status).toBe(200);
    expect(ProjectResponse.parse(await replay.json()).project).toMatchObject({ id: projectId, name: 'Work', color: FIRST_COLOR });
    expect(await projectRows(id)).toHaveLength(1);
    expect(await framesAfter(socket, NO_EVENT_WAIT_MS)).toHaveLength(1);
    socket.close();
  });

  it('TC-77 the id of a soft-deleted project here -> 410 gone, the row stays deleted', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    expect((await deleteProject(browser, id, projectId)).status).toBe(200);
    const res = await postProject(browser, id, { id: projectId, name: 'Work again', color: FIRST_COLOR });
    expect(res.status).toBe(410);
    expect(await projectRow(projectId)).toMatchObject({ deleted: 1, name: 'Work' });
  });

  it("TC-78 an id already used in workspace B -> 409 id_conflict; B's row unchanged, no row in A", async () => {
    const a = await member();
    const b = await member();
    const projectId = await createProject(b.browser, b.id, 'Theirs');
    const before = await projectRow(projectId);
    const res = await postProject(a.browser, a.id, { id: projectId, name: 'Mine', color: SECOND_COLOR });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'id_conflict' });
    expect(await projectRow(projectId)).toEqual(before);
    expect(await projectRows(a.id)).toEqual([]);
  });

  it('TC-79 a replay of an existing id at the limit -> 200 existing project (limit not applied), count 300', async () => {
    const { browser, id } = await member();
    await seedProjects(id, MAX_PROJECTS_PER_WORKSPACE - 1);
    const projectId = newProjectId();
    expect((await postProject(browser, id, { id: projectId, name: 'Last one', color: FIRST_COLOR })).status).toBe(201);
    const replay = await postProject(browser, id, { id: projectId, name: 'Last one', color: FIRST_COLOR });
    expect(replay.status).toBe(200);
    expect(ProjectResponse.parse(await replay.json()).project.id).toBe(projectId);
    expect(await activeProjectCount(id)).toBe(300);
  });
});

describe('projects.api_crud: PATCH /projects/:pid', () => {
  it('TC-18 rename: 200, name changed, version 1 -> 2, updated_at advanced, project.upserted (origin tagged)', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    await env.DB.prepare("UPDATE projects SET updated_at = '2026-09-01T00:00:00.000Z' WHERE id = ?").bind(projectId).run();
    const socket = await connectLive(browser, id);
    const res = await browser.fetch(`/api/w/${id}/projects/${projectId}`, {
      method: 'PATCH',
      headers: { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_X },
      body: JSON.stringify({ name: 'Job' }),
    });
    expect(res.status).toBe(200);
    expect(ProjectResponse.parse(await res.json()).project).toMatchObject({ name: 'Job', version: 2 });
    const row = await projectRow(projectId);
    expect(row).toMatchObject({ name: 'Job', version: 2 });
    expect(row!.updated_at > '2026-09-01T00:00:00.000Z').toBe(true);
    expect(await nextEvent(socket)).toMatchObject({ type: 'project.upserted', version: 2, originClientId: CLIENT_X, entity: { id: projectId, name: 'Job' } });
    socket.close();
  });

  it("TC-19 name '' -> 400; name and version unchanged", async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const res = await patchProject(browser, id, projectId, { name: '' });
    expect(res.status).toBe(400);
    expect(await projectRow(projectId)).toMatchObject({ name: 'Work', version: 1 });
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { name: 'Job', deleted: 0 }],
    ['a name over the limit', { name: 'n'.repeat(PROJECT_NAME_MAX + 1) }],
    ['a colour outside the palette', { color: '#00ff00' }],
  ])('%s -> 400, unchanged', async (_label, body) => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    expect((await patchProject(browser, id, projectId, body)).status).toBe(400);
    expect(await projectRow(projectId)).toMatchObject({ name: 'Work', version: 1, color: FIRST_COLOR });
  });

  it('TC-20 colour only: colour changed, name unchanged', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const res = await patchProject(browser, id, projectId, { color: SECOND_COLOR });
    expect(res.status).toBe(200);
    expect(await projectRow(projectId)).toMatchObject({ name: 'Work', color: SECOND_COLOR, version: 2 });
  });

  it('the same values -> 200, no version bump, no event', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const socket = await connectLive(browser, id);
    expect((await patchProject(browser, id, projectId, { name: 'Work' })).status).toBe(200);
    expect(await projectRow(projectId)).toMatchObject({ version: 1 });
    await expectNoEvent(socket);
    socket.close();
  });

  it('TC-21 a soft-deleted project -> 410 gone; row unchanged', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    expect((await deleteProject(browser, id, projectId)).status).toBe(200);
    const before = await projectRow(projectId);
    expect((await patchProject(browser, id, projectId, { name: 'Job' })).status).toBe(410);
    expect(await projectRow(projectId)).toEqual(before);
  });

  it('TC-22 a nonexistent project (and a malformed id) -> 404 not_found', async () => {
    const { browser, id } = await member();
    for (const projectId of [newProjectId(), 'not-an-id']) {
      const res = await patchProject(browser, id, projectId, { name: 'Job' });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    }
  });

  it("TC-23 workspace B's project through workspace A's path -> 404; B's row unchanged", async () => {
    const a = await member();
    const b = await member();
    const projectId = await createProject(b.browser, b.id, 'Theirs');
    const before = await projectRow(projectId);
    expect((await patchProject(a.browser, a.id, projectId, { name: 'Hijacked' })).status).toBe(404);
    expect(await projectRow(projectId)).toEqual(before);
  });

  it('a mutation without the client header is 403 and changes nothing', async () => {
    const { browser, id } = await member();
    const projectId = await createProject(browser, id, 'Work');
    const res = await browser.fetch(`/api/w/${id}/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Job' }),
    });
    expect(res.status).toBe(403);
    expect((await deleteProject(browser, id, projectId, {})).status).toBe(403);
    expect(await projectRow(projectId)).toMatchObject({ name: 'Work', deleted: 0 });
  });
});
