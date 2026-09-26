import { http, HttpResponse } from 'msw';
import {
  CountsSchema,
  DeleteProjectResponse,
  type Project,
  ProjectListResponse,
  ProjectResponse,
  ProjectSchema,
  RestoreProjectResponse,
  type Task,
  TaskListResponse,
  TaskResponse,
  TaskSchema,
  orderTasks,
} from '@todoodle/shared/schemas';
import { MAX_PROJECTS_PER_WORKSPACE, TASK_SORT_STEP } from '@todoodle/shared/limits';

// A stateful MSW stand-in for story 7's endpoints (projects, per-project task lists, counts, create in a
// project, move) plus story 6's task lifecycle calls the project views use. Bodies go through the shared zod
// schemas. Each call is recorded; any operation can fail (a status, or 'network') or wait for a promise.

export type ProjectOp = 'projects' | 'createProject' | 'updateProject' | 'deleteProject' | 'restoreProject' | 'list' | 'counts' | 'createTask' | 'patchTask';
export type Call = { op: ProjectOp; id?: string; body?: unknown; url?: string };
type Failure = number | 'network';

type StoredProject = Project & { deleted: boolean; batchId: string | null };
type StoredTask = Task & { deleted: boolean; batchId: string | null };

const CODES: Record<number, string> = { 400: 'validation', 404: 'not_found', 410: 'gone', 500: 'internal', 403: 'forbidden_client' };

function errorResponse(status: number, code?: string) {
  return HttpResponse.json({ error: code ?? CODES[status] ?? 'internal', message: 'x' }, { status });
}

let batches = 0;

export function projectServer(initial: { projects?: Project[]; tasks?: Task[] } = {}) {
  const projects = new Map<string, StoredProject>((initial.projects ?? []).map((p) => [p.id, { ...p, deleted: false, batchId: null }]));
  const tasks = new Map<string, StoredTask>((initial.tasks ?? []).map((t) => [t.id, { ...t, deleted: false, batchId: null }]));
  const calls: Call[] = [];
  const fail: Partial<Record<ProjectOp, Failure | { status: number; code: string }>> = {};
  const hold: Partial<Record<ProjectOp, Promise<unknown>>> = {};

  const publicProject = ({ deleted: _d, batchId: _b, ...project }: StoredProject): Project => ProjectSchema.parse(project);
  const publicTask = ({ deleted: _d, batchId: _b, ...task }: StoredTask): Task => TaskSchema.parse(task);
  const activeProjects = () => [...projects.values()].filter((p) => !p.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
  const liveTasks = () => [...tasks.values()].filter((t) => !t.deleted);

  function counts() {
    const byProject: Record<string, { open: number; total: number }> = {};
    for (const project of activeProjects()) byProject[project.id] = { open: 0, total: 0 };
    let inbox = 0;
    for (const task of liveTasks()) {
      if (task.projectId === null) {
        if (task.completedAt === null) inbox++;
      } else if (byProject[task.projectId]) {
        byProject[task.projectId]!.total++;
        if (task.completedAt === null) byProject[task.projectId]!.open++;
      }
    }
    return CountsSchema.parse({ inbox, projects: byProject });
  }

  async function gate(op: ProjectOp) {
    await hold[op];
    const failure = fail[op];
    if (failure === undefined) return null;
    if (failure === 'network') return HttpResponse.error();
    if (typeof failure === 'number') return errorResponse(failure);
    return errorResponse(failure.status, failure.code);
  }

  const maxSort = () => Math.max(0, ...[...tasks.values()].map((t) => t.sortOrder));

  const handlers = [
    http.get('/api/w/:ws/projects', async () => {
      calls.push({ op: 'projects' });
      return (await gate('projects')) ?? HttpResponse.json(ProjectListResponse.parse({ projects: activeProjects().map(publicProject) }));
    }),
    http.post('/api/w/:ws/projects', async ({ request }) => {
      const body = (await request.json()) as { id: string; name: string; color: string };
      calls.push({ op: 'createProject', body });
      const blocked = await gate('createProject');
      if (blocked) return blocked;
      if (activeProjects().length >= MAX_PROJECTS_PER_WORKSPACE) return errorResponse(409, 'limit_reached');
      const sortOrder = Math.max(0, ...[...projects.values()].map((p) => p.sortOrder)) + 1;
      const project = ProjectSchema.parse({ ...body, name: body.name.trim(), sortOrder, version: 1, createdAt: '2026-09-26 10:00:00', updatedAt: '2026-09-26 10:00:00' });
      projects.set(project.id, { ...project, deleted: false, batchId: null });
      return HttpResponse.json(ProjectResponse.parse({ project }), { status: 201 });
    }),
    http.patch('/api/w/:ws/projects/:id', async ({ params, request }) => {
      const id = String(params.id);
      const body = (await request.json()) as { name?: string; color?: string };
      calls.push({ op: 'updateProject', id, body });
      const blocked = await gate('updateProject');
      if (blocked) return blocked;
      const current = projects.get(id);
      if (!current) return errorResponse(404);
      if (current.deleted) return errorResponse(410);
      const next = { ...current, ...(body.name ? { name: body.name.trim() } : {}), ...(body.color ? { color: body.color as Project['color'] } : {}), version: current.version + 1 };
      projects.set(id, next);
      return HttpResponse.json(ProjectResponse.parse({ project: publicProject(next) }));
    }),
    http.delete('/api/w/:ws/projects/:id', async ({ params }) => {
      const id = String(params.id);
      calls.push({ op: 'deleteProject', id });
      const blocked = await gate('deleteProject');
      if (blocked) return blocked;
      const current = projects.get(id);
      if (!current) return errorResponse(404);
      if (current.deleted) return errorResponse(410);
      const batchId = (++batches).toString(16).padStart(32, 'c');
      let count = 0;
      for (const task of liveTasks()) {
        if (task.projectId !== id) continue;
        tasks.set(task.id, { ...task, deleted: true, batchId, version: task.version + 1 });
        count++;
      }
      projects.set(id, { ...current, deleted: true, batchId, version: current.version + 1 });
      return HttpResponse.json(DeleteProjectResponse.parse({ batchId, deletedTaskCount: count }));
    }),
    http.post('/api/w/:ws/projects/:id/restore', async ({ params, request }) => {
      const id = String(params.id);
      const body = (await request.json()) as { batchId: string };
      calls.push({ op: 'restoreProject', id, body });
      const blocked = await gate('restoreProject');
      if (blocked) return blocked;
      const current = projects.get(id);
      if (!current) return errorResponse(404);
      if (!current.deleted) return errorResponse(409, 'not_deleted');
      if (current.batchId !== body.batchId) return errorResponse(409, 'batch_mismatch');
      let count = 0;
      for (const task of tasks.values()) {
        if (task.batchId !== body.batchId) continue;
        tasks.set(task.id, { ...task, deleted: false, batchId: null, version: task.version + 1 });
        count++;
      }
      const restored = { ...current, deleted: false, batchId: null, version: current.version + 1 };
      projects.set(id, restored);
      return HttpResponse.json(RestoreProjectResponse.parse({ project: publicProject(restored), restoredTaskCount: count }));
    }),
    http.get('/api/w/:ws/counts', async () => {
      calls.push({ op: 'counts' });
      return (await gate('counts')) ?? HttpResponse.json(counts());
    }),
    http.get('/api/w/:ws/tasks', async ({ request }) => {
      const url = new URL(request.url);
      calls.push({ op: 'list', url: url.search });
      const blocked = await gate('list');
      if (blocked) return blocked;
      const projectId = url.searchParams.get('list') === 'project' ? url.searchParams.get('projectId') : null;
      if (projectId) {
        const project = projects.get(projectId);
        if (!project) return errorResponse(404, 'project_not_found');
        if (project.deleted) return errorResponse(410);
      }
      const includeCompleted = url.searchParams.get('include_completed') === 'true';
      const visible = liveTasks().filter((t) => t.projectId === projectId && (includeCompleted || t.completedAt === null));
      return HttpResponse.json(TaskListResponse.parse({ tasks: orderTasks(visible).map(publicTask) }));
    }),
    http.post('/api/w/:ws/tasks', async ({ request, params }) => {
      const body = (await request.json()) as { id: string; name: string; description?: string; projectId?: string | null };
      calls.push({ op: 'createTask', body });
      const blocked = await gate('createTask');
      if (blocked) return blocked;
      const task = TaskSchema.parse({
        id: body.id,
        workspaceId: String(params.ws),
        projectId: body.projectId ?? null,
        name: body.name.trim(),
        description: (body.description ?? '').trim(),
        sortOrder: maxSort() + TASK_SORT_STEP,
        completedAt: null,
        version: 1,
        createdAt: '2026-09-26 10:00:00',
        updatedAt: '2026-09-26 10:00:00',
      });
      tasks.set(task.id, { ...task, deleted: false, batchId: null });
      return HttpResponse.json(TaskResponse.parse({ task }), { status: 201 });
    }),
    http.patch('/api/w/:ws/tasks/:id', async ({ params, request }) => {
      const id = String(params.id);
      const body = (await request.json()) as { projectId?: string | null; name?: string };
      calls.push({ op: 'patchTask', id, body });
      const blocked = await gate('patchTask');
      if (blocked) return blocked;
      const current = tasks.get(id);
      if (!current) return errorResponse(404);
      if (current.deleted) return errorResponse(410);
      if (body.projectId !== undefined && body.projectId !== null && !activeProjects().some((p) => p.id === body.projectId)) {
        return errorResponse(404, 'project_not_found');
      }
      const moving = body.projectId !== undefined && body.projectId !== current.projectId;
      const next = moving ? { ...current, projectId: body.projectId ?? null, sortOrder: maxSort() + TASK_SORT_STEP, version: current.version + 1 } : current;
      tasks.set(id, next);
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(next) }));
    }),
  ];

  return {
    projects,
    tasks,
    calls,
    fail,
    hold,
    handlers,
    counts,
    callsOf: (op: ProjectOp) => calls.filter((call) => call.op === op),
  };
}

export type ProjectServer = ReturnType<typeof projectServer>;
