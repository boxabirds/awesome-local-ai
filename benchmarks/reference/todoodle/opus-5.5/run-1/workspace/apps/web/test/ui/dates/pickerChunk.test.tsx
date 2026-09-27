import { screen, waitFor, within } from '@testing-library/react';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithClient, toastWith } from '../../support/tasks.tsx';
import { useFriday } from '../../support/today.tsx';

// Story 8, TC-114: the picker panel chunk fails to load once. Own file: the panel module must not have been loaded
// yet, and its import is mocked to reject the first time (as a failed chunk request would).

const chunk = vi.hoisted(() => ({ attempts: 0, failing: true }));

// Every import attempt while `failing` rejects: the hover/focus preload and the open itself.
vi.mock('@/features/dates/picker/DueDatePickerPanel', async (importOriginal) => {
  chunk.attempts++;
  if (chunk.failing) throw new Error('Failed to fetch dynamically imported module');
  return importOriginal();
});

beforeEach(() => useFriday());
afterEach(() => vi.useRealTimers());

describe('ui.date_picker: lazyWithRetry', () => {
  it("TC-114 first open: toast 'Couldn't open the date picker — try again', no crash; second open: the panel renders (the failure was not cached)", async () => {
    const { DueDatePicker } = await import('@/features/dates/DueDatePicker');
    const { PICKER_LOAD_FAILED_TEXT } = await import('@/features/dates/dueDatePickerLoader');
    const onChange = vi.fn();
    const { user } = await renderWithClient(
      <>
        <DueDatePicker value={null} onChange={onChange} />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Set due date' }));
    await waitFor(() => expect(toastWith(PICKER_LOAD_FAILED_TEXT)).not.toBeNull());
    expect(toastWith(PICKER_LOAD_FAILED_TEXT)).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('dialog', { name: 'Due date' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set due date' })).toBeInTheDocument();
    const failedAttempts = chunk.attempts;
    expect(failedAttempts).toBeGreaterThanOrEqual(1);

    // The network is back: the next open imports again (the rejection was not cached).
    chunk.failing = false;
    await user.click(screen.getByRole('button', { name: 'Set due date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Due date' });
    expect(within(dialog).getByText('Today · Fri 25 Sep')).toBeInTheDocument();
    expect(chunk.attempts).toBe(failedAttempts + 1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
