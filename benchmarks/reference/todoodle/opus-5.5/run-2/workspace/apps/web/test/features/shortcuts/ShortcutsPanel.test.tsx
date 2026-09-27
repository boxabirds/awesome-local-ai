import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InboxView } from '@/features/tasks/InboxView';
import { handlers, SECRET, workspace } from '../../fixtures';
import { server } from '../../msw';
import { TASK_WS_ID } from '../../msw/tasks';
import { primeCreated, renderApp } from '../../render';
import { renderWithProviders } from '../helpers';

async function renderInbox() {
  await renderWithProviders(
    <>
      <input aria-label="Other field" />
      <InboxView workspaceId={TASK_WS_ID} canEdit />
    </>,
  );
  await screen.findByText('Your Inbox is clear. Press Q to add a task.');
}

function press(key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? document.body) {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(target, { key, ...init });
  });
  return notPrevented;
}

const quickAdd = () => screen.queryByRole('form', { name: 'Add task' });

describe('Q opens quick add', () => {
  it('TC-47 with free focus, q opens quick add with the name focused', async () => {
    await renderInbox();
    expect(press('q', {}, document.body)).toBe(false);
    expect(quickAdd()).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
  });

  it('TC-48 typing q in another field does not open quick add (the q is typed)', async () => {
    await renderInbox();
    const other = screen.getByRole('textbox', { name: 'Other field' });
    act(() => other.focus());
    expect(press('q', {}, other)).toBe(true);
    expect(quickAdd()).not.toBeInTheDocument();
    expect(other).toHaveFocus();
  });

  it('TC-49 Ctrl+q, Meta+q and Alt+q do not open quick add', async () => {
    await renderInbox();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(press('q', mod, document.body)).toBe(true);
    }
    expect(quickAdd()).not.toBeInTheDocument();
  });

  it('TC-50 q while an IME is composing does not open quick add', async () => {
    await renderInbox();
    press('q', { isComposing: true }, document.body);
    expect(quickAdd()).not.toBeInTheDocument();
  });

  it('q with quick add already open (focus elsewhere) moves focus back to the name', async () => {
    await renderInbox();
    press('q', {}, document.body);
    act(() => (document.activeElement as HTMLElement).blur());
    press('q', {}, document.body);
    expect(screen.getAllByRole('form', { name: 'Add task' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
  });

  it('q is off while editing is off', async () => {
    await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit={false} />);
    await screen.findByText('Your Inbox is clear. Press Q to add a task.');
    press('q', {}, document.body);
    expect(quickAdd()).not.toBeInTheDocument();
  });
});

describe('? shortcuts panel', () => {
  async function renderWorkspace() {
    server.use(handlers.get());
    primeCreated(workspace(), SECRET);
    await renderApp({ pathname: '/w', hash: `#${SECRET}` });
    await screen.findByText('Your Inbox is clear. Press Q to add a task.');
  }

  it('TC-103 ? lists Add task (Q) and Show keyboard shortcuts (?); Escape closes and restores focus', async () => {
    await renderWorkspace();
    const share = screen.getByRole('button', { name: 'Share' });
    act(() => share.focus());
    expect(press('?', { shiftKey: true }, share)).toBe(false);
    const panel = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const addTask = within(panel).getByText('Add task').closest('li')!;
    expect(within(addTask).getByText('Q').tagName).toBe('KBD');
    const help = within(panel).getByText('Show keyboard shortcuts').closest('li')!;
    expect(within(help).getByText('?').tagName).toBe('KBD');
    expect(within(panel).getAllByText('Move between tasks').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
    press('Escape', {}, document.activeElement!);
    await expect.poll(() => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    await expect.poll(() => document.activeElement).toBe(share);
  });

  it('TC-104 ? typed in the quick-add name is inserted, and the panel does not open', async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const name = screen.getByRole('textbox', { name: 'Task name' });
    expect(press('?', { shiftKey: true }, name)).toBe(true);
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    expect(name).toHaveFocus();
  });
});
