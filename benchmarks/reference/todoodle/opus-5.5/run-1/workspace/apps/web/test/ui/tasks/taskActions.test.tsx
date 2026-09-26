import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { formatCompletedDate } from '@todoodle/shared/dates';
import { COMPLETE_ANIMATION_MS, MIN_TOUCH_TARGET_PX, UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import type { Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showCompletedKey } from '@/features/tasks/showCompletedPref';
import { makeStorageUnavailable } from '../../support/storage.ts';
import { makeTask, makeTasks } from '../../msw/tasks.ts';
import { taskServer } from '../../msw/taskLifecycle.ts';
import { ID, enterWithTaskServer, rowNamed, rowNames, rows, setReducedMotion, setViewport, toastWith } from '../../support/tasks.tsx';

// Story 6, design Matrix E (row surface): completion feedback, rollback, undo, delete without confirmation.

const [A, B, C, D] = makeTasks(4) as [Task, Task, Task, Task];
const DONE_1 = makeTask({ name: 'Water the plants', completedAt: '2026-09-25T17:30:00.000Z' }, 10);
const DONE_2 = makeTask({ name: 'Renew passport', description: 'Photo booth first', completedAt: '2026-09-20T08:00:00.000Z' }, 11);

function completedRows(): HTMLElement[] {
  const list = screen.queryByRole('listbox', { name: 'Completed tasks' });
  return list ? within(list).queryAllByRole('option') : [];
}

async function menuDelete(user: { click: (el: Element) => Promise<void> }, name: string) {
  await user.click(within(rowNamed(name)).getByRole('button', { name: `More actions for ${name}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
}

function checkbox(row: HTMLElement): HTMLElement {
  return within(row).getByRole('checkbox');
}

async function ready(api = taskServer([A, B, C])) {
  const rendered = await enterWithTaskServer(api);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  return { ...rendered, api };
}

afterEach(() => vi.useRealTimers());

describe('ui.task_actions: complete', () => {
  it('TC-C01 click checkbox: ticked at once; row stays COMPLETE_ANIMATION_MS, then leaves; status toast Task completed with Undo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const { user, api } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    expect(checkbox(rowNamed(B.name))).toHaveAttribute('aria-checked', 'true');
    expect(rowNamed(B.name)).toHaveAttribute('data-leaving', 'true');
    expect(rowNamed(B.name)).toHaveClass('task-row-leaving');
    expect(rowNames()).toEqual([A.name, B.name, C.name]);
    await act(async () => vi.advanceTimersByTime(COMPLETE_ANIMATION_MS + 50));
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
    const toast = await waitFor(() => {
      const found = toastWith('Task completed');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(toast).toHaveAttribute('role', 'status');
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(api.callsOf('complete').map((c) => c.id)).toEqual([B.id]);
  });

  it('TC-C23 reduced motion: the row leaves at once, with no animation class', async () => {
    setReducedMotion(true);
    const { user } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
    expect(document.querySelector('.task-row-leaving')).toBeNull();
    expect(document.querySelector('[data-leaving]')).toBeNull();
  });

  it("TC-C02 complete returns 500: the row returns at the same index; alert toast Couldn't save", async () => {
    setReducedMotion(true);
    const api = taskServer([A, B, C]);
    api.fail.complete = 500;
    const { user } = await ready(api);
    await user.click(checkbox(rowNamed(B.name)));
    const alert = await waitFor(() => {
      const found = toastWith("Couldn't save — try again");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(alert).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(checkbox(rowNamed(B.name))).toHaveAttribute('aria-checked', 'false');
    expect(toastWith('Task completed')).toBeNull();
  });

  it('TC-C03 Undo within the window: POST reopen; the row is back at its index', async () => {
    setReducedMotion(true);
    const { user, api } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    await user.click(within(toastWith('Task completed')!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(api.callsOf('reopen').map((c) => c.id)).toEqual([B.id]);
    await waitFor(() => expect(toastWith('Task restored')).not.toBeNull());
    expect(toastWith('Task restored')).toHaveAttribute('role', 'status');
    await waitFor(() => expect(toastWith('Task completed')).toBeNull());
  });

  it('TC-C04 after UNDO_WINDOW_MS the toast is gone and no reopen is sent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    setReducedMotion(true);
    const { user, api } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 500));
    expect(toastWith('Task completed')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1_000));
    await waitFor(() => expect(toastWith('Task completed')).toBeNull());
    expect(api.callsOf('reopen')).toEqual([]);
  });
});

describe('ui.task_actions: delete without confirmation', () => {
  it('TC-C12 menu Delete: no dialog; DELETE sent; row removed at once; status toast Task deleted with Undo', async () => {
    const { user, api } = await ready();
    await user.click(within(rowNamed(B.name)).getByRole('button', { name: `More actions for ${B.name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    expect(toastWith('Task deleted')).toHaveAttribute('role', 'status');
    expect(api.callsOf('delete').map((c) => c.id)).toEqual([B.id]);
  });

  it('TC-C13 Delete then Undo: POST restore; the row is back at its index', async () => {
    const { user, api } = await ready();
    await user.click(within(rowNamed(B.name)).getByRole('button', { name: `More actions for ${B.name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    await user.click(within(toastWith('Task deleted')!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(api.callsOf('restore').map((c) => c.id)).toEqual([B.id]);
  });

  it('TC-C14 DELETE returns 500: the row returns; alert toast', async () => {
    const api = taskServer([A, B, C]);
    api.fail.delete = 500;
    const { user } = await ready(api);
    await user.click(within(rowNamed(B.name)).getByRole('button', { name: `More actions for ${B.name}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(toastWith("Couldn't save — try again")).not.toBeNull());
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(toastWith('Task deleted')).toBeNull();
  });
});

describe('ui.task_actions: show completed', () => {
  it('TC-C15 toggle Show completed: completed rows struck through with an Intl date; their checkbox reopens', async () => {
    const { user, api } = await ready(taskServer([A, B, DONE_1, DONE_2]));
    expect(completedRows()).toEqual([]);
    await user.click(screen.getByRole('switch', { name: 'Show completed' }));
    await waitFor(() => expect(completedRows()).toHaveLength(2));
    expect(api.callsOf('list').at(-1)?.url).toContain('include_completed=true');
    const [first, second] = completedRows() as [HTMLElement, HTMLElement];
    expect(first.querySelector('p')).toHaveTextContent(DONE_1.name);
    expect(first.querySelector('p')).toHaveClass('line-through');
    expect(within(first).getByText(formatCompletedDate(DONE_1.completedAt!))).toBeInTheDocument();
    expect(first.querySelector('time')).toHaveAttribute('dateTime', DONE_1.completedAt);
    expect(second.querySelector('p')).toHaveTextContent(DONE_2.name);
    const reopen = within(first).getByRole('checkbox', { name: `Reopen ${DONE_1.name}` });
    expect(reopen).toHaveAttribute('aria-checked', 'true');
    await user.click(reopen);
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, DONE_1.name, DONE_2.name]));
    await waitFor(() => expect(completedRows()).toHaveLength(1));
    expect(api.callsOf('reopen').map((c) => c.id)).toEqual([DONE_1.id]);
  });

  it('TC-C20 Show completed with zero completed tasks says No completed tasks', async () => {
    const { user } = await ready(taskServer([A, B]));
    await user.click(screen.getByRole('switch', { name: 'Show completed' }));
    expect(await screen.findByText('No completed tasks')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Completed tasks' })).toBeNull();
  });

  it('TC-C21 reopen returns 500: the row returns to the completed group; alert toast', async () => {
    const api = taskServer([A, DONE_1, DONE_2]);
    api.fail.reopen = 500;
    const { user } = await ready(api);
    await user.click(screen.getByRole('switch', { name: 'Show completed' }));
    await waitFor(() => expect(completedRows()).toHaveLength(2));
    await user.click(within(completedRows()[0]!).getByRole('checkbox'));
    await waitFor(() => expect(toastWith("Couldn't save — try again")).not.toBeNull());
    expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(completedRows().map((r) => r.querySelector('p')?.textContent)).toEqual([DONE_1.name, DONE_2.name]));
    expect(screen.getByRole('listbox', { name: 'Tasks' }).querySelectorAll('[role="option"]')).toHaveLength(1);
  });

  it('TC-C29 the toggle is remembered: on after a remount; rows stay on screen while completed tasks load', async () => {
    let release!: () => void;
    const api = taskServer([A, B, DONE_1]);
    const { user, unmount } = await ready(api);
    api.hold.list = new Promise<void>((resolve) => (release = resolve));
    await user.click(screen.getByRole('switch', { name: 'Show completed' }));
    expect(localStorage.getItem(showCompletedKey(ID, 'inbox'))).toBe('1');
    // Slow response: the open rows stay (no skeleton, no empty state flash).
    expect(rowNames()).toEqual([A.name, B.name]);
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
    expect(screen.queryByText(/Your Inbox is clear/)).toBeNull();
    release();
    await waitFor(() => expect(completedRows()).toHaveLength(1));
    unmount();
    api.hold.list = undefined;
    await enterWithTaskServer(api);
    expect(screen.getByRole('switch', { name: 'Show completed' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(completedRows()).toHaveLength(1));
  });

  it('TC-C29 with throwing storage the toggle still works, defaults off, and nothing crashes', async () => {
    const restore = makeStorageUnavailable();
    try {
      const { user } = await ready(taskServer([A, DONE_1]));
      const toggle = screen.getByRole('switch', { name: 'Show completed' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      await waitFor(() => expect(completedRows()).toHaveLength(1));
    } finally {
      restore();
    }
  });
});

describe('ui.task_actions: keyboard', () => {
  it('TC-C16 on a focused row: E opens the detail; Delete deletes with a toast and no dialog; Space completes', async () => {
    setReducedMotion(true);
    const { user, api } = await ready(taskServer([A, B, C, D]));
    rowNamed(A.name).focus();
    await user.keyboard('e');
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rowNamed(A.name)).toHaveFocus();

    await user.keyboard('{Delete}');
    await waitFor(() => expect(rowNames()).toEqual([B.name, C.name, D.name]));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    expect(rowNamed(B.name)).toHaveFocus();

    await user.keyboard(' ');
    await waitFor(() => expect(rowNames()).toEqual([C.name, D.name]));
    expect(api.callsOf('complete').map((c) => c.id)).toEqual([B.id]);
    expect(api.callsOf('delete').map((c) => c.id)).toEqual([A.id]);

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(rowNames()).toEqual([D.name]));
    expect(api.callsOf('delete').map((c) => c.id)).toEqual([A.id, C.id]);
  });

  it('TC-C17 E or Delete while typing in quick add are typed, not shortcuts', async () => {
    const { user, api } = await ready();
    rowNamed(A.name).focus();
    await user.keyboard('q');
    const name = await screen.findByRole('textbox', { name: 'Task name' });
    await user.keyboard('Eve');
    await user.keyboard('{Backspace}{Delete}');
    expect(name).toHaveValue('Ev');
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
    expect(api.callsOf('delete')).toEqual([]);
    expect(rowNames()).toEqual([A.name, B.name, C.name]);
  });

  it('Space on a non-row control keeps its native meaning (no task is completed)', async () => {
    const { user, api } = await ready();
    screen.getByRole('switch', { name: 'Show completed' }).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('switch', { name: 'Show completed' })).toHaveAttribute('aria-checked', 'true');
    expect(api.callsOf('complete')).toEqual([]);
  });

  it.each([
    ['only', [A], 0, 'add'],
    ['first', [A, B, C], 0, B.name],
    ['middle', [A, B, C], 1, C.name],
    ['last', [A, B, C], 2, B.name],
  ] as const)('TC-C27 completing the focused row (%s) moves focus to %s', async (_label, tasks, index, expected) => {
    setReducedMotion(true);
    const { user } = await ready(taskServer([...tasks]));
    const target = rows()[index]!;
    target.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(rows()).toHaveLength(tasks.length - 1));
    if (expected === 'add') {
      const add = screen.getAllByRole('button', { name: 'Add task' }).find((b) => !b.hasAttribute('data-fab'))!;
      expect(add).toHaveFocus();
    } else {
      expect(rowNamed(expected)).toHaveFocus();
      expect(rowNamed(expected)).toHaveAttribute('tabindex', '0');
    }
  });

  it('TC-C27 with the animation, focus moves when the row leaves (after COMPLETE_ANIMATION_MS)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const { user } = await ready();
    rowNamed(B.name).focus();
    await user.keyboard(' ');
    expect(rowNamed(B.name)).toHaveFocus();
    await act(async () => vi.advanceTimersByTime(COMPLETE_ANIMATION_MS + 50));
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
    expect(rowNamed(C.name)).toHaveFocus();
  });

  it('a failed delete brings focus back to the restored row', async () => {
    const api = taskServer([A, B, C]);
    api.fail.delete = 500;
    const { user } = await ready(api);
    rowNamed(B.name).focus();
    await user.keyboard('{Delete}');
    await waitFor(() => expect(toastWith("Couldn't save — try again")).not.toBeNull());
    await waitFor(() => expect(rowNamed(B.name)).toHaveFocus());
  });
});

describe('ui.undo: keyboard undo and pause', () => {
  it('TC-C25 mod+z with a toast visible and focus on a row sends the inverse; inside quick add it sends nothing and is not prevented', async () => {
    setReducedMotion(true);
    const { user, api } = await ready();
    rowNamed(A.name).focus();
    await user.keyboard('{Delete}');
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    // Focus is on row B now (not typing): Ctrl+Z (happy-dom is not a Mac) undoes the delete.
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(rowNames()).toEqual([A.name, B.name, C.name]));
    expect(api.callsOf('restore').map((c) => c.id)).toEqual([A.id]);

    rowNamed(C.name).focus();
    await user.keyboard('{Delete}');
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    await user.keyboard('q');
    const input = await screen.findByRole('textbox', { name: 'Task name' });
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.callsOf('restore')).toHaveLength(1);
    expect(rowNames()).not.toContain(C.name);
  });

  it('mod+z with no active toast does nothing and is not prevented', async () => {
    const { api } = await ready();
    rowNamed(A.name).focus();
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    rowNamed(A.name).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(api.callsOf('restore')).toEqual([]);
    expect(api.callsOf('reopen')).toEqual([]);
  });

  it('TC-C26 complete A, delete B, mod+z: only B is restored; the A toast is still counting', async () => {
    setReducedMotion(true);
    const { user, api } = await ready(taskServer([A, B, C]));
    await user.click(checkbox(rowNamed(A.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    rowNamed(B.name).focus();
    await user.keyboard('{Delete}');
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(rowNames()).toEqual([B.name, C.name]));
    expect(api.callsOf('restore').map((c) => c.id)).toEqual([B.id]);
    expect(api.callsOf('reopen')).toEqual([]);
    expect(toastWith('Task completed')).not.toBeNull();
    await waitFor(() => expect(toastWith('Task deleted')).toBeNull());
  });

  it("TC-C22 the Undo call returns 500: alert Couldn't undo; the task stays deleted on screen", async () => {
    const api = taskServer([A, B, C]);
    api.fail.restore = 500;
    const { user } = await ready(api);
    await menuDelete(user, B.name);
    await waitFor(() => expect(toastWith('Task deleted')).not.toBeNull());
    await user.click(within(toastWith('Task deleted')!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toastWith("Couldn't undo — try again")).not.toBeNull());
    expect(toastWith("Couldn't undo — try again")).toHaveAttribute('role', 'alert');
    expect(rowNames()).toEqual([A.name, C.name]);
  });

  it('TC-C22 an Undo of a completion that fails keeps the task completed on screen', async () => {
    setReducedMotion(true);
    const api = taskServer([A, B, C]);
    api.fail.reopen = 500;
    const { user } = await ready(api);
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    await user.click(within(toastWith('Task completed')!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(toastWith("Couldn't undo — try again")).not.toBeNull());
    expect(rowNames()).toEqual([A.name, C.name]);
  });

  it('TC-C24 hovering the toast for 20000 ms keeps it; it goes UNDO_WINDOW_MS of unpaused time after leaving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    setReducedMotion(true);
    const { user } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    const toast = toastWith('Task completed')!;
    fireEvent.pointerEnter(toast);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(toastWith('Task completed')).not.toBeNull();
    fireEvent.pointerLeave(toast);
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1_000));
    expect(toastWith('Task completed')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(2_000));
    await waitFor(() => expect(toastWith('Task completed')).toBeNull());
  });

  it('TC-C24 focus on Undo for 20000 ms keeps the toast; it goes UNDO_WINDOW_MS after focus leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    setReducedMotion(true);
    const { user } = await ready();
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(toastWith('Task completed')).not.toBeNull());
    const undo = within(toastWith('Task completed')!).getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(toastWith('Task completed')).not.toBeNull();
    act(() => undo.blur());
    await act(async () => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1_000));
    expect(toastWith('Task completed')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(2_000));
    await waitFor(() => expect(toastWith('Task completed')).toBeNull());
  });
});

describe('ui.task_actions: accessibility and touch', () => {
  it('TC-C18 checkbox named Complete NAME / Reopen NAME; menu items show E and Del; hit areas use MIN_TOUCH_TARGET_PX', async () => {
    const { user } = await ready(taskServer([A, DONE_1]));
    expect(within(rowNamed(A.name)).getByRole('checkbox', { name: `Complete ${A.name}` })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Show completed' }));
    await waitFor(() => expect(completedRows()).toHaveLength(1));
    expect(within(completedRows()[0]!).getByRole('checkbox', { name: `Reopen ${DONE_1.name}` })).toBeInTheDocument();
    const trigger = within(rowNamed(A.name)).getByRole('button', { name: `More actions for ${A.name}` });
    // The hit-area classes read the generated --min-touch-target (MIN_TOUCH_TARGET_PX, pinned by the constants test).
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
    expect(trigger).toHaveClass('min-h-[var(--min-touch-target)]', 'min-w-[var(--min-touch-target)]');
    expect(within(rowNamed(A.name)).getByRole('checkbox')).toHaveClass('min-h-[var(--min-touch-target)]', 'min-w-[var(--min-touch-target)]');
    await user.click(trigger);
    const edit = await screen.findByRole('menuitem', { name: 'Edit' });
    const del = screen.getByRole('menuitem', { name: 'Delete' });
    expect(edit).toHaveTextContent('E');
    expect(edit).toHaveAttribute('aria-keyshortcuts', 'E');
    expect(del).toHaveTextContent('Del');
    expect(del).toHaveAttribute('aria-keyshortcuts', 'Delete');
  });

  it('TC-C30 hover:none: the row menu trigger is visible without hover (touch:opacity-100)', async () => {
    setViewport({ width: 390, coarse: true });
    await ready();
    const trigger = within(rowNamed(A.name)).getByRole('button', { name: `More actions for ${A.name}` });
    expect(trigger).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100', 'touch:opacity-100');
    // Nothing inside the option takes focus (axe nested-interactive): the row is the keyboard target.
    for (const control of [trigger, within(rowNamed(A.name)).getByRole('checkbox')]) {
      expect(control).not.toHaveAttribute('tabindex');
      expect(control.tagName).toBe('SPAN');
    }
    expect(rowNamed(A.name)).toHaveAccessibleName(A.name);
  });

  it('TC-C31 a failing edit: the row is aria-busy while it saves, then not; the failure toast is role=alert', async () => {
    let release!: () => void;
    const api = taskServer([A, B, C]);
    api.hold.patch = new Promise<void>((resolve) => (release = resolve));
    api.fail.patch = 500;
    const { user } = await ready(api);
    await user.click(within(rowNamed(A.name)).getByText(A.name));
    const input = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, 'Buy oat milk{Enter}');
    // The sheet is modal (the list is aria-hidden behind it), so the row is found by its id.
    const row = () => document.querySelector(`[data-task-id="${A.id}"]`)!;
    await waitFor(() => expect(row()).toHaveAttribute('aria-busy', 'true'));
    expect(row().querySelector('p')).toHaveTextContent('Buy oat milk');
    release();
    await waitFor(() => expect(toastWith("Couldn't save — try again")).toHaveAttribute('role', 'alert'));
    await waitFor(() => expect(row()).not.toHaveAttribute('aria-busy'));
    expect(row().querySelector('p')).toHaveTextContent(A.name);
  });

  it('TC-C31 the row is aria-busy while its completion saves (animated), then not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    let release!: () => void;
    const api = taskServer([A, B, C]);
    api.hold.complete = new Promise<void>((resolve) => (release = resolve));
    const { user } = await ready(api);
    await user.click(checkbox(rowNamed(B.name)));
    await waitFor(() => expect(rowNamed(B.name)).toHaveAttribute('aria-busy', 'true'));
    release();
    await waitFor(() => expect(rowNamed(B.name)).not.toHaveAttribute('aria-busy'));
    await act(async () => vi.advanceTimersByTime(COMPLETE_ANIMATION_MS));
    await waitFor(() => expect(rowNames()).toEqual([A.name, C.name]));
  });
});
