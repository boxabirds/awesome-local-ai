import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InboxView } from '@/features/tasks/InboxView';
import { server } from '../../msw';
import { TASK_WS_ID, taskHandlers } from '../../msw/tasks';
import { pressTab, renderWithProviders, stubViewport } from '../helpers';

/** Renders the Inbox with a recording create endpoint; returns the POSTed bodies. */
async function renderInbox({ emptyText = 'Your Inbox is clear. Press Q to add a task.' } = {}) {
  const bodies: unknown[] = [];
  server.use(taskHandlers.list([]), taskHandlers.create(bodies));
  await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit />);
  await screen.findByText(emptyText);
  return bodies;
}

const addTaskButton = () => screen.getByRole('button', { name: 'Add task' });
const form = () => screen.getByRole('form', { name: 'Add task' });
const nameField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Task name' });
const descriptionField = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Description' });
const addButton = () => within(form()).getByRole('button', { name: 'Add' });

function openQuickAdd() {
  fireEvent.click(addTaskButton());
  expect(form()).toBeInTheDocument();
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    fireEvent.change(field, { target: { value } });
  });
}

function pressEnter(field: HTMLElement, init: KeyboardEventInit = {}) {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(field, { key: 'Enter', ...init });
  });
  return notPrevented;
}

/** Lets MSW answer and the cache settle. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

describe('QuickAdd', () => {
  it('opens from "+ Add task" with the name focused', async () => {
    await renderInbox();
    openQuickAdd();
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveAttribute('placeholder', 'Task name');
    expect(descriptionField()).toHaveAttribute('placeholder', 'Description');
  });

  it('TC-51 an empty name: Add disabled, Enter creates nothing', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    expect(addButton()).toBeDisabled();
    pressEnter(nameField());
    fireEvent.submit(form());
    await settle();
    expect(bodies).toEqual([]);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('TC-52 a whitespace-only name: Add disabled, Enter creates nothing', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), '   \t ');
    expect(addButton()).toBeDisabled();
    pressEnter(nameField());
    await settle();
    expect(bodies).toEqual([]);
  });

  it('TC-53 Enter adds once: row appears, fields clear, name keeps focus, box stays open', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), 'Buy milk');
    type(descriptionField(), 'semi-skimmed');
    pressEnter(nameField());
    expect(await screen.findByRole('option', { name: /Buy milk/ })).toBeInTheDocument();
    await settle();
    expect(bodies).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Buy milk', description: 'semi-skimmed' }]);
    expect(nameField()).toHaveValue('');
    expect(descriptionField()).toHaveValue('');
    expect(nameField()).toHaveFocus();
    expect(form()).toBeInTheDocument();
  });

  it('trims the name it sends; each task gets a new id', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), '  One  ');
    pressEnter(nameField());
    type(nameField(), 'Two');
    pressEnter(nameField());
    await settle();
    expect(bodies.map((b) => (b as { name: string }).name)).toEqual(['One', 'Two']);
    const ids = bodies.map((b) => (b as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('TC-54 Escape with text typed closes without a request; focus returns to "+ Add task"', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), 'Never mind');
    act(() => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });
    expect(screen.queryByRole('form', { name: 'Add task' })).not.toBeInTheDocument();
    expect(addTaskButton()).toHaveFocus();
    await settle();
    expect(bodies).toEqual([]);
    // Reopening starts empty: the text was discarded.
    openQuickAdd();
    expect(nameField()).toHaveValue('');
  });

  it('Cancel closes the same way', async () => {
    await renderInbox();
    openQuickAdd();
    fireEvent.click(within(form()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add task' })).not.toBeInTheDocument();
    expect(addTaskButton()).toHaveFocus();
  });

  it('TC-55 a 449-character name shows no counter', async () => {
    await renderInbox();
    openQuickAdd();
    type(nameField(), 'a'.repeat(Math.ceil(TASK_NAME_MAX * 0.9) - 1));
    expect(screen.queryByText(/characters? (left|over)/)).not.toBeInTheDocument();
    expect(nameField()).not.toHaveAttribute('aria-describedby');
  });

  it('TC-56 a 450-character name shows "50 characters left", announced politely', async () => {
    await renderInbox();
    openQuickAdd();
    type(nameField(), 'a'.repeat(450));
    const counter = screen.getByText('50 characters left', { selector: 'p[id]' });
    expect(nameField()).toHaveAttribute('aria-describedby', counter.id);
    expect(nameField()).not.toHaveAttribute('aria-invalid');
    const live = screen.getByText('50 characters left', { selector: '[aria-live="polite"]' });
    expect(live).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it('the counter announcement is throttled to once per COUNTER_ANNOUNCE_THROTTLE_MS', async () => {
    await renderInbox();
    openQuickAdd();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    type(nameField(), 'a'.repeat(450));
    const live = () => document.querySelector('[aria-live="polite"]')!;
    expect(live()).toHaveTextContent('50 characters left');
    type(nameField(), 'a'.repeat(451));
    type(nameField(), 'a'.repeat(452));
    expect(screen.getByText('48 characters left', { selector: 'p[id]' })).toBeInTheDocument();
    expect(live()).toHaveTextContent('50 characters left');
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(live()).toHaveTextContent('48 characters left');
  });

  it('TC-57 typing past 500 keeps every character: "1 character over", warning icon, Add disabled, Enter does nothing', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), 'a'.repeat(TASK_NAME_MAX));
    expect(screen.getByText('0 characters left', { selector: 'p[id]' })).toBeInTheDocument();
    type(nameField(), 'a'.repeat(TASK_NAME_MAX + 1));
    expect(nameField().value).toHaveLength(501);
    expect(nameField()).not.toHaveAttribute('maxlength');
    const counter = screen.getByText('1 character over', { selector: 'p[id]' });
    expect(counter.querySelector('svg[data-icon="warning"]')).not.toBeNull();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(addButton()).toBeDisabled();
    pressEnter(nameField());
    act(() => {
      fireEvent.keyDown(nameField(), { key: 'Enter', ctrlKey: true });
    });
    await settle();
    expect(bodies).toEqual([]);
    expect(nameField().value).toHaveLength(501);
  });

  it('TC-58 pasting 600 characters keeps all 600: "100 characters over", Add disabled', async () => {
    await renderInbox();
    openQuickAdd();
    const pasted = 'p'.repeat(600);
    act(() => {
      fireEvent.paste(nameField(), { clipboardData: { getData: () => pasted } });
      fireEvent.change(nameField(), { target: { value: pasted } });
    });
    expect(nameField().value).toBe(pasted);
    expect(screen.getByText('100 characters over', { selector: 'p[id]' })).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  it('TC-59 in the description ⌘/Ctrl+Enter adds; plain Enter is a new line and adds nothing', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), 'Email Sam');
    act(() => descriptionField().focus());
    type(descriptionField(), 'line one');
    expect(pressEnter(descriptionField())).toBe(true); // not prevented: the browser inserts the newline
    await settle();
    expect(bodies).toEqual([]);
    type(descriptionField(), 'line one\nline two');
    pressEnter(descriptionField(), { ctrlKey: true });
    await settle();
    expect(bodies).toEqual([expect.objectContaining({ name: 'Email Sam', description: 'line one\nline two' })]);
    type(nameField(), 'Second');
    pressEnter(nameField(), { metaKey: true });
    await settle();
    expect(bodies).toHaveLength(2);
  });

  it('TC-116 Enter while an IME is composing sends nothing', async () => {
    const bodies = await renderInbox();
    openQuickAdd();
    type(nameField(), 'Buy');
    pressEnter(nameField(), { isComposing: true });
    pressEnter(nameField(), { keyCode: 229 });
    await settle();
    expect(bodies).toEqual([]);
    expect(nameField()).toHaveValue('Buy');
  });

  it('TC-117 Tab goes from name to description, Shift+Tab back', async () => {
    await renderInbox();
    openQuickAdd();
    expect(nameField()).toHaveFocus();
    pressTab();
    expect(descriptionField()).toHaveFocus();
    pressTab({ shift: true });
    expect(nameField()).toHaveFocus();
  });

  it('TC-118 the chip reads "→ Inbox" and the form is described as adding to the Inbox', async () => {
    await renderInbox();
    openQuickAdd();
    const chip = document.getElementById(form().getAttribute('aria-describedby')!)!;
    expect(chip).toHaveTextContent('→ Inbox');
    expect(chip.tabIndex).toBe(-1);
    expect(form()).toHaveAccessibleDescription(/Inbox/);
  });

  it('TC-119 a 5,001-character description is aria-invalid and described by a counter with a warning icon', async () => {
    await renderInbox();
    openQuickAdd();
    type(nameField(), 'Notes');
    type(descriptionField(), 'd'.repeat(TASK_DESCRIPTION_MAX + 1));
    expect(descriptionField()).toHaveAttribute('aria-invalid', 'true');
    const counter = document.getElementById(descriptionField().getAttribute('aria-describedby')!)!;
    expect(counter).toHaveTextContent('1 character over');
    expect(counter.querySelector('svg[data-icon="warning"]')).not.toBeNull();
    expect(descriptionField().value).toHaveLength(TASK_DESCRIPTION_MAX + 1);
    expect(addButton()).toBeDisabled();
  });

  it('TC-120 opened from the floating button (docked), Escape returns focus to it', async () => {
    stubViewport({ width: 390, coarse: true });
    await renderInbox({ emptyText: 'Your Inbox is clear. Tap + to add a task.' });
    const fab = screen.getByRole('button', { name: 'Add task' });
    act(() => fab.focus());
    fireEvent.click(fab);
    expect(form()).toHaveAttribute('data-mode', 'docked');
    expect(nameField()).toHaveFocus();
    act(() => {
      fireEvent.keyDown(nameField(), { key: 'Escape' });
    });
    expect(screen.queryByRole('form', { name: 'Add task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBe(fab);
    expect(fab).toHaveFocus();
  });
});
