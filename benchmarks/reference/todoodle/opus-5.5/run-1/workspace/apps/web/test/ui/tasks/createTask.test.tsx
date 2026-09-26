import { act, screen, waitFor, within } from '@testing-library/react';
import { CREATE_TASK_TIMEOUT_MS } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import { describe, expect, it, vi } from 'vitest';
import { registerLiveHandler } from '@/features/live/registry';
import { queryClient } from '@/lib/queryClient';
import { makeTask, makeTasks } from '../../msw/tasks.ts';
import { gate, recordRequests } from '../../support/fixtures.ts';
import { startLiveServer, useHealth } from '../../support/live.ts';
import { ID, INBOX_KEY, enterInbox, inboxCount, rowNames, rows } from '../../support/tasks.tsx';

const POST = `POST /api/w/${ID}/tasks`;

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Task name' });
}

function addTaskButton(): HTMLElement {
  return screen.getAllByRole('button', { name: 'Add task' }).find((button) => !button.hasAttribute('data-fab'))!;
}

async function openAndAdd(user: Awaited<ReturnType<typeof enterInbox>>['user'], name: string) {
  if (!screen.queryByRole('form', { name: 'Add task' })) await user.click(addTaskButton());
  await user.type(nameField(), `${name}{Enter}`);
}

function row(name: string): HTMLElement {
  return rows().find((item) => item.textContent?.includes(name))!;
}

describe('tasks.client_cache: failures keep the text', () => {
  it("TC-65 a network error: the row is failed, 'Couldn't save this task.' in role=alert, Retry and Discard, text visible", async () => {
    // A network failure also flips the app offline (story 4); the health probe brings it back.
    useHealth(true);
    const { user } = await enterInbox({ create: ['network'] });
    await openAndAdd(user, 'Buy milk');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save this task.");
    const failed = row('Buy milk');
    expect(failed).toContainElement(alert);
    expect(failed).toHaveAttribute('data-local-status', 'failed');
    expect(within(failed).getByText('Buy milk')).toBeVisible();
    expect(within(failed).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('TC-66 500 then 201: Retry sends the SAME id; the row is saved; exactly one row', async () => {
    const bodies: Array<{ id: string; name: string }> = [];
    const { user } = await enterInbox({ create: [500, 201], bodies });
    await openAndAdd(user, 'Buy milk');
    await screen.findByRole('alert');
    await user.click(within(row('Buy milk')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(row('Buy milk')).not.toHaveAttribute('data-local-status'));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(rowNames()).toEqual(['Buy milk']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('TC-67 Discard removes the failed row, sends nothing, and the count is back where it was', async () => {
    const { user } = await enterInbox({ tasks: makeTasks(2), create: [500] });
    await waitFor(() => expect(inboxCount()).toBe(2));
    await openAndAdd(user, 'Doomed');
    await screen.findByRole('alert');
    const seen = recordRequests();
    await user.click(within(row('Doomed')).getByRole('button', { name: 'Discard' }));
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411']);
    expect(inboxCount()).toBe(2);
    expect(seen).toEqual([]);
  });

  it("TC-68 a 400: the row is rejected, text visible, Discard only (no Retry), 'This task can't be saved.'", async () => {
    const { user } = await enterInbox({ create: [400] });
    await openAndAdd(user, 'Buy milk');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This task can't be saved.");
    const rejected = row('Buy milk');
    expect(rejected).toHaveAttribute('data-local-status', 'rejected');
    expect(within(rejected).getByText('Buy milk')).toBeVisible();
    expect(within(rejected).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(rejected).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it.each([[409], [410]] as const)('a %s is rejected too', async (status) => {
    const { user } = await enterInbox({ create: [status] });
    await openAndAdd(user, 'Buy milk');
    await screen.findByRole('alert');
    expect(row('Buy milk')).toHaveAttribute('data-local-status', 'rejected');
  });
});

describe('tasks.client_cache: optimistic display', () => {
  it('TC-69 with a slow response the row and the count show before it answers', async () => {
    const hold = gate();
    const { user } = await enterInbox({ counts: { inbox: 0 }, createUntil: hold.promise });
    await waitFor(() => expect(inboxCount()).toBe(0));
    await openAndAdd(user, 'Buy milk');
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk']));
    expect(inboxCount()).toBe(1);
    expect(row('Buy milk')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inbox, 1 open task' })).toBeInTheDocument());
    hold.release();
    await waitFor(() => expect(row('Buy milk')).not.toHaveAttribute('aria-busy'));
    expect(inboxCount()).toBe(1);
  });

  it('TC-70 a request that never answers fails once CREATE_TASK_TIMEOUT_MS passes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useHealth(true);
    const { user } = await enterInbox({ create: ['never'] });
    await openAndAdd(user, 'Buy milk');
    await waitFor(() => expect(row('Buy milk')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => {
      vi.advanceTimersByTime(CREATE_TASK_TIMEOUT_MS - 100);
    });
    expect(row('Buy milk')).toHaveAttribute('data-local-status', 'pending');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(row('Buy milk')).toHaveAttribute('data-local-status', 'failed'));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save this task.");
  });

  it('TC-71 count 3: a failure puts it back to 3; a successful Retry makes it 4', async () => {
    const { user } = await enterInbox({ tasks: makeTasks(3), create: [500, 201] });
    await waitFor(() => expect(inboxCount()).toBe(3));
    await openAndAdd(user, 'Fourth');
    await screen.findByRole('alert');
    expect(inboxCount()).toBe(3);
    await user.click(within(row('Fourth')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(row('Fourth')).not.toHaveAttribute('data-local-status'));
    expect(inboxCount()).toBe(4);
  });

  it('TC-123 a pending row is aria-busy; after the failure the message is inside role=alert', async () => {
    const hold = gate();
    const { user } = await enterInbox({ create: [500], createUntil: hold.promise });
    await openAndAdd(user, 'Buy milk');
    await waitFor(() => expect(row('Buy milk')).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByRole('alert')).toBeNull();
    hold.release();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save this task.");
    expect(row('Buy milk')).not.toHaveAttribute('aria-busy');
  });

  it('a refetch while a row is failed keeps the unsaved row', async () => {
    const { user } = await enterInbox({ tasks: makeTasks(1), create: [500] });
    await openAndAdd(user, 'Unsaved');
    await screen.findByRole('alert');
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: INBOX_KEY });
    });
    expect(rowNames()).toEqual(['Buy milk', 'Unsaved']);
  });
});

describe('tasks.client_cache: live upserts', () => {
  it('TC-124 the tasks handler coexists with another task.upserted handler: both run, and the task appears', async () => {
    const live = startLiveServer();
    const other = vi.fn(() => false);
    const unregister = registerLiveHandler('task.upserted', other);
    await enterInbox({ tasks: makeTasks(1) });
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk']));
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    const task = makeTask({ name: 'Added by Sam', sortOrder: 2 });
    const event: LiveEvent = { type: 'task.upserted', entity: task, version: 1, originClientId: null };
    live.emit(event);
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Added by Sam']));
    expect(other).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(inboxCount()).toBe(2));
    unregister();
  });
});
