import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import type { Counts, RescheduleResponse, RestoreDueDateItem, RestoreDueDatesResponse } from '@todoodle/shared/schemas';
import { startTransition, useMemo } from 'react';
import { showUndoToast } from '@/features/undo/showUndoToast';
import * as api from '@/lib/api';
import { notifyAlert } from '@/lib/notify';
import { queryKeys } from '@/lib/queryKeys';
import { type TodayData, type TodayRow, applyTodayChanges, findTodayRow, todayCaches } from './todayCache';

/** Shown (role=alert) when a reschedule could not be saved and the rows went back. */
export const RESCHEDULE_FAILED_TEXT = "Couldn't reschedule — try again";
/** Said after a fully successful Undo of a reschedule. */
export const DUE_DATES_RESTORED_TEXT = 'Due dates restored';

/** The undo toast: '1 task rescheduled to today', '7 tasks rescheduled to today'. */
export function rescheduledText(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'} rescheduled to today`;
}

/** After an undo that could not restore everything (prd.undo_reschedule). */
export function notRestoredText(count: number): string {
  return count === 1
    ? '1 task was changed by someone else and was not restored'
    : `${count} tasks were changed by someone else and were not restored`;
}

/** What Undo sends back: each rescheduled task's previous date, guarded by the version the reschedule left. */
export function rescheduleResultToUndoItems(changed: RescheduleResponse['changed']): RestoreDueDateItem[] {
  return changed.map((item) => ({ id: item.id, dueDate: item.previousDueDate, expectedVersion: item.version }));
}

type Snapshot = { today: Array<[QueryKey, TodayData | undefined]>; counts: Counts | undefined };

export type RescheduleActions = {
  /** Moves exactly these (displayed overdue) tasks to `to`, optimistically; offers Undo on success. */
  reschedule(ids: string[], to: string): Promise<void>;
  /** Undo of a reschedule (called by the toast): puts the previous dates back where nobody changed them since. */
  undo(items: RestoreDueDateItem[]): Promise<RestoreDueDatesResponse>;
};

/** One implementation per query client and workspace (the undo toast outlives components, so references stay stable). */
export function createRescheduleActions(queryClient: QueryClient, workspaceId: string): RescheduleActions {
  const prefix = queryKeys.today(workspaceId);
  const snapshot = (): Snapshot => ({ today: todayCaches(queryClient, workspaceId), counts: queryClient.getQueryData(queryKeys.counts(workspaceId)) });
  const restore = (before: Snapshot) => {
    for (const [key, data] of before.today) queryClient.setQueryData(key, data);
    queryClient.setQueryData(queryKeys.counts(workspaceId), before.counts);
  };
  /** Writes new due dates into every cached Today (in a transition: thousands of rows must never block typing). */
  const writeDates = (dates: ReadonlyMap<string, string | null>, versions?: ReadonlyMap<string, number>) =>
    startTransition(() => {
      for (const [key, data] of todayCaches(queryClient, workspaceId)) {
        const changes = new Map<string, TodayRow | null>();
        for (const [id, dueDate] of dates) {
          const row = findTodayRow(data, id);
          if (row) changes.set(id, { ...row, dueDate, version: versions?.get(id) ?? row.version });
        }
        const next = applyTodayChanges(data, changes);
        if (next !== data) queryClient.setQueryData(key, next);
      }
    });
  const refetch = () => void queryClient.invalidateQueries({ queryKey: prefix });

  const actions: RescheduleActions = {
    async reschedule(ids, to) {
      await queryClient.cancelQueries({ queryKey: prefix });
      const before = snapshot();
      writeDates(new Map(ids.map((id) => [id, to])));
      let result: RescheduleResponse;
      try {
        result = await api.rescheduleTasks(workspaceId, { ids, to });
      } catch {
        restore(before);
        notifyAlert(RESCHEDULE_FAILED_TEXT);
        return;
      }
      // The server's versions (Undo is guarded by them). Skipped ids were no longer overdue: refetch for the truth.
      writeDates(new Map(result.changed.map((item) => [item.id, item.dueDate])), new Map(result.changed.map((item) => [item.id, item.version])));
      if (result.skipped.length > 0) refetch();
      if (result.changed.length === 0) return;
      const items = rescheduleResultToUndoItems(result.changed);
      showUndoToast({
        message: rescheduledText(result.changed.length),
        inverse: () => actions.undo(items),
        restoredText: (response) => ((response as RestoreDueDatesResponse).skipped.length > 0 ? null : DUE_DATES_RESTORED_TEXT),
      });
    },

    async undo(items) {
      await queryClient.cancelQueries({ queryKey: prefix });
      writeDates(new Map(items.map((item) => [item.id, item.dueDate])));
      let result: RestoreDueDatesResponse;
      try {
        result = await api.restoreDueDates(workspaceId, items);
      } catch (error) {
        // The toast says "Couldn't undo — try again"; the rows come back from the server.
        refetch();
        throw error;
      }
      writeDates(new Map(result.restored.map((item) => [item.id, item.dueDate])), new Map(result.restored.map((item) => [item.id, item.version])));
      if (result.skipped.length > 0) {
        notifyAlert(notRestoredText(result.skipped.length));
        refetch();
      }
      return result;
    },
  };
  return actions;
}

const instances = new WeakMap<QueryClient, Map<string, RescheduleActions>>();

export function rescheduleActionsFor(queryClient: QueryClient, workspaceId: string): RescheduleActions {
  let byWorkspace = instances.get(queryClient);
  if (!byWorkspace) {
    byWorkspace = new Map();
    instances.set(queryClient, byWorkspace);
  }
  let actions = byWorkspace.get(workspaceId);
  if (!actions) {
    actions = createRescheduleActions(queryClient, workspaceId);
    byWorkspace.set(workspaceId, actions);
  }
  return actions;
}

/** Reschedule and its undo for a workspace (stable references). The confirmation gate lives in RescheduleButton. */
export function useReschedule(workspaceId: string): RescheduleActions {
  const queryClient = useQueryClient();
  return useMemo(() => rescheduleActionsFor(queryClient, workspaceId), [queryClient, workspaceId]);
}
