import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarContent } from '@/features/workspace/Sidebar';
import { server } from '../../msw.ts';
import { countsHandler } from '../../msw/tasks.ts';
import { gate } from '../../support/fixtures.ts';
import { ID, enterInbox, renderWithClient } from '../../support/tasks.tsx';

const noop = () => {};

function inboxItem(): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Lists' })).getByRole('button', { name: /^Inbox/ });
}

describe('shell.sidebar', () => {
  it("TC-40 counts {inbox: 3}: the Inbox item is named 'Inbox, 3 open tasks'; no rename or delete controls", async () => {
    server.use(countsHandler({ counts: { inbox: 3 } }));
    await renderWithClient(<SidebarContent workspaceId={ID} current="inbox" onNavigate={noop} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inbox, 3 open tasks' })).toBeInTheDocument());
    const item = screen.getByRole('button', { name: 'Inbox, 3 open tasks' });
    expect(item).toHaveAttribute('aria-current', 'page');
    expect(item).toHaveTextContent('3');
    // The Inbox is not a row: nothing to rename or delete.
    expect(screen.queryByRole('button', { name: /rename|delete|more/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it("a count of 1 reads 'Inbox, 1 open task'", async () => {
    server.use(countsHandler({ counts: { inbox: 1 } }));
    await renderWithClient(<SidebarContent workspaceId={ID} current="inbox" onNavigate={noop} />);
    expect(await screen.findByRole('button', { name: 'Inbox, 1 open task' })).toBeInTheDocument();
  });

  it("TC-41 counts {inbox: 0}: the count is hidden and the name is just 'Inbox'", async () => {
    server.use(countsHandler({ counts: { inbox: 0 } }));
    const { container } = await renderWithClient(<SidebarContent workspaceId={ID} current="inbox" onNavigate={noop} />);
    await waitFor(() => expect(container.querySelector('[data-count-skeleton]')).toBeNull());
    const item = screen.getByRole('button', { name: 'Inbox' });
    expect(item.querySelector('[data-count-slot]')).toBeEmptyDOMElement();
  });

  it('a failed counts request hides the count and never blocks the Inbox entry', async () => {
    server.use(countsHandler({ status: 500 }));
    const { container } = await renderWithClient(<SidebarContent workspaceId={ID} current="inbox" onNavigate={noop} />);
    await waitFor(() => expect(container.querySelector('[data-count-skeleton]')).toBeNull());
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeEnabled();
  });

  it('TC-42 while counts load, Inbox is visible at once with a count skeleton in a fixed-width slot (no layout shift)', async () => {
    const hold = gate();
    server.use(countsHandler({ counts: { inbox: 3 }, until: hold.promise }));
    await renderWithClient(<SidebarContent workspaceId={ID} current="inbox" onNavigate={noop} />);
    const item = screen.getByRole('button', { name: 'Inbox' });
    const slot = item.querySelector('[data-count-slot]')!;
    const slotClass = slot.className;
    expect(slot.querySelector('[data-count-skeleton]')).not.toBeNull();
    expect(slotClass).toMatch(/\bw-8\b/);
    hold.release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inbox, 3 open tasks' })).toBeInTheDocument());
    // Same element, same reserved width: the label never moves.
    expect(item.querySelector('[data-count-slot]')).toBe(slot);
    expect(slot.className).toBe(slotClass);
    expect(slot).toHaveTextContent('3');
  });

  it('the workspace view shows the sidebar Inbox entry with its count (desktop)', async () => {
    await enterInbox({ counts: { inbox: 2 } });
    await waitFor(() => expect(inboxItem()).toHaveAccessibleName('Inbox, 2 open tasks'));
  });
});
