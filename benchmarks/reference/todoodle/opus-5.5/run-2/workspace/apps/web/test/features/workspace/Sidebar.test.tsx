import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { SidebarContent } from '@/features/workspace/Sidebar';
import { deferred } from '../../render';
import { server } from '../../msw';
import { counts, TASK_WS_ID, taskHandlers } from '../../msw/tasks';
import { renderWithProviders } from '../helpers';

describe('Sidebar', () => {
  it('TC-40 counts {inbox: 3}: the Inbox is named "Inbox, 3 open tasks" and has no rename or delete', async () => {
    server.use(taskHandlers.counts(3));
    const { container } = await renderWithProviders(<SidebarContent workspaceId={TASK_WS_ID} />);
    const inbox = await screen.findByRole('link', { name: 'Inbox, 3 open tasks' });
    expect(inbox).toHaveAttribute('aria-current', 'page');
    expect(within(inbox).getByText('3')).toBeInTheDocument();
    expect(within(container).queryAllByRole('button')).toEqual([]);
    expect(within(container).queryByRole('menu')).not.toBeInTheDocument();
    expect(within(container).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('one open task reads "1 open task"', async () => {
    server.use(taskHandlers.counts(1));
    await renderWithProviders(<SidebarContent workspaceId={TASK_WS_ID} />);
    expect(await screen.findByRole('link', { name: 'Inbox, 1 open task' })).toBeInTheDocument();
  });

  it('TC-41 counts {inbox: 0}: no count, name "Inbox"', async () => {
    server.use(taskHandlers.counts(0));
    await renderWithProviders(<SidebarContent workspaceId={TASK_WS_ID} />);
    const inbox = await screen.findByRole('link', { name: 'Inbox' });
    const badge = screen.getByTestId('inbox-count');
    await expect.poll(() => badge.querySelector('[data-testid="count-skeleton"]')).toBeNull();
    expect(badge).toBeEmptyDOMElement();
    expect(inbox).toHaveAccessibleName('Inbox');
  });

  it('TC-42 while counts load, the Inbox shows at once with a skeleton badge; the badge keeps its box after load', async () => {
    const gate = deferred();
    server.use(
      http.get('/api/w/:id/counts', async () => {
        await gate.promise;
        return HttpResponse.json(counts(4));
      }),
    );
    await renderWithProviders(<SidebarContent workspaceId={TASK_WS_ID} />);
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    const badge = screen.getByTestId('inbox-count');
    const reserved = badge.className;
    expect(badge.querySelector('[data-testid="count-skeleton"]')).not.toBeNull();
    gate.resolve();
    await screen.findByRole('link', { name: 'Inbox, 4 open tasks' });
    expect(screen.getByTestId('inbox-count')).toBe(badge);
    expect(badge.className).toBe(reserved);
    expect(badge.className).toMatch(/\bw-8\b/);
    expect(badge).toHaveTextContent('4');
  });

  it('a failed counts request hides the count and keeps the Inbox usable', async () => {
    server.use(http.get('/api/w/:id/counts', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })));
    await renderWithProviders(<SidebarContent workspaceId={TASK_WS_ID} />);
    const badge = screen.getByTestId('inbox-count');
    await expect.poll(() => badge.querySelector('[data-testid="count-skeleton"]')).toBeNull();
    expect(badge).toBeEmptyDOMElement();
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('href');
  });
});
