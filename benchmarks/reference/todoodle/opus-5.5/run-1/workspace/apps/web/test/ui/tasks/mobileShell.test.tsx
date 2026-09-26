import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/features/workspace/AppShell';
import { ID, enterInbox, renderWithClient, setViewport } from '../../support/tasks.tsx';

function menuButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Open navigation' });
}

/** The inline sidebar: a Lists nav outside any dialog. */
function inlineSidebar(): HTMLElement | null {
  return screen.queryAllByRole('navigation', { name: 'Lists' }).find((nav) => !nav.closest('[role="dialog"]')) ?? null;
}

function fab(): HTMLElement | null {
  return screen.queryAllByRole('button', { name: 'Add task' }).find((button) => button.hasAttribute('data-fab')) ?? null;
}

describe('shell.mobile', () => {
  it('TC-94 at 767px (fine pointer): ☰ and no inline sidebar; at 768px: the inline sidebar and no ☰', async () => {
    setViewport({ width: 767 });
    const narrow = await enterInbox();
    expect(menuButton()).toBeInTheDocument();
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton()).toHaveAttribute('aria-controls', 'nav-drawer');
    expect(inlineSidebar()).toBeNull();
    narrow.unmount();

    setViewport({ width: 768 });
    await enterInbox();
    expect(inlineSidebar()).toBeInTheDocument();
    expect(menuButton()).toBeNull();
  });

  it('TC-95 at 390px: choosing Inbox in the drawer closes it, shows the Inbox, and focus returns to ☰', async () => {
    setViewport({ width: 390 });
    const { user } = await enterInbox();
    await user.click(menuButton()!);
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveAttribute('id', 'nav-drawer');
    // The modal drawer hides the rest of the page from assistive technology while it is open.
    expect(screen.getByRole('button', { name: 'Open navigation', hidden: true })).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(drawer).getByRole('button', { name: /^Inbox/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Inbox', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it('Escape closes the drawer and returns focus to ☰', async () => {
    setViewport({ width: 390 });
    const { user } = await enterInbox();
    await user.click(menuButton()!);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it('widening past the breakpoint with the drawer open removes it and focuses the view heading', async () => {
    const viewport = setViewport({ width: 390 });
    const { user } = await enterInbox();
    await user.click(menuButton()!);
    await screen.findByRole('dialog');
    await waitFor(() => viewport.resize(1280));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(inlineSidebar()).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inbox', level: 1 })).toHaveFocus());
  });

  it('TC-96 at 390px touch: the FAB opens quick add docked with the name focused; the FAB hides while open and returns after Escape', async () => {
    setViewport({ width: 390, coarse: true });
    const { user } = await enterInbox();
    // The phone layout has no inline '+ Add task' button: the FAB replaces it.
    expect(screen.getAllByRole('button', { name: 'Add task' })).toEqual([fab()]);
    await user.click(fab()!);
    const form = await screen.findByRole('form', { name: 'Add task' });
    expect(form).toHaveAttribute('data-quick-add', 'docked');
    expect(form).toHaveClass('quick-add-docked', 'fixed');
    expect(screen.getByRole('textbox', { name: 'Task name' })).toHaveFocus();
    expect(fab()).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Add task' })).toBeNull();
    expect(fab()).toBeInTheDocument();
  });

  it('on a wide screen the FAB is left to CSS: shown only under (hover: none)', async () => {
    setViewport({ width: 1280 });
    await enterInbox();
    expect(fab()).toHaveClass('hidden', 'touch:flex');
  });
});

describe('TC-126 extension slots for search (story 11)', () => {
  const renderShell = () =>
    renderWithClient(
      <AppShell
        workspaceId={ID}
        canEdit
        renderHeader={({ navButton, actions }) => (
          <header data-testid="header">
            {navButton}
            {actions}
          </header>
        )}
        headerActionsSlot={<button type="button">Search tasks</button>}
        searchSlot={<div data-testid="search-slot">search</div>}
      >
        <h1 id="view-title">Inbox</h1>
      </AppShell>,
    );

  it('inline: the search slot is the first child above the Inbox entry; header actions render in the header', async () => {
    setViewport({ width: 1280 });
    await renderShell();
    const nav = screen.getByRole('navigation', { name: 'Lists' });
    const content = nav.firstElementChild!;
    expect(content.firstElementChild).toBe(screen.getByTestId('search-slot'));
    expect(content.children[1]).toHaveAccessibleName('Inbox');
    expect(within(screen.getByTestId('header')).getByRole('button', { name: 'Search tasks' })).toBeInTheDocument();
  });

  it('drawer: the search slot renders above the Inbox entry too, and header actions sit beside ☰', async () => {
    setViewport({ width: 390 });
    const { user } = await renderShell();
    const header = screen.getByTestId('header');
    expect(within(header).getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Search tasks' })).toBeInTheDocument();
    await user.click(within(header).getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog');
    const content = within(drawer).getByRole('navigation', { name: 'Lists' }).firstElementChild!;
    expect(content.firstElementChild).toHaveAttribute('data-testid', 'search-slot');
    expect(content.children[1]).toHaveAccessibleName('Inbox');
  });
});
