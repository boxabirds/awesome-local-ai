import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HINT_VISIBLE_MS, MAX_PROJECTS_PER_WORKSPACE, PROJECT_COLORS, PROJECT_NAME_MAX } from '@todoodle/shared/limits';
import type { Counts, Project } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectRowRenders } from '@/features/projects/ProjectRow';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { makeProject } from '../../msw/projects.ts';
import { projectServer } from '../../msw/projectServer.ts';
import { makeTask } from '../../msw/tasks.ts';
import { ID, enterWithProjects, projectLink, projectMenu, sidebar, sidebarProjectNames } from '../../support/projects.tsx';
import { setViewport, toastWith } from '../../support/tasks.tsx';

// Story 7, task 15: the sidebar's Projects section, the create dialog, inline rename, touch visibility and
// render isolation. Network through a stateful MSW server (schema-parsed); matchMedia stubbed per test.

vi.mock('@/routes/lazy', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/routes/lazy')>();
  return { ...original, preloadProjectView: vi.fn(original.preloadProjectView) };
});

const { preloadProjectView } = await import('@/routes/lazy');

afterEach(() => vi.useRealTimers());

const WORK = makeProject({ name: 'Work' }, 0);
const HOME = makeProject({ name: 'Home' }, 1);

function workTasks(open: number, completed = 0) {
  return Array.from({ length: open + completed }, (_, i) =>
    makeTask({ name: `Work task ${i + 1}`, projectId: WORK.id, completedAt: i < open ? null : '2026-09-24T17:30:00.000Z' }, i),
  );
}

async function openCreateDialog(user: { click: (el: Element) => Promise<void> }) {
  await user.click(within(sidebar()).getByRole('button', { name: 'Add project' }));
  return screen.findByRole('dialog', { name: 'Add project' });
}

function nameField(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
}

function addButton(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: 'Add' });
}

describe('projects.ui_sidebar: rendering', () => {
  it("TC-51 no projects: the 'Projects' heading with only '+' and the hint 'Group tasks by area'", async () => {
    await enterWithProjects(projectServer());
    const nav = sidebar();
    expect(within(nav).getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Add project' })).toBeInTheDocument();
    expect(within(nav).getByText('Group tasks by area')).toBeInTheDocument();
    expect(nav.querySelectorAll('[data-project-row]')).toHaveLength(0);
  });

  it('TC-52 two projects with 0 and 12 open tasks, Inbox 4: dot and name each, count hidden at 0, 12 shown, Inbox 4', async () => {
    const inbox = Array.from({ length: 4 }, (_, i) => makeTask({ name: `Inbox task ${i + 1}` }, i));
    const homeTasks = Array.from({ length: 12 }, (_, i) => makeTask({ name: `Home task ${i + 1}`, projectId: HOME.id }, 10 + i));
    await enterWithProjects(projectServer({ projects: [WORK, HOME], tasks: [...inbox, ...homeTasks] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work', 'Home']));
    const nav = sidebar();
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Home, 12 open tasks' })).toBeInTheDocument());
    const work = projectLink('Work');
    expect(work).toHaveAccessibleName('Work');
    expect(work.querySelector('[data-count-slot]')).toHaveTextContent('');
    expect(work.querySelector('[data-project-dot]')).toHaveAttribute('aria-hidden', 'true');
    expect(work.querySelector('[data-project-dot]')).toHaveAttribute('data-project-dot', WORK.color);
    expect(projectLink('Home').querySelector('[data-count-slot]')).toHaveTextContent('12');
    expect(within(nav).getByRole('button', { name: 'Inbox, 4 open tasks' })).toBeInTheDocument();
    // The name is always shown beside the colour, truncated with the full name on hover.
    expect(work).toHaveAttribute('title', 'Work');
    expect(within(work).getByText('Work')).toHaveClass('truncate');
  });

  it('TC-89 50 projects: every row has content-visibility:auto and contain-intrinsic-size; the list container has neither', async () => {
    const many = Array.from({ length: 50 }, (_, i) => makeProject({ name: `Project ${i + 1}` }, i));
    await enterWithProjects(projectServer({ projects: many }));
    await waitFor(() => expect(sidebar().querySelectorAll('[data-project-row]')).toHaveLength(50));
    for (const row of sidebar().querySelectorAll<HTMLElement>('[data-project-row]')) {
      expect(row.style.contentVisibility).toBe('auto');
      expect(row.style.containIntrinsicSize).toMatch(/^auto \d+px$/);
    }
    const list = sidebar().querySelector<HTMLElement>('[data-project-list]')!;
    expect(list.style.contentVisibility).toBe('');
    expect(list.style.containIntrinsicSize).toBe('');
  });

  it('TC-64 a count change on P1 re-renders P1 only (ProjectRow reads its own count; the parent passes none)', async () => {
    await enterWithProjects(projectServer({ projects: [WORK, HOME], tasks: workTasks(2) }));
    await waitFor(() => expect(projectLink('Work')).toHaveAccessibleName('Work, 2 open tasks'));
    const homeBefore = projectRowRenders.get(HOME.id) ?? 0;
    const workBefore = projectRowRenders.get(WORK.id) ?? 0;
    act(() => {
      queryClient.setQueryData<Counts>(queryKeys.counts(ID), (counts) => ({
        ...counts!,
        projects: { ...counts!.projects, [WORK.id]: { open: 3, total: 3 } },
      }));
    });
    await waitFor(() => expect(projectLink('Work')).toHaveAccessibleName('Work, 3 open tasks'));
    expect(projectRowRenders.get(WORK.id)).toBeGreaterThan(workBefore);
    expect(projectRowRenders.get(HOME.id)).toBe(homeBefore);
  });

  it('TC-84 pointerenter then focus on a row: the project view chunk preloads once and its task list is prefetched', async () => {
    await enterWithProjects(projectServer({ projects: [WORK] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const prefetch = vi.spyOn(queryClient, 'prefetchQuery');
    vi.mocked(preloadProjectView).mockClear();
    const link = projectLink('Work');
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    expect(preloadProjectView).toHaveBeenCalledTimes(1);
    const keys = prefetch.mock.calls.map(([options]) => options.queryKey);
    expect(keys).toContainEqual(queryKeys.tasks(ID, { list: 'project', projectId: WORK.id }));
    expect(keys.filter((key) => JSON.stringify(key) === JSON.stringify(queryKeys.tasks(ID, { list: 'project', projectId: WORK.id })))).toHaveLength(1);
  });

  it('selecting a project opens it: the address changes and the header shows its name', async () => {
    const { user } = await enterWithProjects(projectServer({ projects: [WORK] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    await user.click(projectLink('Work'));
    expect(await screen.findByRole('heading', { name: 'Work', level: 1 })).toBeInTheDocument();
    expect(projectLink('Work')).toHaveAttribute('aria-current', 'page');
  });
});

describe('projects.ui_accessible_controls: create dialog', () => {
  it("TC-53 blank names: Add disabled and 'Name can't be empty' once touched (empty and spaces)", async () => {
    const { user } = await enterWithProjects(projectServer());
    const dialog = await openCreateDialog(user);
    const input = nameField(dialog);
    expect(input).toHaveFocus();
    expect(addButton(dialog)).toBeDisabled();
    expect(within(dialog).queryByText("Name can't be empty")).toBeNull();
    await user.type(input, 'a');
    await user.clear(input);
    expect(within(dialog).getByRole('status')).toHaveTextContent("Name can't be empty");
    expect(addButton(dialog)).toBeDisabled();
    await user.type(input, '   ');
    expect(within(dialog).getByText("Name can't be empty")).toBeInTheDocument();
    expect(addButton(dialog)).toBeDisabled();
  });

  it("TC-53 lengths: 1 char enabled without a counter; 108 '12 characters left'; 120 '0 characters left'; pasting 130 keeps all 130, '10 characters over' with an icon, Add disabled", async () => {
    const { user } = await enterWithProjects(projectServer());
    const dialog = await openCreateDialog(user);
    const input = nameField(dialog);
    const counter = () => dialog.querySelector('[data-counter]')!;
    await user.type(input, 'W');
    expect(addButton(dialog)).toBeEnabled();
    expect(counter()).toHaveClass('sr-only');
    expect(counter().textContent).toBe('');

    fireEvent.change(input, { target: { value: 'n'.repeat(108) } });
    expect(counter()).toHaveTextContent('12 characters left');
    expect(addButton(dialog)).toBeEnabled();

    fireEvent.change(input, { target: { value: 'n'.repeat(PROJECT_NAME_MAX) } });
    expect(counter()).toHaveTextContent('0 characters left');
    expect(addButton(dialog)).toBeEnabled();

    await user.clear(input);
    await user.click(input);
    await user.paste('p'.repeat(130));
    expect(input.value).toHaveLength(130);
    expect(input).not.toHaveAttribute('maxLength');
    expect(counter()).toHaveTextContent('10 characters over');
    expect(counter().querySelector('[data-icon="warning"]')).not.toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(addButton(dialog)).toBeDisabled();
  });

  it('TC-53 12 labelled swatches, the first selected; arrow keys move the selection', async () => {
    const { user } = await enterWithProjects(projectServer());
    const dialog = await openCreateDialog(user);
    const group = within(dialog).getByRole('radiogroup', { name: 'Colour' });
    const swatches = within(group).getAllByRole('radio');
    expect(swatches.map((s) => s.getAttribute('aria-label'))).toEqual(PROJECT_COLORS.map((c) => c.label));
    expect(swatches[0]).toHaveAttribute('aria-checked', 'true');
    swatches[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(swatches[1]).toHaveFocus();
    expect(swatches[1]).toHaveAttribute('aria-checked', 'true');
    expect(swatches[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('creates with Enter: the row appears at the bottom and the project opens (POST carries the chosen colour)', async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const dialog = await openCreateDialog(user);
    await user.type(nameField(dialog), 'Trip to Lisbon');
    await user.click(within(dialog).getByRole('radio', { name: PROJECT_COLORS[2].label }));
    await user.click(nameField(dialog));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Trip to Lisbon', level: 1 })).toBeInTheDocument();
    expect(sidebarProjectNames()).toEqual(['Work', 'Trip to Lisbon']);
    expect(api.callsOf('createProject')[0]!.body).toMatchObject({ name: 'Trip to Lisbon', color: PROJECT_COLORS[2].key });
    expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull();
  });

  it('TC-54 server 500: the optimistic row appears, then is removed; an alert toast says so', async () => {
    const api = projectServer();
    let release!: () => void;
    api.hold.createProject = new Promise<void>((resolve) => (release = resolve));
    api.fail.createProject = 500;
    const { user } = await enterWithProjects(api);
    const dialog = await openCreateDialog(user);
    await user.type(nameField(dialog), 'Work');
    await user.click(addButton(dialog));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    release();
    await waitFor(() => expect(sidebarProjectNames()).toEqual([]));
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    // The dialog stays with the text, so trying again needs no retyping.
    expect(nameField(dialog).value).toBe('Work');
  });

  it(`TC-55 ${MAX_PROJECTS_PER_WORKSPACE} projects in the cache: the limit message shows and Add is disabled`, async () => {
    const many: Project[] = Array.from({ length: MAX_PROJECTS_PER_WORKSPACE }, (_, i) => makeProject({ name: `Project ${i + 1}` }, i));
    const { user } = await enterWithProjects(projectServer({ projects: many }));
    await waitFor(() => expect(sidebar().querySelectorAll('[data-project-row]')).toHaveLength(MAX_PROJECTS_PER_WORKSPACE));
    const dialog = await openCreateDialog(user);
    await user.type(nameField(dialog), 'One more');
    expect(within(dialog).getByText("You've reached the limit of 300 projects")).toBeInTheDocument();
    expect(addButton(dialog)).toBeDisabled();
  });

  it('TC-55 server 409 limit_reached: the limit message shows, Add is disabled, the row is rolled back', async () => {
    const api = projectServer({ projects: [WORK] });
    api.fail.createProject = { status: 409, code: 'limit_reached' };
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const dialog = await openCreateDialog(user);
    await user.type(nameField(dialog), 'Home');
    await user.click(addButton(dialog));
    expect(await within(dialog).findByText("You've reached the limit of 300 projects")).toBeInTheDocument();
    expect(addButton(dialog)).toBeDisabled();
    expect(sidebarProjectNames()).toEqual(['Work']);
  });
});

describe('projects.ui_accessible_controls: inline rename', () => {
  async function startRename(user: { click: (el: Element) => Promise<void> }) {
    await user.click(projectMenu('Work'));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    return within(sidebar()).findByRole('textbox', { name: 'Project name' });
  }

  it("TC-56 Enter with 'Job' saves (PATCH {name}); the row shows 'Job' and focus returns to it", async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const input = await startRename(user);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Work');
    await user.clear(input);
    await user.type(input, 'Job{Enter}');
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Job']));
    expect(api.callsOf('updateProject')[0]).toMatchObject({ id: WORK.id, body: { name: 'Job' } });
    expect(projectLink('Job')).toHaveFocus();
  });

  it('TC-56 Escape cancels without a request', async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const input = await startRename(user);
    await user.type(input, ' and more{Escape}');
    expect(sidebarProjectNames()).toEqual(['Work']);
    expect(api.callsOf('updateProject')).toEqual([]);
    expect(projectLink('Work')).toHaveFocus();
  });

  it("TC-56 Enter with '' and blur with spaces: no request, the old name is back, 'Name can't be empty' is announced and hides after HINT_VISIBLE_MS", async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    let input = await startRename(user);
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(sidebarProjectNames()).toEqual(['Work']);
    expect(within(sidebar()).getByRole('status')).toHaveTextContent("Name can't be empty");

    input = await startRename(user);
    fireEvent.change(input, { target: { value: '   ' } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.blur(input);
    expect(sidebarProjectNames()).toEqual(['Work']);
    expect(within(sidebar()).getByRole('status')).toHaveTextContent("Name can't be empty");
    act(() => vi.advanceTimersByTime(HINT_VISIBLE_MS - 1));
    expect(within(sidebar()).queryByText("Name can't be empty")).not.toBeNull();
    act(() => vi.advanceTimersByTime(2));
    expect(within(sidebar()).queryByText("Name can't be empty")).toBeNull();
    expect(api.callsOf('updateProject')).toEqual([]);
  });

  it('TC-56 server 500: the new name rolls back to the old one and an alert toast shows', async () => {
    const api = projectServer({ projects: [WORK] });
    api.fail.updateProject = 500;
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const input = await startRename(user);
    await user.clear(input);
    await user.type(input, 'Job{Enter}');
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    expect(sidebarProjectNames()).toEqual(['Work']);
  });

  it('an over-long rename is never cut and never saved: the field stays open with the counter', async () => {
    const api = projectServer({ projects: [WORK] });
    const { user } = await enterWithProjects(api);
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const input = (await startRename(user)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(PROJECT_NAME_MAX + 3) } });
    await user.keyboard('{Enter}');
    expect(input.value).toHaveLength(PROJECT_NAME_MAX + 3);
    expect(within(sidebar()).getByText('3 characters over')).toBeInTheDocument();
    expect(api.callsOf('updateProject')).toEqual([]);
  });
});

describe('projects.ui_accessible_controls: touch and hit areas', () => {
  it("TC-82 hover:none: the '…' button is visible without hover", async () => {
    setViewport({ width: 1280, coarse: true });
    await enterWithProjects(projectServer({ projects: [WORK] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const menu = projectMenu('Work');
    expect(menu).toHaveClass('opacity-100');
    expect(menu).not.toHaveClass('opacity-0');
  });

  it("TC-82 hover:hover: hidden while idle, shown on row hover or keyboard focus within the row", async () => {
    setViewport({ width: 1280, coarse: false });
    await enterWithProjects(projectServer({ projects: [WORK] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    const menu = projectMenu('Work');
    expect(menu).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100');
    expect(menu.closest('[data-project-row]')).toHaveClass('group');
  });

  it("TC-82 the row, '+' and '…' have a hit area of at least 44x44 (min-h-11 min-w-11 = 2.75rem)", async () => {
    await enterWithProjects(projectServer({ projects: [WORK] }));
    await waitFor(() => expect(sidebarProjectNames()).toEqual(['Work']));
    for (const control of [projectLink('Work'), projectMenu('Work'), within(sidebar()).getByRole('button', { name: 'Add project' })]) {
      expect(control).toHaveClass('min-h-11', 'min-w-11');
    }
  });

  it('on a phone, choosing a project in the ☰ drawer closes the drawer and shows the project', async () => {
    setViewport({ width: 390, coarse: true });
    const { user } = await enterWithProjects(projectServer({ projects: [WORK] }));
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Lists' });
    await user.click(await within(drawer).findByRole('button', { name: 'Work' }));
    expect(await screen.findByRole('heading', { name: 'Work', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lists' })).toBeNull());
  });
});
