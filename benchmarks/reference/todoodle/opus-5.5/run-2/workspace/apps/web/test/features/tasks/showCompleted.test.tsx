import { formatCompletedDate } from '@todoodle/shared/dates';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { task } from '../../msw/tasks';
import { checkbox, fourTasks, renderInbox, rowFor, rowNames, settle } from './lifecycle-helpers';

const toggle = () => screen.getByRole('switch', { name: 'Show completed' });
const PREF_KEY = (ws: string) => `tdl:showCompleted:${ws}:inbox`;

function withDone() {
  const open = fourTasks().slice(0, 2);
  const passport = task({ name: 'Renew passport', sortOrder: 5, completedAt: '2026-09-26T07:45:00.000Z' });
  const tax = task({ name: 'Pay council tax', sortOrder: 0.5, completedAt: '2026-09-24T18:02:00.000Z' });
  return { open, passport, tax, all: [...open, passport, tax] };
}

describe('show completed', () => {
  it('TC-C15 toggling on shows completed rows struck through with their Intl date; their checkbox reopens', async () => {
    const { all, passport } = withDone();
    const srv = await renderInbox(all);
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411']);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    await screen.findByRole('listitem', { name: 'Renew passport' });
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Renew passport', 'Pay council tax']);
    const row = rowFor('Renew passport');
    expect(row.querySelector('span.break-words')).toHaveClass('line-through');
    expect(row).toHaveTextContent(`Completed ${formatCompletedDate(passport.completedAt)}`);
    expect(checkbox('Renew passport')).toHaveAttribute('aria-checked', 'true');
    expect(checkbox('Renew passport')).toHaveAccessibleName('Reopen Renew passport');

    fireEvent.click(checkbox('Renew passport'));
    await settle();
    // Back among the open tasks at its sortOrder (5: after the others).
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Renew passport', 'Pay council tax']);
    expect(checkbox('Renew passport')).toHaveAttribute('aria-checked', 'false');
    expect(rowFor('Renew passport').querySelector('span.break-words')).not.toHaveClass('line-through');
    expect(srv.sent.map((s) => s.op)).toEqual(['reopen']);
  });

  it('TC-C20 with no completed tasks it says "No completed tasks"', async () => {
    await renderInbox(fourTasks());
    fireEvent.click(toggle());
    expect(await screen.findByText('No completed tasks')).toBeInTheDocument();
    expect(rowNames()).toHaveLength(4);
  });

  it('TC-C29 the toggle is remembered: after a remount it is still on', async () => {
    const { all } = withDone();
    const first = await renderInbox(all);
    fireEvent.click(toggle());
    await screen.findByRole('listitem', { name: 'Renew passport' });
    expect(window.localStorage.getItem(PREF_KEY(all[0]!.workspaceId))).toBe('1');
    first.unmount();
    queryClient.clear();
    await renderInbox(all);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByRole('listitem', { name: 'Renew passport' })).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(window.localStorage.getItem(PREF_KEY(all[0]!.workspaceId))).toBe('0');
  });

  it('TC-C29 while completed tasks load, the previous rows stay (no empty or loading flash)', async () => {
    const { all } = withDone();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await renderInbox(all, {
      list: async (variant) => {
        if (variant === 'with-completed') await gate;
        return undefined;
      },
    });
    fireEvent.click(toggle());
    await settle();
    expect(rowNames()).toEqual(['Buy milk', 'Email Sam re: invoice #4411']);
    expect(screen.queryByRole('region', { name: 'Loading tasks' })).not.toBeInTheDocument();
    expect(screen.queryByText('No completed tasks')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your Inbox is clear/)).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole('listitem', { name: 'Renew passport' })).toBeInTheDocument();
  });

  it('TC-C29 with storage that throws, the toggle still works, defaults off, and nothing crashes', async () => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    const { all } = withDone();
    await renderInbox(all);
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    act(() => {
      fireEvent.click(toggle());
    });
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByRole('listitem', { name: 'Renew passport' })).toBeInTheDocument();
  });

  it('the list request asks for completed tasks only while the toggle is on', async () => {
    const srv = await renderInbox(fourTasks());
    fireEvent.click(toggle());
    await screen.findByText('No completed tasks');
    expect(srv.lists).toContain('with-completed');
  });
});
