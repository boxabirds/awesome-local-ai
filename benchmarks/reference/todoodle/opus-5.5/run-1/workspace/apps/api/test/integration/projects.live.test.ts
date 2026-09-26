import { LiveEvent } from '@todoodle/shared/events';
import { DeleteProjectResponse } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { CLIENT_ID_HEADER } from '../../src/live/broadcast.ts';
import { CLIENT } from '../support/http.ts';
import { connectLive, framesAfter } from '../support/live.ts';
import { createProject, createTaskIn, deleteProject, restoreProject } from '../support/projects.ts';
import { member } from '../support/tasks.ts';
import { JSON_CLIENT } from '../support/workspaces.ts';

// Story 7, projects.live_events (TC-75): project events fan out through the real WorkspaceRoom Durable Object
// to every socket of the workspace, tagged with the origin client, and never to another workspace's room.

const CLIENT_B = '7c9e1f3a-5b2d-4e6f-8a9b-0c1d2e3f4a5b';
const NO_EVENT_WAIT_MS = 300;

describe('projects.live_events: WorkspaceRoom fan-out', () => {
  it('TC-75 B deletes then restores a project with 2 tasks: A gets project.deleted + tasks.bulk, then project.restored + tasks.bulk; V gets nothing', async () => {
    const w = await member();
    const v = await member();
    const projectId = await createProject(w.browser, w.id, 'Trip to Lisbon');
    const tasks = [await createTaskIn(w.browser, w.id, projectId, 'Pack'), await createTaskIn(w.browser, w.id, projectId, 'Check in')];
    // Two tabs on W (clients a and b) and one on another workspace V.
    const a = await connectLive(w.browser, w.id);
    const b = await connectLive(w.browser, w.id);
    const elsewhere = await connectLive(v.browser, v.id);

    const deleted = await deleteProject(w.browser, w.id, projectId, { ...CLIENT, [CLIENT_ID_HEADER]: CLIENT_B });
    const { batchId } = DeleteProjectResponse.parse(await deleted.json());
    const afterDelete = (await a.waitForFrames(2)).map((frame) => LiveEvent.parse(JSON.parse(frame)));
    expect(afterDelete[0]).toEqual({ type: 'project.deleted', entity: { id: projectId, batchId }, version: 2, originClientId: CLIENT_B });
    expect(afterDelete[1]).toMatchObject({ type: 'tasks.bulk', entity: { deleted: true }, originClientId: CLIENT_B });
    expect((afterDelete[1]!.entity as { ids: string[] }).ids.toSorted()).toEqual(tasks.toSorted());

    expect((await restoreProject(w.browser, w.id, projectId, batchId, { ...JSON_CLIENT, [CLIENT_ID_HEADER]: CLIENT_B })).status).toBe(200);
    const all = (await a.waitForFrames(4)).map((frame) => LiveEvent.parse(JSON.parse(frame)));
    expect(all[2]).toMatchObject({ type: 'project.restored', entity: { id: projectId, name: 'Trip to Lisbon', version: 3 }, version: 3, originClientId: CLIENT_B });
    expect(all[3]).toMatchObject({ type: 'tasks.bulk', entity: { deleted: false }, originClientId: CLIENT_B });
    expect((all[3]!.entity as { ids: string[] }).ids.toSorted()).toEqual(tasks.toSorted());
    expect(all.every((event) => event.originClientId === CLIENT_B)).toBe(true);

    // b (the origin) receives the same frames; its client drops them as echoes by originClientId.
    expect(await b.waitForFrames(4)).toHaveLength(4);
    // Negative: nothing reaches another workspace's room.
    expect(await framesAfter(elsewhere, NO_EVENT_WAIT_MS)).toEqual([]);
    for (const socket of [a, b, elsewhere]) socket.close();
  });
});
