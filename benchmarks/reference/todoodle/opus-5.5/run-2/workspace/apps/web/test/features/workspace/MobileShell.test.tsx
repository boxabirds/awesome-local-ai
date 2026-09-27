import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/features/workspace/AppShell';
import { handlers, SECRET, workspace } from '../../fixtures';
import { server } from '../../msw';
import { TASK_WS_ID } from '../../msw/tasks';
import { currentLocation, primeCreated, renderApp } from '../../render';
import { renderWithProviders, stubViewport } from '../helpers';

async function renderWorkspace() {
  server.use(handlers.get());
  primeCreated(workspace(), SECRET);
  await renderApp({ pathname: '/w', hash: `#${SECRET}` });
  await screen.findByRole('heading', { level: 1, name: 'Inbox' });
}

const menuButton = () => screen.queryByRole('button', { name: 'Open navigation' });
const inlineNav = () => screen.queryByRole('navigation', { name: 'Lists' });

describe('phone shell', () => {
  it('TC-94 width 767 (fine pointer): ☰ and no inline sidebar', async () => {
    stubViewport({ width: 767 });
    await renderWorkspace();
    expect(menuButton()).toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveAttribute('aria-controls', 'nav-drawer');
    expect(inlineNav()).not.toBeInTheDocument();
  });

  it('TC-94 width 768 (fine pointer): inline sidebar and no ☰', async () => {
    stubViewport({ width: 768 });
    await renderWorkspace();
    expect(inlineNav()).toBeInTheDocument();
    expect(menuButton()).not.toBeInTheDocument();
    // A fine pointer at desktop width keeps the inline "+ Add task" button (no floating button).
    expect(screen.getByRole('button', { name: 'Add task' })).not.toHaveClass('fixed');
  });

  it('TC-95 width 390: choosing Inbox in the drawer closes it, stays on the Inbox and returns focus to ☰', async () => {
    stubViewport({ width: 390, coarse: true });
    await renderWorkspace();
    const before = `${currentLocation.value?.pathname}${currentLocation.value?.hash}`;
    const menu = menuButton()!;
    fireEvent.click(menu);
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveAttribute('id', 'nav-drawer');
    // The page behind the modal drawer is hidden from assistive technology meanwhile.
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(drawer).getByRole('link', { name: 'Inbox' }));
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    expect(`${currentLocation.value?.pathname}${currentLocation.value?.hash}`).toBe(before);
    await expect.poll(() => document.activeElement).toBe(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('TC-96 width 390 (touch): the floating button opens quick add docked with the name focused, hides while open and returns after Escape', async () => {
    stubViewport({ width: 390, coarse: true });
    await renderWorkspace();
    await screen.findByText('Your Inbox is clear. Tap + to add a task.');
    const fab = screen.getByRole('button', { name: 'Add task' });
    fireEvent.click(fab);
    const form = screen.getByRole('form', { name: 'Add task' });
    expect(form).toHaveAttribute('data-mode', 'docked');
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
    expect(fab).toHaveAttribute('hidden');
    expect(screen.queryByRole('button', { name: 'Add task' })).not.toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Task name' }), { key: 'Escape' });
    });
    expect(screen.queryByRole('form', { name: 'Add task' })).not.toBeInTheDocument();
    expect(fab).not.toHaveAttribute('hidden');
    expect(fab).toHaveFocus();
  });

  it('a touch screen at tablet width (1024, coarse) also gets the floating button, with the inline sidebar', async () => {
    stubViewport({ width: 1024, coarse: true });
    await renderWorkspace();
    expect(inlineNav()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toHaveClass('fixed');
  });

  it('TC-126 story 11 slots render in place, inline and in the drawer', async () => {
    const slots = { headerActionsSlot: <button type="button">Search</button>, searchSlot: <div data-testid="search-slot">Find</div> };
    stubViewport({ width: 1280 });
    const inline = await renderWithProviders(<AppShell workspaceId={TASK_WS_ID} name="My Todoodle" canEdit {...slots} />);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: 'Search' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Lists' });
    const slot = within(nav).getByTestId('search-slot');
    expect(slot.compareDocumentPosition(within(nav).getByRole('link', { name: 'Inbox' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    inline.unmount();

    stubViewport({ width: 390 });
    await renderWithProviders(<AppShell workspaceId={TASK_WS_ID} name="My Todoodle" canEdit {...slots} />);
    const narrowHeader = screen.getByRole('banner');
    expect(within(narrowHeader).getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(within(narrowHeader).getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByTestId('search-slot')).toBeInTheDocument();
  });
});
