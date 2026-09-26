import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { taskRowRenders } from '@/features/tasks/TaskRow';
import { server } from '../../msw.ts';
import { listHandler } from '../../msw/tasks.ts';
import { makeTasks } from '../../msw/tasks.ts';
import { recordRequests } from '../../support/fixtures.ts';
import { ID, enterInbox, rows } from '../../support/tasks.tsx';

function sidebarInbox(): HTMLElement {
  return screen.getByRole('button', { name: /^Inbox/ });
}

function addTaskButton(): HTMLElement {
  return screen.getAllByRole('button', { name: 'Add task' }).find((button) => !button.hasAttribute('data-fab'))!;
}

async function inboxWith(count: number) {
  const rendered = await enterInbox({ tasks: makeTasks(count) });
  await waitFor(() => expect(rows()).toHaveLength(count));
  return rendered;
}

describe('tasks.list_view: states', () => {
  it("TC-107 loading: 5 skeleton rows inside an aria-busy region labelled 'Loading tasks'", async () => {
    await enterInbox({ listUntil: new Promise(() => {}) });
    const region = screen.getByRole('region', { name: 'Loading tasks' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region.querySelectorAll('[data-skeleton-row]')).toHaveLength(5);
    // The sidebar stays usable while the list loads.
    expect(sidebarInbox()).toBeEnabled();
  });

  it("TC-108 error: 'Couldn't load your tasks.' in role=alert; Try again refetches once and the rows render", async () => {
    const { user } = await enterInbox({ listStatus: 500 });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your tasks.");
    expect(screen.queryByText(/Your Inbox is clear/)).toBeNull();
    server.use(listHandler({ tasks: makeTasks(2) }));
    const seen = recordRequests();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(seen.filter((r) => r === `GET /api/w/${ID}/tasks`)).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('TC-113 the list is a listbox of options with exactly one row at tabIndex 0', async () => {
    await inboxWith(3);
    expect(screen.getByRole('listbox', { name: 'Tasks' })).toBeInTheDocument();
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    rows()[2]!.focus();
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows().filter((row) => row.tabIndex === 0)).toEqual([rows()[2]]);
  });
});

describe('tasks.list_view: keyboard', () => {
  it('TC-109 Tab lands on row 1; ↓↓ focuses row 3; Tab leaves the list for the next control', async () => {
    const { user } = await inboxWith(5);
    sidebarInbox().focus();
    await user.tab();
    expect(rows()[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(rows()[2]).toHaveFocus();
    await user.tab();
    expect(addTaskButton()).toHaveFocus();
  });

  it('TC-110 arrow navigation re-renders no rows', async () => {
    const { user } = await inboxWith(5);
    rows()[0]!.focus();
    const before = taskRowRenders.count;
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(rows()[3]).toHaveFocus();
    expect(taskRowRenders.count).toBe(before);
  });

  it('TC-111 after Tab away and Shift+Tab back, focus returns to the last focused row', async () => {
    const { user } = await inboxWith(5);
    sidebarInbox().focus();
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveFocus();
    await user.tab();
    expect(addTaskButton()).toHaveFocus();
    await user.tab({ shift: true });
    expect(rows()[1]).toHaveFocus();
  });

  it('TC-112 j, k, End and Home mirror ↓, ↑, last and first; the ends clamp', async () => {
    const { user } = await inboxWith(5);
    rows()[0]!.focus();
    await user.keyboard('j');
    expect(rows()[1]).toHaveFocus();
    await user.keyboard('k');
    expect(rows()[0]).toHaveFocus();
    await user.keyboard('k');
    expect(rows()[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(rows()[4]).toHaveFocus();
    await user.keyboard('j');
    expect(rows()[4]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rows()[0]).toHaveFocus();
  });

  it('a new row keeps exactly one Tab stop (the active row)', async () => {
    const { user } = await inboxWith(2);
    rows()[1]!.focus();
    await user.keyboard('q');
    await user.type(screen.getByRole('textbox', { name: 'Task name' }), 'Third{Enter}');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await act(async () => {});
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
  });
});
