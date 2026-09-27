import { useQueryClient } from '@tanstack/react-query';
import { SKELETON_ROW_COUNT, QUICK_ADD_KEY } from '@todoodle/shared/limits';
import { formatShortcutDate } from '@todoodle/shared/dates';
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { viewerLocale } from '@/features/dates/locale';
import { useLocalDate } from '@/features/dates/useLocalDate';
import type { QuickAddTarget } from '@/features/tasks/DestinationChip';
import { openMovePicker } from '@/features/tasks/movePicker';
import { type NewTaskInput, QuickAdd } from '@/features/tasks/QuickAdd';
import { ShowCompletedToggle, useShowCompleted } from '@/features/tasks/ShowCompletedToggle';
import { SkeletonRow } from '@/features/tasks/SkeletonRow';
import { LazyTaskDetailSheet, preloadTaskDetail } from '@/features/tasks/TaskDetailSheet.lazy';
import { type TaskRowActions, TaskRowActionsContext } from '@/features/tasks/TaskRowActions';
import { useCreateTask } from '@/features/tasks/useCreateTask';
import { useTaskActions } from '@/features/tasks/useTaskMutations';
import { useTaskShortcuts } from '@/features/tasks/useTaskShortcuts';
import '@/features/tasks/wireTaskActions';
import { FloatingAddButton } from '@/features/workspace/FloatingAddButton';
import { useIsNarrow } from '@/features/workspace/useIsNarrow';
import { useGlobalShortcut } from '@/lib/shortcuts';
import { notifyStatus } from '@/lib/notify';
import { OverdueSection } from './OverdueSection';
import type { TodayData, TodayRow } from './todayCache';
import { TODAY_LIST_KEY, prefetchToday } from './todayLoader';
import { TodayRows } from './TodayRows';
import { TodayTitle } from './TodayTitle';
import { useTodayQuery } from './useTodayQuery';

/** Said when a task added from Today gets a date other than today (it will not show here). */
export const ADDED_TO_INBOX_TEXT = 'Added to Inbox';
export const ALL_CLEAR_TEXT = 'All clear for today';

// Quick add on Today puts new tasks in the Inbox, dated today unless another date is picked.
const INBOX_TARGET: QuickAddTarget = { kind: 'inbox' };
const SKELETON_KEYS = Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => i);

// Hoisted static JSX (rendering-hoist-jsx).
const heading = (
  <h1 id="view-title" tabIndex={-1} className="text-xl font-semibold outline-none">
    Today
  </h1>
);
const skeleton = (
  <section aria-busy="true" aria-label="Loading tasks" className="flex flex-col">
    {SKELETON_KEYS.map((i) => (
      <SkeletonRow key={i} />
    ))}
  </section>
);
const allClear = (
  <div data-today-empty className="flex flex-col items-center gap-2 py-12 text-center">
    <p className="text-lg font-medium">{ALL_CLEAR_TEXT}</p>
  </div>
);

type Sections = { overdue: TodayRow[]; today: TodayRow[]; completed: TodayRow[]; overdueIds: string[] };

/**
 * The groups for the viewer's current local date, derived during render (no effect-synced state). Rows arrive
 * ordered by due date (overdue) and sort order (today); re-classifying against `date` keeps the view right at local
 * midnight until the refetch for the new date lands (yesterday's Today rows become overdue, still in date order).
 */
function sectionsOf(data: TodayData | undefined, date: string): Sections {
  const sections: Sections = { overdue: [], today: [], completed: [], overdueIds: [] };
  if (!data) return sections;
  for (const group of [data.overdue, data.today]) {
    for (const row of group) {
      if (row.dueDate === null || row.dueDate > date) continue;
      if (row.dueDate < date) {
        sections.overdue.push(row);
        // Reschedule sends only saved, still-open rows.
        if (row.localStatus === undefined && !row.leaving) sections.overdueIds.push(row.id);
      } else sections.today.push(row);
    }
  }
  for (const row of data.completed) if (row.dueDate === date) sections.completed.push(row);
  return sections;
}

type QuickAddState = { mode: 'inline' | 'docked' } | null;
type DetailState = { id: string; returnFocusTo: HTMLElement | null } | null;

/**
 * /w/:workspaceId/today (lazy route chunk; prd.today_view): every open task due on the viewer's local date or before,
 * across the Inbox and all projects. Overdue first (with its warning icon, count and Reschedule), then Today, each
 * row with its project tag. Renders from a deferred value, so thousands of rows never hold up typing in quick add.
 * Quick add (Q, '+ Add task', the phone '+') adds to the Inbox dated today.
 */
export default function TodayView({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const date = useLocalDate();
  const [showCompleted, setShowCompleted] = useShowCompleted(workspaceId, TODAY_LIST_KEY);
  const query = useTodayQuery(workspaceId, date, showCompleted);
  const data = useDeferredValue(query.data);
  const sections = useMemo(() => sectionsOf(data, date), [data, date]);
  const { refetch } = query;

  // Route entry: Today and its count together (async-parallel). No-ops when already fresh.
  useEffect(() => void prefetchToday(queryClient, workspaceId), [queryClient, workspaceId]);

  const { createTask, retry, discard } = useCreateTask(workspaceId);
  const actions = useTaskActions(workspaceId);
  const [detail, setDetail] = useState<DetailState>(null);
  const openDetail = useCallback((id: string, row: HTMLElement | null) => {
    void preloadTaskDetail();
    setDetail({ id, returnFocusTo: row });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const rowActions = useMemo<TaskRowActions>(
    () => ({
      retry,
      discard,
      complete: (id) => void actions.complete(id),
      reopen: (id) => void actions.reopen(id),
      remove: (id) => void actions.remove(id),
      edit: openDetail,
      move: openMovePicker,
    }),
    [retry, discard, actions, openDetail],
  );
  useTaskShortcuts({
    edit: openDetail,
    delete: rowActions.remove,
    toggle: (id, row) => (row.dataset.completed ? rowActions.reopen(id) : rowActions.complete(id)),
  });

  const onCreate = useCallback(
    (input: NewTaskInput) => {
      createTask(input);
      if (input.dueDate !== date) notifyStatus(ADDED_TO_INBOX_TEXT);
    },
    [createTask, date],
  );

  // Quick add: Q, the '+ Add task' button, or the phone FAB (as in the list views).
  const [quickAdd, setQuickAdd] = useState<QuickAddState>(null);
  const returnFocus = useRef<() => HTMLElement | null>(() => null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const narrow = useIsNarrow();
  const open = (mode: 'inline' | 'docked', opener: () => HTMLElement | null) => {
    if (quickAdd) {
      nameRef.current?.focus();
      return;
    }
    returnFocus.current = opener;
    setQuickAdd({ mode });
  };
  const close = () => {
    flushSync(() => setQuickAdd(null));
    const opener = returnFocus.current();
    returnFocus.current = () => null;
    (opener?.isConnected ? opener : (addButtonRef.current ?? fabRef.current))?.focus();
  };
  useGlobalShortcut(
    QUICK_ADD_KEY,
    () => {
      const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      open(narrow ? 'docked' : 'inline', () => previous);
    },
    { description: 'Add task', group: 'Tasks' },
  );

  const status = data ? 'ready' : query.isError ? 'error' : 'loading';
  const empty = sections.overdue.length === 0 && sections.today.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 max-md:pb-24 touch:pb-24">
      <TodayTitle workspaceId={workspaceId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        <ShowCompletedToggle on={showCompleted} onChange={setShowCompleted} />
      </div>
      <TaskRowActionsContext value={rowActions}>
        {status === 'loading' ? (
          skeleton
        ) : status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p>Couldn't load your tasks.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : empty ? (
          allClear
        ) : (
          <>
            {sections.overdue.length > 0 ? <OverdueSection workspaceId={workspaceId} rows={sections.overdue} ids={sections.overdueIds} /> : null}
            <section aria-labelledby="today-group-title" data-today-section="today" className="flex flex-col gap-1">
              <h2 id="today-group-title" className="px-2 text-sm font-semibold">{`Today · ${formatShortcutDate(date, viewerLocale())}`}</h2>
              {sections.today.length > 0 ? <TodayRows rows={sections.today} label="Tasks due today" /> : null}
            </section>
          </>
        )}
        {showCompleted && status === 'ready' ? (
          <section aria-labelledby="today-completed-title" data-today-section="completed" className="mt-4 flex flex-col gap-1">
            <h2 id="today-completed-title" className="px-2 text-sm font-medium text-muted-foreground">
              Completed
            </h2>
            {sections.completed.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">No completed tasks</p>
            ) : (
              <TodayRows rows={sections.completed} label="Completed tasks" />
            )}
          </section>
        ) : null}
      </TaskRowActionsContext>
      {detail ? (
        <Suspense fallback={null}>
          <LazyTaskDetailSheet
            key={detail.id}
            workspaceId={workspaceId}
            taskId={detail.id}
            list="today"
            includeCompleted={showCompleted}
            returnFocusTo={detail.returnFocusTo}
            onClose={closeDetail}
          />
        </Suspense>
      ) : null}
      {quickAdd ? (
        <QuickAdd target={INBOX_TARGET} defaultDueDate={date} mode={quickAdd.mode} onCreate={onCreate} onClose={close} nameRef={nameRef} />
      ) : narrow ? null : (
        <Button
          ref={addButtonRef}
          variant="ghost"
          data-add-task
          className="self-start text-muted-foreground touch:hidden"
          onClick={() => open('inline', () => addButtonRef.current)}
        >
          <PlusIcon aria-hidden="true" />
          Add task
        </Button>
      )}
      {quickAdd?.mode === 'docked' ? null : <FloatingAddButton ref={fabRef} narrow={narrow} onPress={() => open('docked', () => fabRef.current)} />}
    </div>
  );
}
