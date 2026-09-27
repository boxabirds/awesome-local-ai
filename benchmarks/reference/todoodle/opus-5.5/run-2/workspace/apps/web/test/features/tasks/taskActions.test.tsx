import { COMPLETE_ANIMATION_MS, MIN_TOUCH_TARGET_PX, UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';
import { openMenu } from '../../render';
import {
  advance,
  checkbox,
  failWith,
  fakeTime,
  focusRow,
  fourTasks,
  renderInbox,
  rowFor,
  rowNames,
  settle,
  stubReducedMotion,
  toastGone,
} from './lifecycle-helpers';

const NAMES = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞', 'Book dentist — ask about Tuesday'];
const status = (text: string) => screen.findByText(text);
const undoButton = () => screen.getByRole('button', { name: 'Undo' });

describe('completing a task', () => {
  it('TC-C01 the tick shows at once; the row stays until COMPLETE_ANIMATION_MS, then leaves; status toast with Undo', async () => {
    const srv = await renderInbox(fourTasks());
    queryClient.setQueryData(qk.counts(fourTasks()[0]!.workspaceId), { inbox: 4 });
    fakeTime();
    fireEvent.click(checkbox('Call Mum 📞'));
    expect(checkbox('Call Mum 📞')).toHaveAttribute('aria-checked', 'true');
    expect(rowFor('Call Mum 📞')).toHaveClass('task-leaving');
    await advance(COMPLETE_ANIMATION_MS - 1);
    expect(rowNames()).toContain('Call Mum 📞');
    await advance(1);
    await advance(20);
    expect(rowNames()).toEqual([NAMES[0], NAMES[1], NAMES[3]]);
    expect(srv.sent).toEqual([{ op: 'complete', id: expect.any(String) }]);
    const toast = screen.getByText('Task completed').closest('[role="status"]')!;
    expect(within(toast as HTMLElement).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(queryClient.getQueryData(qk.counts(fourTasks()[0]!.workspaceId))).toEqual({ inbox: 3 });
  });

  it('TC-C02 a 500 puts the row back at the same index with an alert "Couldn\'t save — try again"', async () => {
    await renderInbox(fourTasks(), { complete: failWith(500) });
    fireEvent.click(checkbox('Email Sam re: invoice #4411'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save — try again");
    await settle(COMPLETE_ANIMATION_MS + 50);
    expect(rowNames()).toEqual(NAMES);
    expect(checkbox('Email Sam re: invoice #4411')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('Task completed')).not.toBeInTheDocument();
  });

  it('TC-C03 Undo within the window sends reopen and the row comes back at its index', async () => {
    const srv = await renderInbox(fourTasks());
    fireEvent.click(checkbox('Buy milk'));
    await status('Task completed');
    await settle(COMPLETE_ANIMATION_MS + 50);
    expect(rowNames()).toEqual(NAMES.slice(1));
    fireEvent.click(undoButton());
    expect(await status('Task restored')).toBeInTheDocument();
    await settle();
    expect(rowNames()).toEqual(NAMES);
    expect(srv.sent.map((s) => s.op)).toEqual(['complete', 'reopen']);
  });

  it('TC-C04 after UNDO_WINDOW_MS the toast is gone and no reopen is sent', async () => {
    const srv = await renderInbox(fourTasks());
    fakeTime();
    fireEvent.click(checkbox('Buy milk'));
    await advance(COMPLETE_ANIMATION_MS);
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    await advance(UNDO_WINDOW_MS - COMPLETE_ANIMATION_MS - 1);
    expect(toastGone('Task completed')).toBe(false);
    await advance(1);
    expect(toastGone('Task completed')).toBe(true);
    await advance(1_000);
    expect(srv.sent.map((s) => s.op)).toEqual(['complete']);
  });

  it('TC-C23 with reduced motion the row leaves at once, with no animation class', async () => {
    stubReducedMotion(true);
    await renderInbox(fourTasks());
    fireEvent.click(checkbox('Buy milk'));
    expect(checkbox('Buy milk')).toHaveAttribute('aria-checked', 'true');
    expect(rowFor('Buy milk')).not.toHaveClass('task-leaving');
    expect(rowFor('Buy milk')).not.toHaveAttribute('data-leaving');
    // Removed as soon as the change is applied (well under the animation time).
    await settle(10);
    expect(rowNames()).toEqual(NAMES.slice(1));
  });

  it('TC-C31 the row is aria-busy while its change is saving, not after; success toast is role=status', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await renderInbox(fourTasks(), {
      complete: async () => {
        await gate;
        return undefined;
      },
    });
    stubReducedMotion(false);
    fireEvent.click(checkbox('Call Mum 📞'));
    await settle(5);
    expect(rowFor('Call Mum 📞')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Task completed').closest('[role="status"]')).not.toBeNull();
    release();
    await settle(COMPLETE_ANIMATION_MS + 50);
    expect(rowNames()).not.toContain('Call Mum 📞');
  });

  it('TC-C31 a failing edit shows its message in role=alert and the row is not busy afterwards', async () => {
    const srv = await renderInbox(fourTasks(), { patch: failWith(500) });
    fireEvent.click(screen.getByRole('button', { name: 'Buy milk' }));
    const name = await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Buy oat milk' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save — try again");
    await settle();
    // The modal sheet hides the page from the accessibility tree meanwhile.
    expect(screen.getByRole('listitem', { name: 'Buy milk', hidden: true })).not.toHaveAttribute('aria-busy');
    expect(srv.sent.map((s) => s.op)).toEqual(['patch']);
  });
});

describe('deleting a task (no confirmation)', () => {
  it('TC-C12 menu Delete: no dialog, DELETE sent, row removed at once, status toast Task deleted with Undo', async () => {
    const srv = await renderInbox(fourTasks());
    await openMenu(screen.getByRole('button', { name: 'Actions for Call Mum 📞' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await settle(5);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual([NAMES[0], NAMES[1], NAMES[3]]);
    expect(screen.getByText('Task deleted').closest('[role="status"]')).not.toBeNull();
    expect(undoButton()).toBeInTheDocument();
    await settle();
    expect(srv.sent).toEqual([{ op: 'delete', id: expect.any(String) }]);
  });

  it('TC-C13 Delete then Undo: restore is sent and the row is back at its index', async () => {
    const srv = await renderInbox(fourTasks());
    await openMenu(screen.getByRole('button', { name: 'Actions for Email Sam re: invoice #4411' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await status('Task deleted');
    await settle();
    fireEvent.click(undoButton());
    await status('Task restored');
    await settle();
    expect(rowNames()).toEqual(NAMES);
    expect(srv.sent.map((s) => s.op)).toEqual(['delete', 'restore']);
  });

  it('TC-C14 a failed DELETE puts the row back and says so in an alert', async () => {
    await renderInbox(fourTasks(), { delete: failWith(500) });
    await openMenu(screen.getByRole('button', { name: 'Actions for Buy milk' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save — try again");
    await settle();
    expect(rowNames()).toEqual(NAMES);
    // The undo toast is dismissed (after sonner's exit animation).
    await expect.poll(() => screen.queryByText('Task deleted')).toBeNull();
  });

  it('TC-C22 a failing Undo says "Couldn\'t undo — try again" in an alert; the task stays deleted', async () => {
    await renderInbox(fourTasks(), { restore: failWith(500) });
    await openMenu(screen.getByRole('button', { name: 'Actions for Buy milk' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await status('Task deleted');
    fireEvent.click(undoButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo — try again");
    await settle();
    expect(rowNames()).toEqual(NAMES.slice(1));
  });

  it('TC-C22 a failing Undo of a completion leaves the task completed', async () => {
    await renderInbox(fourTasks(), { reopen: failWith(500) });
    fireEvent.click(checkbox('Buy milk'));
    await status('Task completed');
    await settle(COMPLETE_ANIMATION_MS + 50);
    fireEvent.click(undoButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't undo — try again");
    await settle();
    expect(rowNames()).toEqual(NAMES.slice(1));
  });
});

describe('keyboard', () => {
  it('TC-C16 on a focused row: E opens the detail, Delete deletes with a toast and no dialog, Space completes', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    fireEvent.keyDown(document.activeElement!, { key: 'e' });
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    focusRow('Email Sam re: invoice #4411');
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await status('Task deleted');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(rowNames()).not.toContain('Email Sam re: invoice #4411');

    focusRow('Call Mum 📞');
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(checkbox('Call Mum 📞')).toHaveAttribute('aria-checked', 'true');
    await settle(COMPLETE_ANIMATION_MS + 50);
    expect(rowNames()).toEqual([NAMES[0], NAMES[3]]);
    expect(srv.sent.map((s) => s.op)).toEqual(['delete', 'complete']);
  });

  it('Backspace on a focused row deletes too', async () => {
    const srv = await renderInbox(fourTasks());
    focusRow('Buy milk');
    fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    await status('Task deleted');
    expect(srv.sent.map((s) => s.op)).toEqual(['delete']);
  });

  it('TC-C17 E and Delete typed in quick add are text, not shortcuts', async () => {
    const srv = await renderInbox(fourTasks());
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const field = screen.getByRole('textbox', { name: 'Task name' });
    act(() => field.focus());
    for (const key of ['e', 'Delete', 'Backspace', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => {
        field.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(srv.sent).toEqual([]);
    expect(rowNames()).toEqual(NAMES);
  });

  it('with no row focused, Space and Delete keep their default', async () => {
    await renderInbox(fourTasks());
    const button = screen.getByRole('button', { name: 'Add task' });
    act(() => button.focus());
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('TC-C27 completing the focused row moves focus: only -> add task, first -> next, middle -> next, last -> previous', async () => {
    const cases: Array<[string[], string, string]> = [
      [['Buy milk'], 'Buy milk', 'Add task'],
      [NAMES, NAMES[0]!, NAMES[1]!],
      [NAMES, NAMES[1]!, NAMES[2]!],
      [NAMES, NAMES[3]!, NAMES[2]!],
    ];
    for (const [names, target, expected] of cases) {
      const tasks = fourTasks().filter((t) => names.includes(t.name));
      const { unmount } = await renderInbox(tasks);
      focusRow(target);
      fireEvent.keyDown(document.activeElement!, { key: ' ' });
      await settle(COMPLETE_ANIMATION_MS + 60);
      const active = document.activeElement as HTMLElement;
      if (expected === 'Add task') expect(active).toBe(screen.getByRole('button', { name: 'Add task' }));
      else expect(active).toBe(rowFor(expected));
      expect(active.tabIndex).toBe(0);
      unmount();
      queryClient.clear();
    }
  });
});

describe('row structure and names', () => {
  it('TC-C18 checkbox named Complete NAME; menu items show E and Del; hit areas at least MIN_TOUCH_TARGET_PX', async () => {
    await renderInbox(fourTasks());
    const box = checkbox('Buy milk');
    expect(box).toHaveAccessibleName('Complete Buy milk');
    expect(box.style.minWidth).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    expect(box.style.minHeight).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    const trigger = screen.getByRole('button', { name: 'Actions for Buy milk' });
    expect(trigger.style.minWidth).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    expect(trigger.style.minHeight).toBe(`${MIN_TOUCH_TARGET_PX}px`);
    await openMenu(trigger);
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    const del = screen.getByRole('menuitem', { name: 'Delete' });
    expect(edit).toHaveTextContent(/Edit\s*E$/);
    expect(del).toHaveTextContent(/Delete\s*Del$/);
    expect(edit).toHaveAttribute('aria-keyshortcuts', 'E');
    expect(del).toHaveAttribute('aria-keyshortcuts', 'Delete');
  });

  it('TC-C21 a failed reopen from the completed group puts the row back there, with an alert', async () => {
    const [milk, invoice] = fourTasks();
    const done = { ...invoice!, completedAt: '2026-09-26T08:00:00.000Z' };
    window.localStorage.setItem(`tdl:showCompleted:${milk!.workspaceId}:inbox`, '1');
    await renderInbox([milk!, done], { reopen: failWith(500) });
    await screen.findByRole('checkbox', { name: 'Reopen Email Sam re: invoice #4411' });
    fireEvent.click(checkbox('Email Sam re: invoice #4411'));
    expect(checkbox('Email Sam re: invoice #4411')).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save — try again");
    await settle();
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411']);
    expect(checkbox('Email Sam re: invoice #4411')).toHaveAttribute('aria-checked', 'true');
    expect(checkbox('Email Sam re: invoice #4411')).toHaveAccessibleName('Reopen Email Sam re: invoice #4411');
  });
});
