import { http, HttpResponse, delay } from 'msw';
import {
  CountsSchema,
  type Project,
  ProjectListResponse,
  type RescheduleRequest,
  type RestoreDueDatesRequest,
  type Task,
  TaskListResponse,
  TaskResponse,
  TaskSchema,
  todayResponseSchema,
} from '@todoodle/shared/schemas';

// A stateful MSW stand-in for story 8's endpoints (Today, counts?date, reschedule, restore) plus the task
// endpoints the Today view uses (list, create, PATCH, complete/reopen/delete). Responses go through the shared
// zod schemas. Every call is recorded; any operation can fail (a status, or 'network') or wait for a promise.

export type TodayOp = 'today' | 'counts' | 'list' | 'projects' | 'create' | 'patch' | 'complete' | 'reopen' | 'delete' | 'restoreTask' | 'reschedule' | 'restore';
export type TodayCall = { op: TodayOp; id?: string; body?: unknown; url?: string };
type Failure = number | 'network';
type Stored = Task & { deleted: boolean };

const CODES: Record<number, string> = { 400: 'validation', 404: 'not_found', 410: 'gone', 500: 'internal' };
const errorResponse = (status: number) => HttpResponse.json({ error: CODES[status] ?? 'internal', message: 'x' }, { status });

export function todayServer({ tasks: initial = [], projects = [] }: { tasks?: Task[]; projects?: Project[] } = {}) {
  const tasks = new Map<string, Stored>(initial.map((task) => [task.id, { ...task, deleted: false }]));
  const calls: TodayCall[] = [];
  const fail: Partial<Record<TodayOp, Failure>> = {};
  const hold: Partial<Record<TodayOp, Promise<unknown>>> = {};
  /** Ids the next restore reports as changed by someone else. */
  const restoreSkips = new Set<string>();

  const publicTask = ({ deleted: _deleted, ...task }: Stored): Task => TaskSchema.parse(task);
  const project = (id: string | null) => (id ? projects.find((p) => p.id === id) : undefined);
  const live = () => [...tasks.values()].filter((task) => !task.deleted);
  const openDue = (date: string) => live().filter((task) => task.completedAt === null && task.dueDate !== null && task.dueDate <= date);

  async function gate(op: TodayOp) {
    await hold[op];
    const failure = fail[op];
    if (failure === 'network') return HttpResponse.error();
    if (typeof failure === 'number') return errorResponse(failure);
    return null;
  }

  function bump(id: string, patch: Partial<Stored>) {
    const task = tasks.get(id)!;
    tasks.set(id, { ...task, ...patch, version: task.version + 1 });
    return tasks.get(id)!;
  }

  const handlers = [
    http.get('/api/w/:ws/today', async ({ request }) => {
      const url = new URL(request.url);
      calls.push({ op: 'today', url: url.search });
      const blocked = await gate('today');
      if (blocked) return blocked;
      const date = url.searchParams.get('date') ?? '';
      const includeCompleted = url.searchParams.get('includeCompleted') === '1';
      const withProject = (task: Stored) => ({ ...publicTask(task), projectName: project(task.projectId)?.name ?? null, projectColor: project(task.projectId)?.color ?? null });
      const bySort = (a: Task, b: Task) => a.sortOrder - b.sortOrder;
      const open = openDue(date);
      return HttpResponse.json(
        todayResponseSchema.parse({
          date,
          overdue: open.filter((t) => t.dueDate! < date).sort((a, b) => (a.dueDate === b.dueDate ? bySort(a, b) : a.dueDate! < b.dueDate! ? -1 : 1)).map(withProject),
          today: open.filter((t) => t.dueDate === date).sort(bySort).map(withProject),
          completed: includeCompleted ? live().filter((t) => t.completedAt !== null && t.dueDate === date).map(withProject) : [],
        }),
      );
    }),
    http.get('/api/w/:ws/counts', async ({ request }) => {
      const url = new URL(request.url);
      calls.push({ op: 'counts', url: url.search });
      const blocked = await gate('counts');
      if (blocked) return blocked;
      const date = url.searchParams.get('date');
      const inbox = live().filter((t) => t.completedAt === null && t.projectId === null).length;
      return HttpResponse.json(CountsSchema.parse({ inbox, projects: {}, ...(date ? { today: openDue(date).length } : {}) }));
    }),
    http.get('/api/w/:ws/tasks', async ({ request }) => {
      calls.push({ op: 'list', url: new URL(request.url).search });
      const blocked = await gate('list');
      if (blocked) return blocked;
      return HttpResponse.json(TaskListResponse.parse({ tasks: live().filter((t) => t.completedAt === null && t.projectId === null).map(publicTask) }));
    }),
    http.get('/api/w/:ws/projects', () => HttpResponse.json(ProjectListResponse.parse({ projects }))),
    http.post('/api/w/:ws/tasks', async ({ request }) => {
      const body = (await request.json()) as { id: string; name: string; description?: string; projectId?: string | null; dueDate?: string | null };
      calls.push({ op: 'create', body });
      const blocked = await gate('create');
      if (blocked) return blocked;
      const sortOrder = Math.max(0, ...[...tasks.values()].map((t) => t.sortOrder)) + 1;
      const task: Stored = {
        ...TaskSchema.parse({
          id: body.id,
          workspaceId: '0123456789ABCDEF0123456789ABCDEF',
          projectId: body.projectId ?? null,
          name: body.name,
          description: body.description ?? '',
          sortOrder,
          completedAt: null,
          version: 1,
          createdAt: '2026-09-25 09:00:00',
          updatedAt: '2026-09-25 09:00:00',
          dueDate: body.dueDate ?? null,
        }),
        deleted: false,
      };
      tasks.set(task.id, task);
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(task) }), { status: 201 });
    }),
    // Literal paths before /:id/:op.
    http.post('/api/w/:ws/tasks/reschedule', async ({ request }) => {
      const body = (await request.json()) as RescheduleRequest;
      calls.push({ op: 'reschedule', body });
      const blocked = await gate('reschedule');
      if (blocked) return blocked;
      const changed = [];
      const skipped = [];
      for (const id of body.ids) {
        const task = tasks.get(id);
        if (!task || task.deleted || task.completedAt !== null || task.dueDate === null || task.dueDate >= body.to) {
          skipped.push(id);
          continue;
        }
        const updated = bump(id, { dueDate: body.to });
        changed.push({ id, previousDueDate: task.dueDate, dueDate: body.to, version: updated.version });
      }
      return HttpResponse.json({ changed, skipped });
    }),
    http.post('/api/w/:ws/tasks/due-dates/restore', async ({ request }) => {
      const body = (await request.json()) as RestoreDueDatesRequest;
      calls.push({ op: 'restore', body });
      const blocked = await gate('restore');
      if (blocked) return blocked;
      const restored = [];
      const skipped = [];
      for (const item of body.items) {
        const task = tasks.get(item.id);
        if (!task || task.deleted) skipped.push({ id: item.id, reason: 'gone' as const });
        else if (restoreSkips.has(item.id) || task.version !== item.expectedVersion) skipped.push({ id: item.id, reason: 'changed' as const });
        else restored.push({ id: item.id, dueDate: item.dueDate, version: bump(item.id, { dueDate: item.dueDate }).version });
      }
      return HttpResponse.json({ restored, skipped });
    }),
    http.post('/api/w/:ws/tasks/:id/:op', async ({ params }) => {
      const id = String(params.id);
      const op = String(params.op) === 'restore' ? 'restoreTask' : (String(params.op) as 'complete' | 'reopen');
      calls.push({ op, id });
      const blocked = await gate(op);
      if (blocked) return blocked;
      const task = tasks.get(id);
      if (!task) return errorResponse(404);
      if (task.deleted && op !== 'restoreTask') return errorResponse(410);
      const updated =
        op === 'complete'
          ? bump(id, { completedAt: '2026-09-25T10:00:00.000Z' })
          : op === 'reopen'
            ? bump(id, { completedAt: null })
            : bump(id, { deleted: false });
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(updated) }));
    }),
    http.delete('/api/w/:ws/tasks/:id', async ({ params }) => {
      const id = String(params.id);
      calls.push({ op: 'delete', id });
      const blocked = await gate('delete');
      if (blocked) return blocked;
      if (!tasks.has(id)) return errorResponse(404);
      bump(id, { deleted: true });
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/w/:ws/tasks/:id', async ({ params, request }) => {
      const id = String(params.id);
      const body = (await request.json()) as Partial<Task>;
      calls.push({ op: 'patch', id, body });
      const blocked = await gate('patch');
      if (blocked) return blocked;
      const task = tasks.get(id);
      if (!task) return errorResponse(404);
      if (task.deleted) return errorResponse(410);
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(bump(id, body)) }));
    }),
  ];

  return {
    tasks,
    calls,
    fail,
    hold,
    restoreSkips,
    handlers,
    callsOf: (op: TodayOp) => calls.filter((call) => call.op === op),
    never: () => delay('infinite'),
    /** A collaborator's change, straight into the store (no request from this tab). */
    change(id: string, patch: Partial<Stored>) {
      return publicTask(bump(id, patch));
    },
  };
}

export type TodayServer = ReturnType<typeof todayServer>;
