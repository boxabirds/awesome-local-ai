import { http, HttpResponse, delay } from 'msw';
import { CountsSchema, type Task, TaskListResponse, TaskResponse, TaskSchema, orderTasks } from '@todoodle/shared/schemas';

// A stateful MSW stand-in for story 6's task endpoints (list with include_completed, complete, reopen,
// restore, delete, PATCH). Bodies go through the shared zod schemas. Each call is recorded; any operation
// can be made to fail (a status, or 'network') or to wait for a promise.

export type TaskOp = 'complete' | 'reopen' | 'restore' | 'delete' | 'patch';
export type Call = { op: TaskOp | 'list'; id?: string; body?: unknown; url?: string; headers?: Record<string, string> };
type Failure = number | 'network';

type Stored = Task & { deleted: boolean };

const CODES: Record<number, string> = { 400: 'validation', 404: 'not_found', 410: 'gone', 500: 'internal', 403: 'forbidden_client' };

function errorResponse(status: number) {
  return HttpResponse.json({ error: CODES[status] ?? 'internal', message: 'x' }, { status });
}

export function taskServer(initial: Task[]) {
  const tasks = new Map<string, Stored>(initial.map((task) => [task.id, { ...task, deleted: false }]));
  const calls: Call[] = [];
  const fail: Partial<Record<TaskOp | 'list', Failure>> = {};
  const hold: Partial<Record<TaskOp | 'list', Promise<unknown>>> = {};

  const publicTask = ({ deleted: _deleted, ...task }: Stored): Task => TaskSchema.parse(task);
  const visible = (includeCompleted: boolean) =>
    orderTasks([...tasks.values()].filter((task) => !task.deleted && (includeCompleted || task.completedAt === null))).map(publicTask);

  async function gate(op: TaskOp | 'list') {
    await hold[op];
    const failure = fail[op];
    if (failure === 'network') return HttpResponse.error();
    if (typeof failure === 'number') return errorResponse(failure);
    return null;
  }

  function mutate(id: string, change: (task: Stored) => Partial<Stored> | null) {
    const task = tasks.get(id);
    if (!task) return null;
    const patch = change(task);
    if (patch) tasks.set(id, { ...task, ...patch, version: task.version + 1, updatedAt: new Date().toISOString() });
    return tasks.get(id)!;
  }

  const handlers = [
    http.get('/api/w/:ws/tasks', async ({ request }) => {
      const url = new URL(request.url);
      calls.push({ op: 'list', url: url.search });
      const blocked = await gate('list');
      if (blocked) return blocked;
      const includeCompleted = url.searchParams.get('include_completed') === 'true';
      return HttpResponse.json(TaskListResponse.parse({ tasks: visible(includeCompleted) }));
    }),
    http.get('/api/w/:ws/counts', () => HttpResponse.json(CountsSchema.parse({ inbox: visible(false).length }))),
    http.post('/api/w/:ws/tasks/:id/:op', async ({ params, request }) => {
      const op = String(params.op) as 'complete' | 'reopen' | 'restore';
      const id = String(params.id);
      calls.push({ op, id, headers: Object.fromEntries(request.headers) });
      const blocked = await gate(op);
      if (blocked) return blocked;
      const current = tasks.get(id);
      if (!current) return errorResponse(404);
      if (current.deleted && op !== 'restore') return errorResponse(410);
      const updated = mutate(id, (task) => {
        if (op === 'complete') return task.completedAt === null ? { completedAt: new Date().toISOString() } : null;
        if (op === 'reopen') return task.completedAt !== null ? { completedAt: null } : null;
        return task.deleted ? { deleted: false } : null;
      })!;
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(updated) }));
    }),
    http.delete('/api/w/:ws/tasks/:id', async ({ params }) => {
      const id = String(params.id);
      calls.push({ op: 'delete', id });
      const blocked = await gate('delete');
      if (blocked) return blocked;
      if (!tasks.has(id)) return errorResponse(404);
      mutate(id, (task) => (task.deleted ? null : { deleted: true }));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/w/:ws/tasks/:id', async ({ params, request }) => {
      const id = String(params.id);
      const body = (await request.json()) as { name?: string; description?: string };
      calls.push({ op: 'patch', id, body });
      const blocked = await gate('patch');
      if (blocked) return blocked;
      const current = tasks.get(id);
      if (!current) return errorResponse(404);
      if (current.deleted) return errorResponse(410);
      const name = body.name?.trim() ? body.name.trim() : current.name;
      const description = body.description === undefined ? current.description : body.description.trim();
      const updated = mutate(id, () => (name === current.name && description === current.description ? null : { name, description }))!;
      return HttpResponse.json(TaskResponse.parse({ task: publicTask(updated) }));
    }),
  ];

  return {
    tasks,
    calls,
    fail,
    hold,
    handlers,
    /** Calls of one operation. */
    callsOf: (op: TaskOp | 'list') => calls.filter((call) => call.op === op),
    /** A response that never arrives (to observe pending states). */
    never: () => delay('infinite'),
  };
}

export type TaskServer = ReturnType<typeof taskServer>;
