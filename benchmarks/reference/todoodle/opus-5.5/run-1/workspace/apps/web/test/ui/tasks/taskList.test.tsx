import { act, screen, waitFor } from '@testing-library/react';
import type { Task } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import { taskRowRenders } from '@/features/tasks/TaskRow';
import { TaskList } from '@/features/tasks/TaskList';
import { EmptyInbox } from '@/features/tasks/EmptyInbox';
import { queryClient } from '@/lib/queryClient';
import { makeTask, makeTasks } from '../../msw/tasks.ts';
import { INBOX_KEY, enterInbox, renderWithClient, rowNames, rows } from '../../support/tasks.tsx';

const noop = () => {};

describe('tasks.list_view: rows and empty state', () => {
  it('TC-43 rows render in order A, B, C; the description preview shows only on rows that have one', async () => {
    const tasks = [
      makeTask({ name: 'Buy milk' }, 0),
      makeTask({ name: 'Book dentist — ask about Tuesday', description: 'Ask for the Tuesday slot\nBring the referral' }, 1),
      makeTask({ name: 'Call Mum 📞' }, 2),
    ];
    await renderWithClient(<TaskList tasks={tasks} status="ready" onRetry={noop} empty={<EmptyInbox />} />);
    expect(rowNames()).toEqual(['Buy milk', 'Book dentist — ask about Tuesday', 'Call Mum 📞']);
    const [a, b, c] = rows();
    expect(a!.querySelectorAll('p')).toHaveLength(1);
    expect(b!.querySelectorAll('p')).toHaveLength(2);
    expect(b!.querySelectorAll('p')[1]).toHaveTextContent('Ask for the Tuesday slot');
    expect(b!.querySelectorAll('p')[1]).toHaveClass('truncate', 'text-muted-foreground');
    expect(c!.querySelectorAll('p')).toHaveLength(1);
    // The checkbox is decorative until story 6.
    expect(a!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it("TC-44 an empty Inbox says 'Your Inbox is clear. Press Q to add a task.' (and the touch variant exists)", async () => {
    await enterInbox({ tasks: [] });
    expect(await screen.findByText('Your Inbox is clear. Press Q to add a task.')).toBeInTheDocument();
    expect(screen.getByText('Your Inbox is clear. Tap + to add a task.')).toHaveClass('hidden', 'touch:block');
    expect(screen.getByText('Your Inbox is clear. Press Q to add a task.')).toHaveClass('touch:hidden');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the Inbox view renders the fetched tasks in order', async () => {
    await enterInbox({ tasks: makeTasks(3) });
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']));
  });

  it('TC-45 appending B through the cache does not re-render row A (memo); B is appended', async () => {
    const [a] = makeTasks(1) as [Task];
    await enterInbox({ tasks: [a] });
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk']));
    const before = taskRowRenders.count;
    const b = makeTask({ name: 'Water the plants' }, 1);
    await act(async () => {
      queryClient.setQueryData<Task[]>(INBOX_KEY, (list) => [...(list ?? []), b]);
    });
    await waitFor(() => expect(rowNames()).toEqual(['Buy milk', 'Water the plants']));
    // Only B rendered: A kept its reference (taskCache) and the row actions context is stable.
    expect(taskRowRenders.count - before).toBe(1);
  });
});
