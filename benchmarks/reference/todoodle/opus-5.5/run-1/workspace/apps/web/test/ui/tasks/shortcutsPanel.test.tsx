import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTasks } from '../../msw/tasks.ts';
import { enterInbox, rows } from '../../support/tasks.tsx';

function quickAdd(): HTMLElement | null {
  return screen.queryByRole('form', { name: 'Add task' });
}

function renameField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Workspace name' });
}

describe('shell.shortcuts: Q opens quick add', () => {
  it('TC-47 with free focus, q opens quick add with the name field focused', async () => {
    const { user } = await enterInbox();
    await user.keyboard('q');
    expect(quickAdd()).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveValue('');
  });

  it('q from a focused task row opens quick add; Escape returns focus to that row', async () => {
    const { user } = await enterInbox({ tasks: makeTasks(3) });
    await waitFor(() => expect(rows()).toHaveLength(3));
    rows()[1]!.focus();
    await user.keyboard('q');
    expect(quickAdd()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(rows()[1]).toHaveFocus();
  });

  it("TC-48 q typed in another field (the workspace name) is typed there; quick add stays closed", async () => {
    const { user } = await enterInbox();
    await user.click(renameField());
    await user.keyboard('q');
    expect(quickAdd()).toBeNull();
    expect(renameField().value).toContain('q');
  });

  it('TC-49 Ctrl+q, Meta+q and Alt+q do not open quick add', async () => {
    const { user } = await enterInbox();
    await user.keyboard('{Control>}q{/Control}');
    await user.keyboard('{Meta>}q{/Meta}');
    await user.keyboard('{Alt>}q{/Alt}');
    expect(quickAdd()).toBeNull();
  });

  it('TC-50 a q keydown that is part of an IME composition does not open quick add', async () => {
    await enterInbox();
    fireEvent.keyDown(document.body, { key: 'q', isComposing: true });
    expect(quickAdd()).toBeNull();
    fireEvent.keyDown(document.body, { key: 'q' });
    expect(quickAdd()).not.toBeNull();
  });
});

describe('shell.shortcuts: the ? panel', () => {
  it("TC-103 ? lists 'Add task' (Q) and 'Show keyboard shortcuts' (?); Escape closes it and focus goes back", async () => {
    const { user } = await enterInbox();
    const share = screen.getByRole('button', { name: 'Share' });
    share.focus();
    await user.keyboard('?');
    const panel = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const addTask = within(panel).getByText('Add task').closest('li')!;
    expect(within(addTask).getByText('Q').tagName).toBe('KBD');
    const help = within(panel).getByText('Show keyboard shortcuts').closest('li')!;
    expect(within(help).getByText('?').tagName).toBe('KBD');
    // The list's own keys are listed too, grouped under Navigation.
    expect(within(panel).getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
    expect(within(panel).getAllByText('Move between tasks').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(share).toHaveFocus());
  });

  it('TC-104 ? typed in the quick-add name field is inserted there; the panel does not open', async () => {
    const { user } = await enterInbox();
    await user.keyboard('q');
    const name = screen.getByRole('textbox', { name: 'Task name' });
    await user.type(name, 'Why?');
    expect(name).toHaveValue('Why?');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
