import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import { warningThreshold } from '@/features/tasks/canSubmit';
import { recordRequests } from '../../support/fixtures.ts';
import { ID, enterInbox, rowNames, setViewport } from '../../support/tasks.tsx';

const POST = `POST /api/w/${ID}/tasks`;

function addTaskButton(): HTMLElement {
  return screen.getAllByRole('button', { name: 'Add task' }).find((button) => !button.hasAttribute('data-fab'))!;
}

function fab(): HTMLElement {
  return screen.getAllByRole('button', { name: 'Add task' }).find((button) => button.hasAttribute('data-fab'))!;
}

function nameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Task name' });
}

function descriptionField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Description' });
}

function addButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Add' });
}

function quickAdd(): HTMLElement | null {
  return screen.queryByRole('form', { name: 'Add task' });
}

/** Puts `text` into a field in one input event, like a paste (much faster than typing 500 keys). */
function paste(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  fireEvent.change(field, { target: { value: text } });
}

async function openInbox(opts: Parameters<typeof enterInbox>[0] = {}) {
  const rendered = await enterInbox(opts);
  await rendered.user.click(addTaskButton());
  await waitFor(() => expect(nameField()).toHaveFocus());
  return rendered;
}

function posts(seen: string[]): string[] {
  return seen.filter((request) => request === POST);
}

describe('tasks.quick_add: blank names', () => {
  it('TC-51 an empty name: Add is disabled and Enter creates nothing', async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    expect(addButton()).toBeDisabled();
    await user.type(nameField(), '{Enter}');
    await user.click(addButton());
    expect(posts(seen)).toEqual([]);
    expect(quickAdd()).not.toBeNull();
  });

  it('TC-52 a name of spaces: Add is disabled and Enter creates nothing', async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    await user.type(nameField(), '    {Enter}');
    expect(addButton()).toBeDisabled();
    expect(posts(seen)).toEqual([]);
    expect(nameField()).toHaveValue('    ');
  });
});

describe('tasks.quick_add: adding', () => {
  it("TC-53 'Buy milk' + Enter: one POST, the row appears, fields clear, name keeps focus, box stays open", async () => {
    const bodies: unknown[] = [];
    const seen = recordRequests();
    const { user } = await openInbox({ bodies });
    await user.type(descriptionField(), 'Semi-skimmed');
    await user.click(nameField());
    await user.type(nameField(), 'Buy milk{Enter}');
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk']));
    expect(nameField()).toHaveValue('');
    expect(descriptionField()).toHaveValue('');
    expect(nameField()).toHaveFocus();
    expect(quickAdd()).not.toBeNull();
    await waitFor(() => expect(posts(seen)).toEqual([POST]));
    expect(bodies).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Buy milk', description: 'Semi-skimmed' }]);
  });

  it('the Add button adds too, and every submit gets a fresh id', async () => {
    const bodies: Array<{ id: string }> = [];
    const { user } = await openInbox({ bodies });
    await user.type(nameField(), 'One');
    await user.click(addButton());
    await user.type(nameField(), 'Two{Enter}');
    await waitFor(() => expect(rowNames()).toEqual(['One', 'Two']));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]!.id).not.toBe(bodies[1]!.id);
  });

  it('TC-54 Escape with text typed closes the box, sends nothing, and focus returns to + Add task', async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    await user.type(nameField(), 'Never mind');
    await user.keyboard('{Escape}');
    expect(quickAdd()).toBeNull();
    expect(posts(seen)).toEqual([]);
    expect(addTaskButton()).toHaveFocus();
    // Reopening starts empty: the text was discarded.
    await user.click(addTaskButton());
    expect(nameField()).toHaveValue('');
  });

  it('Cancel closes without adding', async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    await user.type(nameField(), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(quickAdd()).toBeNull();
    expect(posts(seen)).toEqual([]);
  });

  it('TC-116 Enter while an IME is composing sends no POST', async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    await user.type(nameField(), 'Buy');
    fireEvent.keyDown(nameField(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(nameField(), { key: 'Enter', keyCode: 229 });
    expect(nameField()).toHaveValue('Buy');
    expect(posts(seen)).toEqual([]);
    expect(rowNames()).toEqual([]);
  });

  it('TC-59 in the description, plain Enter is a new line; Ctrl+Enter and Meta+Enter add', async () => {
    const bodies: Array<{ description: string }> = [];
    const { user } = await openInbox({ bodies });
    await user.type(nameField(), 'Book dentist');
    await user.click(descriptionField());
    await user.type(descriptionField(), 'Tuesday{Enter}after 3pm');
    expect(descriptionField()).toHaveValue('Tuesday\nafter 3pm');
    expect(rowNames()).toEqual([]);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(rowNames()).toEqual(['Book dentist']));
    await waitFor(() => expect(bodies[0]?.description).toBe('Tuesday\nafter 3pm'));

    await user.type(nameField(), 'Second');
    await user.click(descriptionField());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(rowNames()).toEqual(['Book dentist', 'Second']));
  });

  it('Ctrl+Enter in the name field adds too', async () => {
    const { user } = await openInbox();
    await user.type(nameField(), 'Water the plants');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(rowNames()).toEqual(['Water the plants']));
  });

  it('TC-117 Tab goes from name to description; Shift+Tab goes back', async () => {
    const { user } = await openInbox();
    await user.tab();
    expect(descriptionField()).toHaveFocus();
    await user.tab({ shift: true });
    expect(nameField()).toHaveFocus();
  });

  it("TC-118 the chip reads '→ Inbox' and the form's accessible description includes Inbox", async () => {
    await openInbox();
    const chip = screen.getByText('→ Inbox');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('tabindex');
    expect(quickAdd()).toHaveAccessibleDescription(/Inbox/);
  });

  it('has no maxLength on either field', async () => {
    await openInbox();
    expect(nameField()).not.toHaveAttribute('maxlength');
    expect(descriptionField()).not.toHaveAttribute('maxlength');
  });
});

describe('tasks.quick_add: length counters (never truncating)', () => {
  const nameWarn = warningThreshold(TASK_NAME_MAX);

  it('TC-55 a name one short of the threshold shows no counter', async () => {
    await openInbox();
    paste(nameField(), 'n'.repeat(nameWarn - 1));
    expect(screen.queryByText(/characters? (left|over)/)).toBeNull();
    expect(addButton()).toBeEnabled();
  });

  it("TC-56 at the threshold the counter reads '50 characters left' in a polite live region", async () => {
    await openInbox();
    paste(nameField(), 'n'.repeat(nameWarn));
    const live = await screen.findByText('50 characters left', { selector: '[aria-live]' });
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('50 characters left', { selector: '[aria-hidden]' })).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it("TC-57 typing past the limit keeps every character: '1 character over', warning icon, Add disabled, Enter does nothing", async () => {
    const seen = recordRequests();
    const { user } = await openInbox();
    paste(nameField(), 'n'.repeat(TASK_NAME_MAX));
    await user.type(nameField(), 'x');
    expect(nameField().value).toHaveLength(TASK_NAME_MAX + 1);
    const counter = screen.getByText('1 character over', { selector: '[aria-hidden]' }).parentElement!;
    expect(counter.querySelector('[data-icon="warning"]')).not.toBeNull();
    expect(counter).toHaveClass('text-destructive');
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAttribute('aria-describedby', counter.id);
    expect(addButton()).toBeDisabled();
    await user.type(nameField(), '{Enter}');
    expect(posts(seen)).toEqual([]);
    expect(nameField().value).toHaveLength(TASK_NAME_MAX + 1);
  });

  it("TC-58 pasting 600 chars keeps all 600: '100 characters over', Add disabled; shortening re-enables Add", async () => {
    const { user } = await openInbox();
    await user.click(nameField());
    await user.paste('p'.repeat(600));
    expect(nameField().value).toHaveLength(600);
    expect(screen.getByText('100 characters over', { selector: '[aria-hidden]' })).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    paste(nameField(), 'p'.repeat(TASK_NAME_MAX));
    expect(screen.getByText('0 characters left', { selector: '[aria-hidden]' })).toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it('TC-119 an over-limit description has aria-invalid and aria-describedby pointing at a counter with a warning icon', async () => {
    await openInbox();
    await act(async () => paste(nameField(), 'Notes'));
    paste(descriptionField(), 'd'.repeat(TASK_DESCRIPTION_MAX + 1));
    expect(descriptionField()).toHaveAttribute('aria-invalid', 'true');
    const counter = document.getElementById(descriptionField().getAttribute('aria-describedby')!)!;
    expect(counter).toHaveTextContent('1 character over');
    expect(counter.querySelector('[data-icon="warning"]')).not.toBeNull();
    expect(addButton()).toBeDisabled();
  });

  it('the description counter appears at 4,500 characters', async () => {
    await openInbox();
    paste(descriptionField(), 'd'.repeat(warningThreshold(TASK_DESCRIPTION_MAX) - 1));
    expect(screen.queryByText(/characters? left/)).toBeNull();
    paste(descriptionField(), 'd'.repeat(warningThreshold(TASK_DESCRIPTION_MAX)));
    expect(screen.getByText('500 characters left', { selector: '[aria-hidden]' })).toBeInTheDocument();
  });
});

describe('tasks.quick_add: docked (phones)', () => {
  it('TC-120 opened from the FAB, Escape returns focus to the FAB', async () => {
    setViewport({ width: 390, coarse: true });
    const { user } = await enterInbox();
    await user.click(fab());
    const form = await screen.findByRole('form', { name: 'Add task' });
    expect(form).toHaveAttribute('data-quick-add', 'docked');
    expect(nameField()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(quickAdd()).toBeNull();
    expect(fab()).toHaveFocus();
  });

  it('adding from the docked box works the same: it stays open and ready', async () => {
    setViewport({ width: 390, coarse: true });
    const { user } = await enterInbox();
    await user.click(fab());
    await user.type(nameField(), 'Milk{Enter}');
    await waitFor(() => expect(rowNames()).toEqual(['Milk']));
    const form = quickAdd()!;
    expect(within(form).getByRole('textbox', { name: 'Task name' })).toHaveFocus();
  });
});
