import { CREATE_TASK_TIMEOUT_MS } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import type { Counts } from '@todoodle/shared/schemas';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { dispatchEvent } from '@/features/live/dispatch';
import { registerLiveHandler } from '@/features/live/registry';
import { InboxView } from '@/features/tasks/InboxView';
import { registerTaskHandlers } from '@/features/tasks/liveHandlers';
import type { LocalTask } from '@/features/tasks/localTask';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';
import { deferred } from '../../render';
import { server } from '../../msw';
import { TASK_WS_ID, task, taskFromBody, taskHandlers } from '../../msw/tasks';
import { renderWithProviders } from '../helpers';

type Respond = (body: unknown, attempt: number) => Response | Promise<Response>;

/** Renders the Inbox (count `inbox`) with a create endpoint answered by `respond`; returns the POSTed bodies. */
async function renderInbox(respond: Respond, { inbox = 0 } = {}) {
  const bodies: unknown[] = [];
  server.use(
    taskHandlers.list([]),
    taskHandlers.counts(inbox),
    http.post('/api/w/:id/tasks', async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return respond(body, bodies.length);
    }),
  );
  await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit />);
  await screen.findByText('Your Inbox is clear. Press Q to add a task.');
  await act(() => queryClient.fetchQuery({ queryKey: qk.counts(TASK_WS_ID), queryFn: () => ({ inbox }) }));
  return bodies;
}

const created: Respond = (body) => HttpResponse.json({ task: taskFromBody(body, 1) }, { status: 201 });
const serverError: Respond = () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 });

function add(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  const field = screen.getByRole('textbox', { name: 'Task name' });
  act(() => {
    fireEvent.change(field, { target: { value: name } });
  });
  act(() => {
    fireEvent.keyDown(field, { key: 'Enter' });
  });
}

const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
/** Rows render on the next animation frame (query notifications are batched per frame). */
const findRow = (name: string) => screen.findByRole('option', { name: new RegExp(name) });
const inboxCount = () => queryClient.getQueryData<Counts>(qk.counts(TASK_WS_ID))?.inbox;
const cachedTasks = () => queryClient.getQueryData<LocalTask[]>(qk.tasks(TASK_WS_ID, { list: 'inbox' })) ?? [];

describe('useCreateTask', () => {
  it('TC-65 a network error leaves the row failed: message in role=alert, Retry and Discard, text visible', async () => {
    await renderInbox(() => HttpResponse.error());
    add('Buy milk');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save this task.");
    const failed = row('Buy milk');
    expect(failed).toContainElement(alert);
    expect(within(failed).getByText('Buy milk')).toBeVisible();
    expect(within(failed).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(failed).not.toHaveAttribute('aria-busy');
  });

  it('TC-66 500 then 201: Retry sends the SAME id and body; the row is saved; exactly one row', async () => {
    const bodies = await renderInbox((body, attempt) => (attempt === 1 ? serverError(body, attempt) : created(body, attempt)));
    add('Buy milk');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    await expect.poll(() => screen.queryByRole('alert')).toBeNull();
    await expect.poll(() => cachedTasks()[0]?.localStatus).toBeUndefined();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(cachedTasks()).toEqual([expect.objectContaining({ name: 'Buy milk', version: 1 })]);
  });

  it('TC-67 Discard removes the failed row with no request; the count is back to before', async () => {
    const bodies = await renderInbox(serverError, { inbox: 2 });
    add('Buy milk');
    const discard = await screen.findByRole('button', { name: 'Discard' });
    expect(inboxCount()).toBe(2);
    fireEvent.click(discard);
    await expect.poll(() => screen.queryByRole('option', { name: /Buy milk/ })).toBeNull();
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(bodies).toHaveLength(1);
    expect(inboxCount()).toBe(2);
    expect(cachedTasks()).toEqual([]);
  });

  it('TC-68 400: the row is rejected: text kept, Discard shown, no Retry', async () => {
    await renderInbox(() => HttpResponse.json({ error: 'validation', message: 'x' }, { status: 400 }));
    add('Buy milk');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This task can't be saved.");
    const rejected = row('Buy milk');
    expect(within(rejected).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(rejected).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it.each([409, 410])('%s is rejected too', async (status) => {
    await renderInbox(() => HttpResponse.json({ error: 'x', message: 'x' }, { status }));
    add('Buy milk');
    expect(await screen.findByRole('alert')).toHaveTextContent("This task can't be saved.");
  });

  it.each([403, 404, 503])('%s is failed (retryable)', async (status) => {
    await renderInbox(() => HttpResponse.json({ error: 'x', message: 'x' }, { status }));
    add('Buy milk');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save this task.");
  });

  it('TC-69 the row and the count show before the response arrives', async () => {
    const gate = deferred();
    await renderInbox(async (body, attempt) => {
      await gate.promise;
      return created(body, attempt);
    }, { inbox: 1 });
    add('Buy milk');
    expect(inboxCount()).toBe(2);
    expect(await findRow('Buy milk')).toHaveAttribute('aria-busy', 'true');
    gate.resolve();
    await expect.poll(() => cachedTasks()[0]?.localStatus).toBeUndefined();
    expect(inboxCount()).toBe(2);
  });

  it('TC-70 no answer within CREATE_TASK_TIMEOUT_MS: the row becomes failed', async () => {
    await renderInbox(() => new Promise<Response>(() => {}));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    add('Buy milk');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(row('Buy milk')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CREATE_TASK_TIMEOUT_MS - 51);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    vi.useRealTimers();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save this task.");
  });

  it('TC-71 count 3: failure leaves 3, a successful retry makes 4', async () => {
    await renderInbox((body, attempt) => (attempt === 1 ? serverError(body, attempt) : created(body, attempt)), { inbox: 3 });
    add('Buy milk');
    expect(inboxCount()).toBe(4);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(inboxCount()).toBe(3);
    fireEvent.click(retry);
    expect(inboxCount()).toBe(4);
    await expect.poll(() => screen.queryByRole('alert')).toBeNull();
    await expect.poll(() => cachedTasks()[0]?.localStatus).toBeUndefined();
    expect(inboxCount()).toBe(4);
  });

  it('TC-123 a saving row is aria-busy; after failure the message is in role=alert', async () => {
    const gate = deferred();
    await renderInbox(async () => {
      await gate.promise;
      return serverError(null, 1);
    });
    add('Buy milk');
    expect(await findRow('Buy milk')).toHaveAttribute('aria-busy', 'true');
    gate.resolve();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save this task.");
    expect(row('Buy milk')).not.toHaveAttribute('aria-busy');
  });

  it('TC-124 the tasks live handler coexists with another task.upserted handler; both run', async () => {
    const other = vi.fn(() => 'stale' as const);
    const offOther = registerLiveHandler('task.upserted', other);
    const offTasks = registerTaskHandlers();
    try {
      const existing = task({ name: 'Buy milk', sortOrder: 1 });
      queryClient.setQueryData(qk.tasks(TASK_WS_ID, { list: 'inbox' }), [existing]);
      queryClient.setQueryData(qk.counts(TASK_WS_ID), { inbox: 1 });
      const incoming = task({ name: 'Call Mum 📞', sortOrder: 2 });
      const event: LiveEvent = { type: 'task.upserted', entity: incoming, version: 1, originClientId: null };
      expect(dispatchEvent({ queryClient, workspaceId: TASK_WS_ID }, event)).toBe('applied');
      expect(other).toHaveBeenCalledTimes(1);
      expect(cachedTasks().map((t) => t.name)).toEqual(['Buy milk', 'Call Mum 📞']);
      expect(inboxCount()).toBe(2);
      // A replayed (same-version) event changes nothing.
      expect(dispatchEvent({ queryClient, workspaceId: TASK_WS_ID }, event)).toBe('stale');
      expect(other).toHaveBeenCalledTimes(2);
      expect(inboxCount()).toBe(2);
    } finally {
      offTasks();
      offOther();
    }
  });
});
