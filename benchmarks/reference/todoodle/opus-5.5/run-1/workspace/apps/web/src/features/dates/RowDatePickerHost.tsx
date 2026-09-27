import { useQueryClient } from '@tanstack/react-query';
import type { LocalDate } from '@todoodle/shared/dates';
import { useState } from 'react';
import { findInTodayCaches } from '@/features/today/todayCache';
import { findTask } from '@/features/tasks/cacheOps';
import type { LocalTask } from '@/features/tasks/taskCache';
import { useTaskActions } from '@/features/tasks/useTaskMutations';
import { queryKeys } from '@/lib/queryKeys';
import { DueDatePicker } from './DueDatePicker';
import { closeRowDatePicker, useRowDatePicker } from './rowDatePicker';
import { useDateShortcut } from './useDateShortcut';

/**
 * Mounted once in the workspace shell: registers D and renders the date picker of the row it was opened for,
 * anchored to that row's chip slot. A choice saves through the task actions (optimistic, rolled back with a toast
 * on failure); focus goes back to the row.
 */
export function RowDatePickerHost({ workspaceId }: { workspaceId: string }) {
  useDateShortcut();
  const picker = useRowDatePicker();
  if (!picker) return null;
  return <RowDatePicker key={picker.taskId} workspaceId={workspaceId} taskId={picker.taskId} row={picker.row} />;
}

function RowDatePicker({ workspaceId, taskId, row }: { workspaceId: string; taskId: string; row: HTMLElement | null }) {
  const queryClient = useQueryClient();
  const actions = useTaskActions(workspaceId);
  // The task's date when the picker opened (read once: the picker belongs to this moment).
  const [value] = useState<LocalDate | null>(() => {
    const lists = queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(workspaceId) }).map(([, list]) => list);
    return (findTask(lists, taskId) ?? findInTodayCaches(queryClient, workspaceId, taskId))?.dueDate ?? null;
  });
  const anchor = row?.querySelector<HTMLElement>('[data-chip-slot]') ?? row;
  return (
    <DueDatePicker
      value={value}
      open
      anchor={anchor}
      returnFocusTo={row}
      onOpenChange={(open) => {
        if (!open) closeRowDatePicker();
      }}
      onChange={(dueDate) => {
        if (dueDate === value) return;
        actions.update(taskId, { dueDate }).catch(() => undefined); // rolled back and explained by the actions
      }}
    />
  );
}
