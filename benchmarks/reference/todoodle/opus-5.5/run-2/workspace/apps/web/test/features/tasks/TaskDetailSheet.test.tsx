import type { LiveEvent } from '@todoodle/shared/events';
import { NAME_HINT_MS, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dispatchEvent } from '@/features/live/dispatch';
import { editGuards } from '@/features/live/editGuard';
import { queryClient } from '@/lib/queryClient';
import { stubViewport } from '../helpers';
import { TASK_WS_ID } from '../../msw/tasks';
import { advance, failWith, fakeTime, focusRow, fourTasks, renderInbox, rowNames, settle } from './lifecycle-helpers';

const NAMES = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞', 'Book dentist — ask about Tuesday'];
const sheet = () => screen.getByRole('dialog', { name: 'Task details' });
const nameField = () => within(sheet()).getByRole('textbox', { name: 'Name' });
const descriptionField = () => within(sheet()).getByRole('textbox', { name: 'Description' });
/** The row, found even while the modal sheet hides the page from the accessibility tree. */
const hiddenRow = (name: string) => screen.getByRole('listitem', { name, hidden: true });
const liveRow = (name: string) => screen.getByRole('listitem', { name });

async function openByName(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  await screen.findByRole('dialog', { name: 'Task details' });
  await settle();
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function escape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

describe('opening and editing', () => {
  it('TC-C05 clicking a task name opens the sheet with the name focused and the description shown', async () => {
    await renderInbox(fourTasks());
    await openByName('Buy milk');
    expect(nameField()).toHaveValue('Buy milk');
    expect(document.activeElement).toBe(nameField());
    expect(descriptionField()).toHaveValue('Semi-skimmed, 2 pints');
  });

  it('TC-C06 edit the name and press Enter: PATCH with the trimmed name; the row shows it at once', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Buy milk');
    type(nameField(), '  Buy oat milk  ');
    fireEvent.keyDown(nameField(), { key: 'Enter' });
    await settle(5);
    expect(hiddenRow('Buy oat milk')).toBeInTheDocument();
    await settle();
    expect(srv.sent).toEqual([{ op: 'patch', id: expect.any(String), body: { name: 'Buy oat milk' } }]);
    expect(nameField()).toHaveValue('Buy oat milk');
  });

  it('TC-C07 edit the description and blur: PATCH with the description', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Buy milk');
    act(() => descriptionField().focus());
    type(descriptionField(), 'Oat, 1 litre\nand bread');
    act(() => descriptionField().blur());
    await settle();
    expect(srv.sent).toEqual([{ op: 'patch', id: expect.any(String), body: { description: 'Oat, 1 litre\nand bread' } }]);
  });

  it('TC-C08 Escape during an edit sends nothing and reverts the field; a second Escape closes the sheet', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Buy milk');
    type(nameField(), 'Buy oat milk');
    escape();
    await settle();
    expect(nameField()).toHaveValue('Buy milk');
    expect(sheet()).toBeInTheDocument();
    escape();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(srv.sent).toEqual([]);
    expect(rowNames()).toEqual(NAMES);
  });

  it('TC-C09 clearing the name and pressing Enter sends nothing; the old name returns with the hint for NAME_HINT_MS', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Buy milk');
    fakeTime();
    type(nameField(), '   ');
    fireEvent.keyDown(nameField(), { key: 'Enter' });
    await advance(0);
    expect(nameField()).toHaveValue('Buy milk');
    expect(within(sheet()).getByText("Name can't be empty")).toBeVisible();
    await advance(NAME_HINT_MS - 1);
    expect(within(sheet()).getByText("Name can't be empty")).toBeInTheDocument();
    await advance(1);
    expect(within(sheet()).queryByText("Name can't be empty")).not.toBeInTheDocument();
    expect(srv.sent).toEqual([]);
  });

  it('TC-C10 typing past TASK_NAME_MAX keeps the text, shows how far over, and Enter sends nothing', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Buy milk');
    const long = 'a'.repeat(TASK_NAME_MAX + 12);
    type(nameField(), long);
    fireEvent.keyDown(nameField(), { key: 'Enter' });
    act(() => nameField().blur());
    await settle();
    expect(nameField()).toHaveValue(long);
    // The visible counter (the field's description); a polite live region repeats it for screen readers.
    const counter = document.getElementById(nameField().getAttribute('aria-describedby')!)!;
    expect(counter).toHaveTextContent('12 characters over');
    expect(counter).toHaveClass('text-destructive');
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(srv.sent).toEqual([]);
  });

  it('TC-C11 a 410 on save shows the deleted notice, closes the sheet and removes the row', async () => {
    await renderInbox(fourTasks(), { patch: failWith(410) });
    await openByName('Call Mum 📞');
    type(nameField(), 'Call Mum on Sunday');
    fireEvent.keyDown(nameField(), { key: 'Enter' });
    expect(await screen.findByText('This task was deleted')).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowNames()).toEqual([NAMES[0], NAMES[1], NAMES[3]]);
    expect(screen.queryByText("Couldn't save — try again")).not.toBeInTheDocument();
  });
});

describe('others change the task while it is open', () => {
  it('TC-C19 someone else renames the task being edited: conflict notice with Use my version and Keep theirs', async () => {
    const tasks = fourTasks();
    const srv = await renderInbox(tasks);
    await openByName('Buy milk');
    type(nameField(), 'Buy oat milk');
    const event: LiveEvent = {
      type: 'task.upserted',
      entity: { ...tasks[0]!, name: 'Buy almond milk', version: 2 },
      version: 2,
      originClientId: '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f',
    };
    act(() => {
      dispatchEvent({ queryClient, workspaceId: TASK_WS_ID, editGuard: editGuards }, event);
    });
    const notice = await within(sheet()).findByRole('alert');
    expect(notice).toHaveTextContent('Someone else changed this just now.');
    expect(notice).toHaveTextContent('Buy almond milk');
    expect(within(notice).getByRole('button', { name: 'Use my version' })).toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: 'Keep theirs' }));
    await settle();
    expect(within(sheet()).queryByRole('alert')).not.toBeInTheDocument();
    expect(nameField()).toHaveValue('Buy almond milk');
    expect(srv.sent).toEqual([]);
  });

  it('someone else deletes the open task: "This task was deleted" and the sheet closes', async () => {
    const tasks = fourTasks();
    await renderInbox(tasks);
    await openByName('Email Sam re: invoice #4411');
    act(() => {
      dispatchEvent(
        { queryClient, workspaceId: TASK_WS_ID, editGuard: editGuards },
        { type: 'task.deleted', entity: { id: tasks[1]!.id }, version: 2, originClientId: null },
      );
    });
    expect(await screen.findByText('This task was deleted')).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus goes to the row now in its place.
    expect(document.activeElement).toBe(liveRow('Call Mum 📞'));
  });
});

describe('focus', () => {
  it('TC-C28 closing with Escape returns focus to the row it was opened from', async () => {
    await renderInbox(fourTasks());
    focusRow('Call Mum 📞');
    fireEvent.keyDown(document.activeElement!, { key: 'e' });
    await screen.findByRole('dialog', { name: 'Task details' });
    await settle();
    escape();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(liveRow('Call Mum 📞'));
    expect(liveRow('Call Mum 📞').tabIndex).toBe(0);
  });

  it('TC-C28 Delete in the sheet deletes at once (no dialog), closes it and focuses the next row', async () => {
    const srv = await renderInbox(fourTasks());
    await openByName('Email Sam re: invoice #4411');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Task deleted')).toBeInTheDocument();
    expect(rowNames()).toEqual([NAMES[0], NAMES[2], NAMES[3]]);
    expect(document.activeElement).toBe(liveRow('Call Mum 📞'));
    expect(srv.sent.map((s) => s.op)).toEqual(['delete']);
  });
});

describe('TC-C30 small touch screens', () => {
  it('the sheet uses the full-screen layout below MOBILE_BREAKPOINT_PX; the row menu is visible without hover', async () => {
    stubViewport({ width: 390, coarse: true });
    await renderInbox(fourTasks());
    const trigger = screen.getByRole('button', { name: 'Actions for Buy milk' });
    expect(trigger.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
    await openByName('Buy milk');
    // Full screen by default (inset-0, full width); the side panel only from md (768px) up.
    expect(sheet()).toHaveClass('inset-0', 'w-full', 'md:w-[28rem]');
    expect(sheet().className).not.toMatch(/(^|\s)w-72(\s|$)/);
  });

  it('with a mouse, the menu button is hidden until the row is hovered or focused', async () => {
    stubViewport({ width: 1280, coarse: false });
    await renderInbox(fourTasks());
    const trigger = screen.getByRole('button', { name: 'Actions for Buy milk' });
    expect(trigger).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-within:opacity-100');
  });
});
