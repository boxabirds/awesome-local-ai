import { act, screen, waitFor, within } from '@testing-library/react';
import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../../msw.ts';
import { makeProject } from '../../msw/projects.ts';
import { todayServer } from '../../msw/todayServer.ts';
import { SECRET } from '../../support/fixtures.ts';
import { toastWith } from '../../support/tasks.tsx';
import { ID, TODAY, dated, enterToday, namesOf, overdueRows, todayNav, todayRows, useFriday } from '../../support/today.tsx';

// Story 8, ui.today_view: the Today view on Fri 2026-09-25 (fake clock, en-GB) with a stateful MSW server.

afterEach(() => vi.useRealTimers());

const WORK = makeProject({ name: 'Work', color: 'red' }, 0);

function fiveTasks() {
  return [
    dated('Renew passport', '2026-09-20', 0),
    dated('Pay council tax', '2026-09-24', 1, { projectId: WORK.id }),
    dated('Buy milk', TODAY, 2),
    dated('Send the report', TODAY, 3, { projectId: WORK.id }),
    dated('Water the plants', TODAY, 4),
    dated('Next week', '2026-09-28', 5),
    dated('Undated', null, 6),
  ];
}

function overdueHeading() {
  return screen.queryByRole('heading', { name: /^Overdue/, level: 2 });
}

describe('ui.today_view: groups', () => {
  it('TC-70 Overdue (with its icon and count) above Today; each row shows its project or Inbox', async () => {
    useFriday();
    const api = todayServer({ tasks: fiveTasks(), projects: [WORK] });
    await enterToday(api);
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk', 'Send the report', 'Water the plants']));
    expect(namesOf(overdueRows())).toEqual(['Renew passport', 'Pay council tax']);
    const overdue = overdueHeading()!;
    expect(overdue.querySelector('[data-overdue-icon]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(overdue).getByText('2')).toBeInTheDocument();
    const today = screen.getByRole('heading', { name: 'Today · Fri 25 Sep', level: 2 });
    expect(overdue.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const tags = [...overdueRows(), ...todayRows()].map((row) => row.querySelector('[data-project-tag]')!);
    expect(tags.map((tag) => tag.textContent)).toEqual(['Inbox', 'Work', 'Inbox', 'Work', 'Inbox']);
    expect(tags[1]!.querySelector('[data-project-dot]')).toHaveAttribute('data-project-dot', 'red');
    expect(within(overdueRows()[0]!).getByText('5 days overdue')).toBeInTheDocument();
    expect(within(overdueRows()[1]!).getByText('Yesterday')).toBeInTheDocument();
    expect(api.callsOf('today').map((c) => c.url)).toContain(`?date=${TODAY}`);
  });

  it("TC-71 nothing due: 'All clear for today', no Overdue heading, no Reschedule", async () => {
    useFriday();
    await enterToday(todayServer({ tasks: [dated('Next week', '2026-09-28', 0), dated('Undated', null, 1)] }));
    expect(await screen.findByText('All clear for today')).toBeInTheDocument();
    expect(overdueHeading()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  it('TC-72 only today tasks: no Overdue group and no Reschedule', async () => {
    useFriday();
    await enterToday(todayServer({ tasks: [dated('Buy milk', TODAY, 0)] }));
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk']));
    expect(overdueHeading()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  it('TC-121 with 50 rows every row carries row-cv (content-visibility), and no section or list does', async () => {
    useFriday();
    const tasks = Array.from({ length: 50 }, (_, i) => dated(`Task ${i + 1}`, i < 20 ? '2026-09-24' : TODAY, i));
    await enterToday(todayServer({ tasks }));
    await waitFor(() => expect(overdueRows().length + todayRows().length).toBe(50));
    for (const row of [...overdueRows(), ...todayRows()]) expect(row).toHaveClass('row-cv');
    for (const container of document.querySelectorAll('[data-today-section], [role="listbox"], main')) expect(container).not.toHaveClass('row-cv');
  });

  it("TC-122 the tab title: '(5) Today · My Todoodle', then 'Today · My Todoodle' at 0; the secret in the address never appears", async () => {
    useFriday();
    const tasks = fiveTasks();
    const api = todayServer({ tasks, projects: [WORK] });
    await enterToday(api, `/w/${ID}/today#${SECRET}`);
    await waitFor(() => expect(document.title).toBe('(5) Today · My Todoodle'));
    for (const task of tasks) api.tasks.delete(task.id);
    await act(async () => queryClient.invalidateQueries({ queryKey: queryKeys.counts(ID) }));
    await waitFor(() => expect(document.title).toBe('Today · My Todoodle'));
    expect(document.title).not.toContain(SECRET);
  });
});

describe('ui.today_view: reschedule', () => {
  it('TC-73 2 overdue: Reschedule, confirm Move -> the rows move to Today at once; the body is the displayed ids and the local date; Undo offered', async () => {
    useFriday();
    const api = todayServer({ tasks: fiveTasks(), projects: [WORK] });
    const { user } = await enterToday(api);
    await waitFor(() => expect(overdueRows()).toHaveLength(2));
    const shown = overdueRows().map((row) => row.dataset.taskId);
    let release!: () => void;
    api.hold.reschedule = new Promise<void>((resolve) => (release = resolve));
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Move 2 overdue tasks to today?');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    // Optimistic: already in Today while the request is in flight.
    await waitFor(() => expect(overdueRows()).toEqual([]));
    expect(namesOf(todayRows())).toEqual(['Renew passport', 'Pay council tax', 'Buy milk', 'Send the report', 'Water the plants']);
    expect(api.callsOf('reschedule')).toEqual([{ op: 'reschedule', body: { ids: shown, to: TODAY } }]);
    release();
    await waitFor(() => expect(toastWith('2 tasks rescheduled to today')).not.toBeNull());
    expect(within(toastWith('2 tasks rescheduled to today')!).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it("TC-74 the server fails (500): the rows go back to Overdue and 'Couldn't reschedule — try again' shows", async () => {
    useFriday();
    const api = todayServer({ tasks: fiveTasks(), projects: [WORK] });
    api.fail.reschedule = 500;
    const { user } = await enterToday(api);
    await waitFor(() => expect(overdueRows()).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(toastWith("Couldn't reschedule — try again")).not.toBeNull());
    expect(toastWith("Couldn't reschedule — try again")).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(namesOf(overdueRows())).toEqual(['Renew passport', 'Pay council tax']));
    expect(namesOf(todayRows())).toEqual(['Buy milk', 'Send the report', 'Water the plants']);
  });

  it('TC-116 exactly one overdue task: no dialog, the request goes at once, Undo offered', async () => {
    useFriday();
    const task = dated('Renew passport', '2026-09-20', 0);
    const api = todayServer({ tasks: [task] });
    const { user } = await enterToday(api);
    await waitFor(() => expect(overdueRows()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Reschedule' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(api.callsOf('reschedule')).toEqual([{ op: 'reschedule', body: { ids: [task.id], to: TODAY } }]));
    await waitFor(() => expect(toastWith('1 task rescheduled to today')).not.toBeNull());
    expect(namesOf(todayRows())).toEqual(['Renew passport']);
  });

  it("TC-117 7 overdue: 'Move 7 overdue tasks to today?'; Cancel and Escape send nothing and change nothing; Move sends one request with the 7 ids", async () => {
    useFriday();
    const tasks = Array.from({ length: 7 }, (_, i) => dated(`Overdue ${i + 1}`, `2026-09-${String(10 + i).padStart(2, '0')}`, i));
    const api = todayServer({ tasks });
    const { user } = await enterToday(api);
    await waitFor(() => expect(overdueRows()).toHaveLength(7));
    const before = namesOf(overdueRows());
    const button = screen.getByRole('button', { name: 'Reschedule' });

    await user.click(button);
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Move 7 overdue tasks to today?');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.callsOf('reschedule')).toEqual([]);
    expect(namesOf(overdueRows())).toEqual(before);
    await waitFor(() => expect(button).toHaveFocus());

    await user.click(button);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.callsOf('reschedule')).toEqual([]);
    expect(namesOf(overdueRows())).toEqual(before);

    await user.click(button);
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(api.callsOf('reschedule')).toHaveLength(1));
    expect(api.callsOf('reschedule')[0]!.body).toEqual({ ids: tasks.map((t) => t.id), to: TODAY });
  });
});

describe('ui.today_view: undo', () => {
  async function rescheduleThree() {
    useFriday({ timers: true });
    const tasks = [dated('Renew passport', '2026-09-20', 0), dated('Pay council tax', '2026-09-22', 1), dated('Book dentist', '2026-09-24', 2)];
    const api = todayServer({ tasks });
    const rendered = await enterToday(api);
    await waitFor(() => expect(overdueRows()).toHaveLength(3));
    await rendered.user.click(screen.getByRole('button', { name: 'Reschedule' }));
    await rendered.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move' }));
    const toast = await waitFor(() => {
      const found = toastWith('3 tasks rescheduled to today');
      expect(found).not.toBeNull();
      return found!;
    });
    return { ...rendered, api, tasks, toast };
  }

  it("TC-75 Undo with 1 of 3 changed by someone else: the others go back; '1 task was changed by someone else and was not restored'", async () => {
    const { user, api, tasks, toast } = await rescheduleThree();
    api.restoreSkips.add(tasks[1]!.id);
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toastWith('1 task was changed by someone else and was not restored')).not.toBeNull());
    expect(api.callsOf('restore')[0]!.body).toEqual({
      items: [
        { id: tasks[0]!.id, dueDate: '2026-09-20', expectedVersion: 2 },
        { id: tasks[1]!.id, dueDate: '2026-09-22', expectedVersion: 2 },
        { id: tasks[2]!.id, dueDate: '2026-09-24', expectedVersion: 2 },
      ],
    });
    // Today is refetched: the skipped one stays today, the others are overdue again.
    await waitFor(() => expect(namesOf(overdueRows())).toEqual(['Renew passport', 'Book dentist']));
    expect(namesOf(todayRows())).toEqual(['Pay council tax']);
  });

  it('TC-76 the undo window ends after UNDO_WINDOW_MS (10,000 ms) with no hover or focus: the toast goes, no restore is ever sent', async () => {
    const { api } = await rescheduleThree();
    expect(UNDO_WINDOW_MS).toBe(10_000);
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 100));
    expect(toastWith('3 tasks rescheduled to today')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(200));
    await waitFor(() => expect(toastWith('3 tasks rescheduled to today')).toBeNull());
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(api.callsOf('restore')).toEqual([]);
  });

  it('TC-119 hovering pauses the window (15 s), leaving resumes it (gone 10 s later); the toast is role=status', async () => {
    const { user, api, toast } = await rescheduleThree();
    expect(toast).toHaveAttribute('role', 'status');
    await user.hover(toast);
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(toastWith('3 tasks rescheduled to today')).not.toBeNull();
    await user.unhover(toast);
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 200));
    expect(toastWith('3 tasks rescheduled to today')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    await waitFor(() => expect(toastWith('3 tasks rescheduled to today')).toBeNull());
    expect(api.callsOf('restore')).toEqual([]);
  });

  it('TC-119 Cmd/Ctrl+Z while the toast is up sends exactly one restore', async () => {
    const { user, api, tasks } = await rescheduleThree();
    (document.activeElement as HTMLElement | null)?.blur();
    const mac = /mac/i.test(navigator.platform);
    await user.keyboard(mac ? '{Meta>}z{/Meta}' : '{Control>}z{/Control}');
    await waitFor(() => expect(api.callsOf('restore')).toHaveLength(1));
    await user.keyboard(mac ? '{Meta>}z{/Meta}' : '{Control>}z{/Control}');
    await waitFor(() => expect(namesOf(overdueRows())).toEqual(tasks.map((t) => t.name)));
    expect(api.callsOf('restore')).toHaveLength(1);
    await waitFor(() => expect(toastWith('Due dates restored')).not.toBeNull());
  });
});

describe('ui.today_view: quick add', () => {
  it('TC-77 Pay rent: POST with a client id, dueDate = the local date, no project; the row shows in Today', async () => {
    useFriday();
    const api = todayServer({ tasks: [dated('Buy milk', TODAY, 0)] });
    const { user } = await enterToday(api);
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk']));
    await user.keyboard('q');
    const form = await screen.findByRole('form', { name: 'Add task' });
    expect(within(form).getByText('→ Inbox')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Due date: Today' })).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Task name' }), 'Pay rent{Enter}');
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk', 'Pay rent']));
    const body = api.callsOf('create')[0]!.body as Record<string, unknown>;
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Pay rent', description: '', dueDate: TODAY });
    expect(body.projectId ?? null).toBeNull();
    expect(toastWith('Added to Inbox')).toBeNull();
  });

  it("TC-78 with Tomorrow picked: dueDate tomorrow, not shown in Today, toast 'Added to Inbox'", async () => {
    useFriday();
    const api = todayServer({ tasks: [dated('Buy milk', TODAY, 0)] });
    const { user } = await enterToday(api);
    await waitFor(() => expect(namesOf(todayRows())).toEqual(['Buy milk']));
    await user.keyboard('q');
    const form = await screen.findByRole('form', { name: 'Add task' });
    await user.type(within(form).getByRole('textbox', { name: 'Task name' }), 'Pay rent');
    await user.click(within(form).getByRole('button', { name: 'Due date: Today' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Due date' })).getByText('Tomorrow · Sat 26 Sep'));
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.callsOf('create')).toHaveLength(1));
    expect(api.callsOf('create')[0]!.body).toMatchObject({ name: 'Pay rent', dueDate: '2026-09-26' });
    await waitFor(() => expect(toastWith('Added to Inbox')).not.toBeNull());
    expect(namesOf(todayRows())).toEqual(['Buy milk']);
  });
});

describe('ui.today_view: sidebar badge', () => {
  it('TC-79 the Today badge: 5, hidden at 0, hidden when counts fail (navigation still works); exactly one counts request, no separate Today count', async () => {
    useFriday();
    const tasks = fiveTasks();
    const api = todayServer({ tasks, projects: [WORK] });
    const { user } = await enterToday(api, `/w/${ID}`, 'Inbox');
    await waitFor(() => expect(todayNav()).toHaveAccessibleName('Today, 5 open tasks'));
    expect(todayNav().querySelector('[data-today-badge]')).toHaveTextContent('5');
    expect(api.callsOf('counts')).toHaveLength(1);
    expect(api.callsOf('counts')[0]!.url).toBe(`?date=${TODAY}`);
    expect(api.callsOf('today')).toEqual([]);

    for (const task of tasks) api.tasks.delete(task.id);
    await act(async () => queryClient.invalidateQueries({ queryKey: queryKeys.counts(ID) }));
    await waitFor(() => expect(todayNav()).toHaveAccessibleName('Today'));
    expect(todayNav().querySelector('[data-today-badge]')).toBeEmptyDOMElement();

    queryClient.removeQueries({ queryKey: queryKeys.counts(ID) });
    server.use(http.get('/api/w/:ws/counts', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })));
    await act(async () => queryClient.prefetchQuery({ queryKey: queryKeys.counts(ID) }));
    expect(todayNav().querySelector('[data-today-badge]')).toBeEmptyDOMElement();
    await user.click(todayNav());
    expect(await screen.findByRole('heading', { name: 'Today', level: 1 })).toBeInTheDocument();
  });
});
