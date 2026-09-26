import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { LiveEvent } from '@todoodle/shared/events';
import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import type { Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { makeProject } from '../../msw/projects.ts';
import { projectServer } from '../../msw/projectServer.ts';
import { makeTask } from '../../msw/tasks.ts';
import { ID, enterWithProjects, projectLink, projectMenu, projectsPath, sidebar, sidebarProjectNames } from '../../support/projects.tsx';
import { startLiveServer } from '../../support/live.ts';
import { currentLocation } from '../../support/render.tsx';
import { rowNamed, rowNames, rows, setReducedMotion, setViewport, toastWith } from '../../support/tasks.tsx';

// Story 7, task 16: the project view, delete with confirmation and Undo, Move to… (menu and M), and live
// project events (a fake emitter dispatching through the REAL live registry). Network through MSW.

afterEach(() => vi.useRealTimers());

const WORK = makeProject({ name: 'Work' }, 0);
const WOODWORK = makeProject({ name: 'Woodwork' }, 1);
const HOME = makeProject({ name: 'Home' }, 2);

function tasksIn(projectId: string | null, names: string[], offset = 0, completed = 0): Task[] {
  return names.map((name, i) =>
    makeTask({ name, projectId, completedAt: i >= names.length - completed ? '2026-09-24T17:30:00.000Z' : null }, offset + i),
  );
}

async function openDelete(user: { click: (el: Element) => Promise<void> }, name: string) {
  await user.click(projectMenu(name));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  return screen.findByRole('alertdialog');
}

describe('projects.ui_project_view', () => {
  it("TC-61 an empty project: 'No tasks yet. Press Q to add one.'; quick add POSTs its projectId; the chip reads '→ Work'", async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api, projectsPath(WORK.id), 'Work');
    expect(await screen.findByText('No tasks yet. Press Q to add one.')).toBeInTheDocument();
    await user.keyboard('q');
    const form = await screen.findByRole('form', { name: 'Add task' });
    expect(within(form).getByText('→ Work')).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Task name' }), 'Draft Q3 plan{Enter}');
    await waitFor(() => expect(api.callsOf('createTask')).toHaveLength(1));
    expect(api.callsOf('createTask')[0]!.body).toMatchObject({ name: 'Draft Q3 plan', projectId: WORK.id });
    await waitFor(() => expect(rowNames()).toEqual(['Draft Q3 plan']));
    await waitFor(() => expect(projectLink('Work')).toHaveAccessibleName('Work, 1 open task'));
  });

  it('shows only the project’s tasks, with its colour dot and name in the header', async () => {
    const api = projectServer({
      projects: [WORK, HOME],
      tasks: [...tasksIn(null, ['Buy milk']), ...tasksIn(WORK.id, ['Draft Q3 plan', 'Book room'], 1), ...tasksIn(HOME.id, ['Fix the bike light'], 3)],
    });
    await enterWithProjects(api, projectsPath(WORK.id), 'Work');
    await waitFor(() => expect(rowNames()).toEqual(['Draft Q3 plan', 'Book room']));
    const heading = screen.getByRole('heading', { name: 'Work', level: 1 });
    expect(heading.querySelector('[data-project-dot]')).toHaveAttribute('data-project-dot', WORK.color);
    expect(api.callsOf('list').map((c) => c.url)).toContainEqual(`?list=project&projectId=${WORK.id}`);
  });

  it("an unknown project id: to the Inbox with 'Project not found'", async () => {
    await enterWithProjects(projectServer({ projects: [WORK] }), projectsPath('f'.repeat(32)), /.*/);
    await screen.findByRole('heading', { name: 'Inbox', level: 1 });
    await waitFor(() => expect(toastWith('Project not found')).not.toBeNull());
    expect(currentLocation.value?.pathname).toBe(`/w/${ID}`);
  });
});

describe('projects.ui_delete_undo', () => {
  it.each([
    [0, 'Delete "Work"?'],
    [1, 'Delete "Work" and its 1 task?'],
    [12, 'Delete "Work" and its 12 tasks?'],
  ])('TC-57 %i tasks (open and completed): %s; focus starts on Cancel', async (total, question) => {
    const names = Array.from({ length: total }, (_, i) => `Work task ${i + 1}`);
    const api = projectServer({ projects: [WORK], tasks: tasksIn(WORK.id, names, 0, Math.min(2, total)) });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    await waitFor(() => expect(queryClient.getQueryData<{ projects: Record<string, unknown> }>(queryKeys.counts(ID))?.projects[WORK.id]).toBeDefined());
    const dialog = await openDelete(user, 'Work');
    expect(within(dialog).getByRole('heading', { name: question })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.callsOf('deleteProject')).toEqual([]);
    await waitFor(() => expect(projectMenu('Work')).toHaveFocus());
  });

  it('TC-58 confirm: the row goes; Undo sends restore with the batchId and the row comes back', async () => {
    const api = projectServer({ projects: [WORK, HOME], tasks: tasksIn(WORK.id, ['Draft Q3 plan', 'Book room']) });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work', 'Home']));
    const dialog = await openDelete(user, 'Work');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Home']));
    await waitFor(() => expect(toastWith('Project deleted')).not.toBeNull());
    // Focus lands on the Projects heading (the row it came from is gone).
    await waitFor(() => expect(within(sidebar()).getByRole('heading', { name: 'Projects' })).toHaveFocus());
    const { batchId } = api.projects.get(WORK.id)!;
    await user.click(within(toastWith('Project deleted')!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work', 'Home']));
    expect(api.callsOf('restoreProject')[0]).toMatchObject({ id: WORK.id, body: { batchId } });
    await waitFor(() => expect(toastWith('Project restored')).toHaveAttribute('role', 'status'));
    await waitFor(() => expect(projectLink('Work')).toHaveAccessibleName('Work, 2 open tasks'));
  });

  it('TC-58 the toast goes after UNDO_WINDOW_MS; hovering at 9 s keeps it past 10 s, then it expires after the remaining time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    setReducedMotion(true);
    const api = projectServer({ projects: [WORK, HOME] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work', 'Home']));
    await user.click(within(await openDelete(user, 'Home')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastWith('Project deleted')).not.toBeNull());
    await act(async () => vi.advanceTimersByTime(9_000));
    const toast = toastWith('Project deleted')!;
    fireEvent.pointerEnter(toast);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(toastWith('Project deleted')).not.toBeNull();
    fireEvent.pointerLeave(toast);
    await act(async () => vi.advanceTimersByTime(500));
    expect(toastWith('Project deleted')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1_000));
    await waitFor(() => expect(toastWith('Project deleted')).toBeNull());
    expect(api.callsOf('restoreProject')).toEqual([]);

    // Without attention it goes at UNDO_WINDOW_MS.
    await user.click(within(await openDelete(user, 'Work')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastWith('Project deleted')).not.toBeNull());
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 500));
    expect(toastWith('Project deleted')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1_000));
    await waitFor(() => expect(toastWith('Project deleted')).toBeNull());
  });

  it('a failed delete rolls back with an alert', async () => {
    const api = projectServer({ projects: [WORK] });
    api.fail.deleteProject = 500;
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    await user.click(within(await openDelete(user, 'Work')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    expect(sidebarProjectNames()).toEqual(['Work']);
    expect(toastWith('Project deleted')).toBeNull();
  });

  it.each([
    ['without a fragment', ''],
    ['with a fragment', '#q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c'],
  ])('TC-59 deleting the viewed project goes to the Inbox, %s', async (_label, hash) => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api, `${projectsPath(WORK.id)}${hash}`, 'Work');
    await user.click(within(await openDelete(user, 'Work')).getByRole('button', { name: 'Delete' }));
    await screen.findByRole('heading', { name: 'Inbox', level: 1 });
    expect(currentLocation.value?.pathname).toBe(`/w/${ID}`);
    expect(currentLocation.value?.hash).toBe(hash);
    // No 'Project not found': this tab deleted it on purpose.
    await waitFor(() => expect(toastWith('Project deleted')).not.toBeNull());
    expect(toastWith('Project not found')).toBeNull();
  });
});

describe('tasks.ui_move_menu / tasks.ui_move_picker', () => {
  const inbox = tasksIn(null, ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);

  async function pickerFromMenu(user: { click: (el: Element) => Promise<void> }, name: string) {
    await user.click(within(rowNamed(name)).getByRole('button', { name: `More actions for ${name}` }));
    await user.click(await screen.findByRole('menuitem', { name: /Move to…/ }));
    return screen.findByRole('combobox', { name: 'Move to…' });
  }

  function optionNames(): string[] {
    return within(screen.getByRole('listbox', { name: 'Lists' })).getAllByRole('option').map((o) => o.textContent ?? '');
  }

  it("TC-60 menu: Inbox first, disabled and checked; 'wo' leaves Work and Woodwork; Enter moves to Work (PATCH), the task leaves and focus goes to the next row", async () => {
    const api = projectServer({ projects: [WORK, WOODWORK, HOME], tasks: inbox });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    const input = await pickerFromMenu(user, 'Email Sam re: invoice #4411');
    await waitFor(() => expect(input).toHaveFocus());
    expect(optionNames()).toEqual(['Inbox', 'Work', 'Woodwork', 'Home']);
    const [inboxOption] = within(screen.getByRole('listbox', { name: 'Lists' })).getAllByRole('option');
    expect(inboxOption).toHaveAttribute('aria-disabled', 'true');
    expect(inboxOption!.querySelector('[data-current-check]')).not.toBeNull();
    await user.type(input, 'wo');
    await waitFor(() => expect(optionNames()).toEqual(['Work', 'Woodwork']));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Call Mum 📞']));
    expect(api.callsOf('patchTask')[0]).toMatchObject({ id: inbox[1]!.id, body: { projectId: WORK.id } });
    expect(screen.queryByRole('combobox', { name: 'Move to…' })).toBeNull();
    await waitFor(() => expect(rowNamed('Call Mum 📞')).toHaveFocus());
    await waitFor(() => expect(projectLink('Work')).toHaveAccessibleName('Work, 1 open task'));
  });

  it("TC-60 a failed move puts the task back with an alert; Escape (clearing the query first) closes and returns focus to the row", async () => {
    const api = projectServer({ projects: [WORK, WOODWORK], tasks: inbox });
    api.fail.patchTask = 500;
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(rowNames()).toHaveLength(3));
    let input = await pickerFromMenu(user, 'Buy milk');
    await user.type(input, 'wood');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']));

    input = await pickerFromMenu(user, 'Buy milk');
    await user.type(input, 'zzz');
    expect(await screen.findByText('No matching projects')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Move to…' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Move to…' })).toBeNull());
    await waitFor(() => expect(rowNamed('Buy milk')).toHaveFocus());
  });

  it('TC-91 M: on a focused task opens Move to… for it; typing in quick add types an m; with no task focused nothing opens', async () => {
    const api = projectServer({ projects: [WORK], tasks: inbox });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    await user.click(document.querySelector<HTMLElement>('[data-add-task]')!);
    const name = await screen.findByRole('textbox', { name: 'Task name' });
    await user.type(name, 'm');
    expect(name).toHaveValue('m');
    expect(screen.queryByRole('combobox', { name: 'Move to…' })).toBeNull();
    await user.keyboard('{Escape}');

    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard('m');
    expect(screen.queryByRole('combobox', { name: 'Move to…' })).toBeNull();

    act(() => rowNamed('Call Mum 📞').focus());
    await user.keyboard('m');
    const input = await screen.findByRole('combobox', { name: 'Move to…' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.callsOf('patchTask')[0]).toMatchObject({ id: inbox[2]!.id, body: { projectId: WORK.id } }));
    await waitFor(() => expect(rowNamed('Email Sam re: invoice #4411')).toHaveFocus());
    expect(input).not.toBeInTheDocument();
  });

  it('TC-92 narrow viewport: the picker is a panel from the bottom; each option is at least 44px tall', async () => {
    setViewport({ width: 390, coarse: true });
    const api = projectServer({ projects: [WORK, HOME], tasks: inbox });
    await enterWithProjects(api);
    await waitFor(() => expect(rows()).toHaveLength(3));
    act(() => rowNamed('Buy milk').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'm' });
    const input = await screen.findByRole('combobox', { name: 'Move to…' });
    const panel = input.closest('[role="dialog"]')!;
    expect(panel).toHaveAttribute('data-drawer');
    expect(within(panel as HTMLElement).getByText('Move to…')).toBeInTheDocument();
    for (const option of within(panel as HTMLElement).getAllByRole('option')) expect(option).toHaveClass('min-h-11');
  });

  it('moving from a project view to the Inbox: the task leaves the project and the counts follow', async () => {
    const api = projectServer({ projects: [WORK], tasks: tasksIn(WORK.id, ['Draft Q3 plan', 'Book room']) });
    const { user } = await enterWithProjects(api, projectsPath(WORK.id), 'Work');
    await waitFor(() => expect(rowNames()).toEqual(['Draft Q3 plan', 'Book room']));
    const input = await pickerFromMenu(user, 'Book room');
    expect(optionNames()).toEqual(['Inbox', 'Work']);
    await user.type(input, 'inb{Enter}');
    await waitFor(() => expect(rowNames()).toEqual(['Draft Q3 plan']));
    await waitFor(() => expect(within(sidebar()).getByRole('button', { name: 'Inbox, 1 open task', hidden: true })).toBeInTheDocument());
    expect(projectLink('Work')).toHaveAccessibleName('Work, 1 open task');
  });
});

describe('projects.live_events (fake emitter through the real registry)', () => {
  function event(e: Omit<LiveEvent, 'originClientId'>): LiveEvent {
    return { ...e, originClientId: 'someone-else' } as LiveEvent;
  }

  async function connected(live: ReturnType<typeof startLiveServer>) {
    await waitFor(() => expect(live.clients()).toHaveLength(1));
  }

  it("TC-62 project.deleted for the viewed project: to the Inbox with 'This project was deleted'", async () => {
    const live = startLiveServer();
    await enterWithProjects(projectServer({ projects: [WORK, HOME] }), projectsPath(WORK.id), 'Work');
    await connected(live);
    act(() => live.emit(event({ type: 'project.deleted', entity: { id: WORK.id, batchId: 'c'.repeat(32) }, version: 2 })));
    await screen.findByRole('heading', { name: 'Inbox', level: 1 });
    await waitFor(() => expect(toastWith('This project was deleted')).not.toBeNull());
    expect(toastWith('Project not found')).toBeNull();
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Home']));
  });

  it('TC-63 project.upserted from another client renames the sidebar row and the header', async () => {
    const live = startLiveServer();
    await enterWithProjects(projectServer({ projects: [WORK] }), projectsPath(WORK.id), 'Work');
    await connected(live);
    act(() => live.emit(event({ type: 'project.upserted', entity: { ...WORK, name: 'Job', version: 2 }, version: 2 })));
    expect(await screen.findByRole('heading', { name: 'Job', level: 1 })).toBeInTheDocument();
    expect(sidebarProjectNames()).toEqual(['Job']);
  });

  it('TC-85 counts live only under [ws, id, counts] (no dated key); a live tasks.bulk refetches them exactly once', async () => {
    const live = startLiveServer();
    const api = projectServer({ projects: [WORK], tasks: tasksIn(WORK.id, ['Draft Q3 plan']) });
    const { user } = await enterWithProjects(api, projectsPath(WORK.id), 'Work');
    await connected(live);
    await waitFor(() => expect(rowNames()).toEqual(['Draft Q3 plan']));
    // An optimistic create writes the counts.
    await user.keyboard('q');
    await user.type(await screen.findByRole('textbox', { name: 'Task name' }), 'Book room{Enter}');
    await waitFor(() => expect(api.callsOf('createTask')).toHaveLength(1));
    const countKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      .filter((key) => key.includes('counts'));
    expect(countKeys).toEqual([queryKeys.counts(ID)]);

    const before = api.callsOf('counts').length;
    act(() => live.emit(event({ type: 'tasks.bulk', entity: { ids: [], deleted: true }, version: 3 })));
    await waitFor(() => expect(api.callsOf('counts').length).toBe(before + 1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.callsOf('counts').length).toBe(before + 1);
  });
});
