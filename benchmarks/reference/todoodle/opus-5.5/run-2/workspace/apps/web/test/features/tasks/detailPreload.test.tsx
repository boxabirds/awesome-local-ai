import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fourTasks, renderInbox, rowFor, settle } from './lifecycle-helpers';

const loads = vi.hoisted(() => ({ count: 0 }));

// Counts when the sheet's chunk is actually imported.
vi.mock('@/features/tasks/TaskDetailSheet', async (importOriginal) => {
  loads.count++;
  return importOriginal();
});

describe('TC-C32 the detail sheet is a lazy chunk', () => {
  it('is not loaded by the first render of the list, only when a row is hovered or focused', async () => {
    await renderInbox(fourTasks());
    await settle();
    expect(loads.count).toBe(0);
    fireEvent.pointerEnter(rowFor('Buy milk'));
    await vi.waitFor(() => expect(loads.count).toBe(1));
    // Opening then needs no further load.
    fireEvent.click(screen.getByRole('button', { name: 'Buy milk' }));
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    expect(loads.count).toBe(1);
  });
});
