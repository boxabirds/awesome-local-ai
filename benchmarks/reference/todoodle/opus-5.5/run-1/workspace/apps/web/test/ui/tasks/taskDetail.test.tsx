import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { NAME_HINT_MS, TASK_NAME_MAX } from '@todoodle/shared/limits';
import type { Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetTaskDetailPreloadForTests, taskDetailLoads } from '@/features/tasks/TaskDetailSheet.lazy';
import { makeTask, makeTasks } from '../../msw/tasks.ts';
import { taskServer } from '../../msw/taskLifecycle.ts';
import { startLiveServer } from '../../support/live.ts';
import { ID, enterWithTaskServer, rowNamed, rowNames, rows, setViewport, toastWith } from '../../support/tasks.tsx';

// Story 6, design Matrix E (ui.task_detail): the lazy detail sheet, inline edit, blank and over-limit
// names, Escape, 410 and conflicts through story 4's edit guard, focus return, full screen on phones.

const [A, B, C] = makeTasks(3) as [Task, Task, Task];
const DENTIST = makeTask({ name: 'Book dentist — ask about Tuesday', description: 'Ask about:\n- the Tuesday slot' }, 3);

async function ready(api = taskServer([A, B, C, DENTIST])) {
  const rendered = await enterWithTaskServer(api);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  return { ...rendered, api };
}

async function openSheet(user: { click: (el: Element) => Promise<void> }, name: string) {
  await user.click(within(rowNamed(name)).getByText(name));
  return screen.findByRole('dialog', { name: 'Task details' });
}

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Name' });
}

function descriptionField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Description' });
}

/** Rows are aria-hidden behind the modal sheet, so they are read by id there. */
function rowText(task: Task): string | null | undefined {
  return document.querySelector(`[data-task-id="${task.id}"] p`)?.textContent;
}

afterEach(() => vi.useRealTimers());

describe('ui.task_detail: open and edit', () => {
  it('TC-C05 clicking a task name opens the sheet with the name focused and the description shown', async () => {
    const { user } = await ready();
    const sheet = await openSheet(user, DENTIST.name);
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue(DENTIST.name);
    expect(descriptionField()).toHaveValue(DENTIST.description);
    expect(within(sheet).getByRole('button', { name: 'Delete task' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('TC-C06 edit the name then Enter: PATCH with the trimmed name; the row shows it at once', async () => {
    let release!: () => void;
    const api = taskServer([A, B, C]);
    api.hold.patch = new Promise<void>((resolve) => (release = resolve));
    const { user } = await ready(api);
    await openSheet(user, B.name);
    await user.clear(nameField());
    await user.type(nameField(), '  Email Sam re: invoice #4412  {Enter}');
    await waitFor(() => expect(rowText(B)).toBe('Email Sam re: invoice #4412'));
    expect(nameField()).toHaveFocus();
    release();
    await waitFor(() => expect(api.callsOf('patch')).toHaveLength(1));
    expect(api.callsOf('patch')[0]).toMatchObject({ id: B.id, body: { name: 'Email Sam re: invoice #4412' } });
    // Blur afterwards does not send it again.
    fireEvent.blur(nameField());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.callsOf('patch')).toHaveLength(1);
  });

  it('the name also saves on blur', async () => {
    const { user, api } = await ready();
    await openSheet(user, A.name);
    await user.clear(nameField());
    await user.type(nameField(), 'Buy oat milk');
    await user.click(descriptionField());
    await waitFor(() => expect(api.callsOf('patch').map((c) => c.body)).toEqual([{ name: 'Buy oat milk' }]));
  });

  it('TC-C07 edit the description then blur: PATCH description', async () => {
    const { user, api } = await ready();
    await openSheet(user, DENTIST.name);
    await user.click(descriptionField());
    await user.type(descriptionField(), '\n- bring the referral');
    fireEvent.blur(descriptionField());
    await waitFor(() => expect(api.callsOf('patch')).toHaveLength(1));
    expect(api.callsOf('patch')[0]!.body).toEqual({ description: `${DENTIST.description}\n- bring the referral` });
    await waitFor(() => expect(api.tasks.get(DENTIST.id)?.description).toBe(`${DENTIST.description}\n- bring the referral`));
  });

  it('TC-C08 Escape during an edit sends nothing and reverts; a second Escape closes the sheet', async () => {
    const { user, api } = await ready();
    await openSheet(user, A.name);
    await user.type(nameField(), ' and bread');
    expect(nameField()).toHaveValue(`${A.name} and bread`);
    await user.keyboard('{Escape}');
    expect(nameField()).toHaveValue(A.name);
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.callsOf('patch')).toEqual([]);
    expect(rowNames()).toEqual([A.name, B.name, C.name, DENTIST.name]);
  });

  it('Escape also cancels a description edit first', async () => {
    const { user, api } = await ready();
    await openSheet(user, DENTIST.name);
    await user.click(descriptionField());
    await user.type(descriptionField(), ' extra');
    await user.keyboard('{Escape}');
    expect(descriptionField()).toHaveValue(DENTIST.description);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.callsOf('patch')).toEqual([]);
  });

  it("TC-C09 clear the name then Enter: no PATCH; the previous name returns; Name can't be empty shows for NAME_HINT_MS", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const { user, api } = await ready();
    await openSheet(user, A.name);
    await user.clear(nameField());
    await user.keyboard('{Enter}');
    expect(nameField()).toHaveValue(A.name);
    const hint = screen.getByText("Name can't be empty");
    expect(hint).toHaveAttribute('role', 'status');
    await act(async () => vi.advanceTimersByTime(NAME_HINT_MS - 200));
    expect(screen.getByText("Name can't be empty")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(400));
    expect(screen.queryByText("Name can't be empty")).toBeNull();
    expect(api.callsOf('patch')).toEqual([]);
  });

  it('TC-C10 typing past TASK_NAME_MAX keeps the text, shows the over-limit count, and Enter sends nothing', async () => {
    const { user, api } = await ready();
    await openSheet(user, A.name);
    const over = 'x'.repeat(TASK_NAME_MAX + 3);
    fireEvent.change(nameField(), { target: { value: over } });
    await user.keyboard('{Enter}');
    expect(nameField()).toHaveValue(over);
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    const counter = document.getElementById('task-detail-name-count')!;
    expect(counter).toHaveTextContent('3 characters over');
    expect(counter).toHaveClass('text-destructive');
    fireEvent.blur(nameField());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.callsOf('patch')).toEqual([]);
    expect(rowText(A)).toBe(A.name);
  });

  it('TC-C11 PATCH returns 410: the deleted notice; the sheet closes; the row is removed', async () => {
    const api = taskServer([A, B, C]);
    api.fail.patch = 410;
    const { user } = await ready(api);
    await openSheet(user, B.name);
    await user.clear(nameField());
    await user.type(nameField(), 'Too late{Enter}');
    await waitFor(() => expect(screen.getByText('This task was deleted')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
  });

  it("a failed save (500) returns the name to its prior state and says Couldn't save", async () => {
    const api = taskServer([A, B, C]);
    api.fail.patch = 500;
    const { user } = await ready(api);
    await openSheet(user, B.name);
    await user.clear(nameField());
    await user.type(nameField(), 'Nope{Enter}');
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    await waitFor(() => expect(nameField()).toHaveValue(B.name));
    expect(rowText(B)).toBe(B.name);
  });
});

describe('ui.task_detail: conflicts, focus, layout, lazy chunk', () => {
  it('TC-C19 someone else renames the task open in the sheet while the user edits it: conflict notice with Use my version and Keep theirs', async () => {
    const live = startLiveServer(ID);
    const { user, api } = await ready();
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    await openSheet(user, B.name);
    await user.clear(nameField());
    await user.type(nameField(), 'Email Sam about #4411');
    live.emit({
      type: 'task.upserted',
      entity: { ...B, name: 'Email Sam re: invoice #4411 (paid)', version: 2 },
      version: 2,
      originClientId: 'b2c3d4e5-0000-4000-8000-000000000000',
    });
    const notice = await screen.findByText('Someone else changed this just now.');
    const alert = notice.closest('[role="alert"]') as HTMLElement;
    expect(within(alert).getByText('Email Sam re: invoice #4411 (paid)')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('Email Sam about #4411');
    // Leaving the field does not save while the choice is open.
    fireEvent.blur(nameField());
    expect(api.callsOf('patch')).toEqual([]);
    await user.click(within(alert).getByRole('button', { name: 'Keep theirs' }));
    await waitFor(() => expect(screen.queryByText('Someone else changed this just now.')).toBeNull());
    expect(nameField()).toHaveValue('Email Sam re: invoice #4411 (paid)');
    expect(api.callsOf('patch')).toEqual([]);
  });

  it('TC-C19 Use my version saves the user\'s text', async () => {
    const live = startLiveServer(ID);
    const { user, api } = await ready();
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    await openSheet(user, B.name);
    await user.clear(nameField());
    await user.type(nameField(), 'Mine');
    live.emit({ type: 'task.upserted', entity: { ...B, name: 'Theirs', version: 2 }, version: 2, originClientId: null });
    const alert = (await screen.findByText('Someone else changed this just now.')).closest('[role="alert"]') as HTMLElement;
    await user.click(within(alert).getByRole('button', { name: 'Use my version' }));
    await waitFor(() => expect(api.callsOf('patch').map((c) => c.body)).toEqual([{ name: 'Mine' }]));
    await waitFor(() => expect(nameField()).toHaveValue('Mine'));
  });

  it('someone else deleting the task open in the sheet: This task was deleted; the sheet closes', async () => {
    const live = startLiveServer(ID);
    const { user } = await ready();
    await waitFor(() => expect(live.clients()).toHaveLength(1));
    await openSheet(user, B.name);
    live.emit({ type: 'task.deleted', entity: { id: B.id }, version: 2, originClientId: null });
    await waitFor(() => expect(screen.getByText('This task was deleted')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name, DENTIST.name]));
  });

  it('TC-C28 closing by Escape returns focus to the originating row; Close button too', async () => {
    const { user } = await ready();
    rowNamed(B.name).focus();
    await user.keyboard('e');
    await screen.findByRole('dialog', { name: 'Task details' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowNamed(B.name)).toHaveFocus());

    await openSheet(user, C.name);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowNamed(C.name)).toHaveFocus());
  });

  it('TC-C28 delete from the sheet: no confirmation; the sheet closes and focus moves to the next row', async () => {
    const { user, api } = await ready();
    await openSheet(user, B.name);
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name, DENTIST.name]));
    expect(rowNamed(C.name)).toHaveFocus();
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    expect(api.callsOf('delete').map((c) => c.id)).toEqual([B.id]);
  });

  it('TC-C28 delete the last task from the sheet: focus moves to the previous row', async () => {
    const { user } = await ready();
    await openSheet(user, DENTIST.name);
    await user.click(screen.getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(rowNamed(C.name)).toHaveFocus();
  });

  it('menu Edit opens the sheet', async () => {
    const { user } = await ready();
    await user.click(within(rowNamed(A.name)).getByRole('button', { name: `More actions for ${A.name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    await waitFor(() => expect(nameField()).toHaveFocus());
  });

  it('TC-C30 narrow viewport and hover:none: the sheet is full screen (CSS classes, no JS width state)', async () => {
    setViewport({ width: 390, coarse: true });
    const { user } = await ready();
    const sheet = await openSheet(user, A.name);
    expect(sheet).toHaveClass('inset-0', 'w-full', 'max-w-none');
    expect(sheet).toHaveClass('md:w-[28rem]', 'md:left-auto', 'md:inset-y-0');
    expect(within(sheet).getByRole('button', { name: 'Delete task' })).toHaveClass('min-h-[var(--min-touch-target)]');
    // The row's menu trigger is not a focusable control inside the option (nested-interactive), yet a touch target.
    const trigger = within(rowNamed(B.name, { hidden: true })).getByRole('button', { name: `More actions for ${B.name}`, hidden: true });
    expect(trigger).not.toHaveAttribute('tabindex');
    expect(trigger.tagName).toBe('SPAN');
  });

  it('TC-C32 the TaskDetailSheet chunk is not requested until a row is hovered or focused', async () => {
    resetTaskDetailPreloadForTests();
    await ready();
    expect(taskDetailLoads.count).toBe(0);
    fireEvent.pointerEnter(rowNamed(A.name));
    expect(taskDetailLoads.count).toBe(1);
    fireEvent.pointerEnter(rowNamed(B.name));
    rowNamed(C.name).focus();
    expect(taskDetailLoads.count).toBe(1);
  });

  it('TC-C32 focusing a row (keyboard) also preloads it', async () => {
    resetTaskDetailPreloadForTests();
    await ready();
    expect(taskDetailLoads.count).toBe(0);
    act(() => rowNamed(B.name).focus());
    expect(taskDetailLoads.count).toBe(1);
  });
});
