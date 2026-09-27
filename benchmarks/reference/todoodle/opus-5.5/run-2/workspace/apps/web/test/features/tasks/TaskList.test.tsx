import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { InboxView } from '@/features/tasks/InboxView';
import { TaskList } from '@/features/tasks/TaskList';
import { taskRowRenders } from '@/features/tasks/TaskRow';
import { server } from '../../msw';
import { TASK_WS_ID, task, taskHandlers, tasksNamed } from '../../msw/tasks';
import { pressTab, renderWithProviders } from '../helpers';

const noop = () => {};
const rows = () => within(screen.getByRole('list', { name: 'Tasks' })).getAllByRole('listitem');

describe('TaskList', () => {
  it('TC-43 rows render in order; a description preview only on rows that have one', () => {
    const a = task({ name: 'Buy milk', sortOrder: 1 });
    const b = task({ name: 'Email Sam re: invoice #4411', description: 'Attach the PDF\nand the receipt', sortOrder: 2 });
    const c = task({ name: 'Call Mum 📞', sortOrder: 3 });
    render(<TaskList tasks={[a, b, c]} status="ready" onRetry={noop} empty={null} />);
    const all = rows();
    expect(all.map((row) => row.querySelector('span.break-words')?.textContent)).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    expect(within(all[1]!).getByText(/Attach the PDF/)).toHaveClass('truncate', 'text-muted-foreground');
    // (Story 6's "…" menu button is muted too, so the preview is matched as muted text.)
    expect(all[0]!.querySelectorAll('span.text-muted-foreground')).toHaveLength(0);
    expect(all[2]!.querySelectorAll('span.text-muted-foreground')).toHaveLength(0);
    // Story 6: the round checkbox is a real control, named after the task.
    expect(within(all[0]!).getByRole('checkbox', { name: 'Complete Buy milk' })).toHaveAttribute('aria-checked', 'false');
  });

  it('TC-44 a ready, empty Inbox says how to add a task', async () => {
    server.use(taskHandlers.list([]));
    await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit />);
    expect(await screen.findByText('Your Inbox is clear. Press Q to add a task.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tasks' })).not.toBeInTheDocument();
  });

  it('TC-44 on touch screens the empty Inbox says to tap +', async () => {
    const { stubHoverNone } = await import('../../render');
    stubHoverNone(true);
    server.use(taskHandlers.list([]));
    await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit />);
    expect(await screen.findByText('Your Inbox is clear. Tap + to add a task.')).toBeInTheDocument();
  });

  it('TC-45 appending a task does not re-render the existing memoised row', async () => {
    const [a] = tasksNamed('A');
    const b = task({ name: 'B', sortOrder: 2 });
    const { rerender } = render(<TaskList tasks={[a!]} status="ready" onRetry={noop} empty={null} />);
    const before = taskRowRenders.get(a!.id);
    expect(before).toBeGreaterThan(0);
    await act(async () => {
      rerender(<TaskList tasks={[a!, b]} status="ready" onRetry={noop} empty={null} />);
    });
    expect(rows()).toHaveLength(2);
    expect(taskRowRenders.get(a!.id)).toBe(before);
    expect(taskRowRenders.get(b.id)).toBeGreaterThan(0);
  });
});

describe('TaskList states and keyboard', () => {
  it('TC-107 loading shows 5 skeleton rows in a busy region labelled "Loading tasks"', () => {
    render(<TaskList tasks={[]} status="loading" onRetry={noop} empty={null} />);
    const region = screen.getByRole('region', { name: 'Loading tasks' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region.querySelectorAll('li')).toHaveLength(5);
    expect(screen.queryByRole('list', { name: 'Tasks' })).not.toBeInTheDocument();
  });

  it('an error with no rows shows the error, not the empty state', () => {
    render(<TaskList tasks={[]} status="error" onRetry={noop} empty={<p>EMPTY</p>} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your tasks.");
    expect(screen.queryByText('EMPTY')).not.toBeInTheDocument();
  });

  it('TC-108 a failed load says so in role=alert; Try again refetches once and the rows show', async () => {
    let fail = true;
    let gets = 0;
    server.use(
      http.get('/api/w/:id/tasks', () => {
        gets++;
        return fail
          ? HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })
          : HttpResponse.json({ tasks: tasksNamed('Buy milk', 'Call Mum 📞') });
      }),
    );
    await renderWithProviders(<InboxView workspaceId={TASK_WS_ID} canEdit />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your tasks.");
    const before = gets;
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('listitem', { name: /Buy milk/ })).toBeInTheDocument();
    expect(gets - before).toBe(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  function renderFive() {
    const five = tasksNamed('One', 'Two', 'Three', 'Four', 'Five');
    render(
      <>
        <button type="button">Before</button>
        <TaskList tasks={five} status="ready" onRetry={noop} empty={null} />
        <button type="button">After</button>
      </>,
    );
    act(() => screen.getByRole('button', { name: 'Before' }).focus());
    return five;
  }

  const key = (k: string) =>
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: k });
    });
  const focusedName = () => (document.activeElement as HTMLElement).querySelector('span.break-words')?.textContent;

  it('TC-109 Tab lands on row 1, ↓↓ focuses row 3, Tab leaves the list', () => {
    renderFive();
    pressTab();
    expect(focusedName()).toBe('One');
    key('ArrowDown');
    key('ArrowDown');
    expect(focusedName()).toBe('Three');
    pressTab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('TC-110 arrow navigation re-renders no rows', () => {
    const five = renderFive();
    pressTab();
    const before = five.map((t) => taskRowRenders.get(t.id));
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(focusedName()).toBe('Four');
    expect(five.map((t) => taskRowRenders.get(t.id))).toEqual(before);
  });

  it('TC-111 focus is remembered: row 2, Tab away, Shift+Tab back lands on row 2', () => {
    renderFive();
    pressTab();
    key('ArrowDown');
    expect(focusedName()).toBe('Two');
    pressTab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    pressTab({ shift: true });
    expect(focusedName()).toBe('Two');
  });

  it('TC-112 j, k, End and Home mirror ↓, ↑, last and first; the ends clamp', () => {
    renderFive();
    pressTab();
    key('j');
    expect(focusedName()).toBe('Two');
    key('k');
    expect(focusedName()).toBe('One');
    key('k');
    expect(focusedName()).toBe('One');
    key('End');
    expect(focusedName()).toBe('Five');
    key('ArrowDown');
    expect(focusedName()).toBe('Five');
    key('Home');
    expect(focusedName()).toBe('One');
  });

  it('TC-113 a list of rows (story 6: list items, since rows now hold controls); exactly one row has tabIndex 0', () => {
    render(<TaskList tasks={tasksNamed('A', 'B', 'C')} status="ready" onRetry={noop} empty={null} />);
    const listbox = screen.getByRole('list', { name: 'Tasks' });
    const options = within(listbox).getAllByRole('listitem');
    expect(options).toHaveLength(3);
    expect(options.filter((o) => o.tabIndex === 0)).toEqual([options[0]]);
    act(() => options[2]!.focus());
    expect(options.filter((o) => o.tabIndex === 0)).toEqual([options[2]]);
    expect(document.activeElement).toBe(options[2]);
  });

  it('keys from a row’s own controls are left alone', () => {
    const failed = { ...task({ name: 'Failed one', sortOrder: 1 }), localStatus: 'failed' as const };
    render(<TaskList tasks={[failed, task({ name: 'Next', sortOrder: 2 })]} status="ready" onRetry={noop} empty={null} />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    act(() => {
      fireEvent.keyDown(retry, { key: 'ArrowDown' });
    });
    expect(retry).toHaveFocus();
  });
});
