import { useQuery } from '@tanstack/react-query';
import { QUICK_ADD_KEY } from '@todoodle/shared/limits';
import { type ReactNode, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useGlobalShortcut } from '@/lib/shortcuts';
import { FloatingAddButton } from '@/features/workspace/FloatingAddButton';
import { useIsNarrow } from '@/features/workspace/useIsNarrow';
import { type ListScope, scopeKey } from '@/lib/queryKeys';
import type { QuickAddTarget } from './DestinationChip';
import { tasksQuery } from './queries';
import { QuickAdd } from './QuickAdd';
import type { LocalTask } from './taskCache';
import { ShowCompletedToggle, useShowCompleted } from './ShowCompletedToggle';
import { LazyTaskDetailSheet, preloadTaskDetail } from './TaskDetailSheet.lazy';
import { TaskList, type TaskListStatus } from './TaskList';
import { type TaskRowActions, TaskRowActionsContext } from './TaskRowActions';
import { useCreateTask } from './useCreateTask';
import { useTaskActions } from './useTaskMutations';
import { openMovePicker } from './movePicker';
import { useTaskShortcuts } from './useTaskShortcuts';
import './wireTaskActions';

const NO_TASKS: LocalTask[] = [];

type QuickAddState = { mode: 'inline' | 'docked' } | null;
/** The task open in the detail sheet, and the row focus returns to when it closes. */
type DetailState = { id: string; returnFocusTo: HTMLElement | null } | null;

type Props = {
  workspaceId: string;
  /** Which tasks: the Inbox, or (story 7) one project. */
  scope: ListScope;
  /** The view's h1 (id="view-title", tabIndex -1: the shell focuses it). */
  heading: ReactNode;
  /** Shown when the list has no open tasks. */
  empty: ReactNode;
  /** Where quick add puts new tasks (its chip says so). */
  target: QuickAddTarget;
};

/**
 * One task list view (the Inbox, a project): heading with 'Show completed', the tasks in order, the detail
 * sheet, and quick add at the bottom (Q, '+ Add task', or the phone FAB). Story 7 extracted it from the Inbox
 * view so projects render the same list.
 */
export function TaskListView({ workspaceId, scope, heading, empty, target }: Props) {
  // Stable functions: the row actions context value never changes, so rows never re-render for it.
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
  // E, Delete/Backspace and Space on the focused row (story 6).
  useTaskShortcuts({
    edit: openDetail,
    delete: rowActions.remove,
    toggle: (id, row) => (row.dataset.completed ? rowActions.reopen(id) : rowActions.complete(id)),
  });
  // 'Show completed', remembered per list on this browser. Toggling keeps the current rows on screen
  // until the other variant loads (the query's keepPreviousData).
  const [showCompleted, setShowCompleted] = useShowCompleted(workspaceId, scopeKey(scope));
  const query = useQuery(tasksQuery(workspaceId, scope, showCompleted));
  const { refetch } = query;
  const onRetry = useCallback(() => void refetch(), [refetch]);
  // A failed background refetch keeps the rows it already has; only a list that never loaded shows the error.
  const status: TaskListStatus = query.data ? 'ready' : query.isError ? 'error' : 'loading';

  // Quick add's open state and where focus goes back on close, shared by Q, the button and the FAB.
  const [quickAdd, setQuickAdd] = useState<QuickAddState>(null);
  // A getter, because the opener may re-mount while quick add is open (the FAB hides while docked).
  const returnFocus = useRef<() => HTMLElement | null>(() => null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const narrow = useIsNarrow();
  const nameRef = useRef<HTMLInputElement>(null);

  const open = (mode: 'inline' | 'docked', opener: () => HTMLElement | null) => {
    if (quickAdd) {
      nameRef.current?.focus();
      return;
    }
    returnFocus.current = opener;
    setQuickAdd({ mode });
  };

  const close = () => {
    // Commit the close first, so the opener (the '+ Add task' button comes back) can take focus.
    flushSync(() => setQuickAdd(null));
    const opener = returnFocus.current();
    returnFocus.current = () => null;
    (opener?.isConnected ? opener : (addButtonRef.current ?? fabRef.current))?.focus();
  };

  // Q: inline under the list, or docked above the keyboard in the phone layout.
  useGlobalShortcut(
    QUICK_ADD_KEY,
    () => {
      // Focus goes back to whatever had it (e.g. the task row the user was on).
      const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      open(narrow ? 'docked' : 'inline', () => previous);
    },
    {
      description: 'Add task',
      group: 'Tasks',
    },
  );

  return (
    // Where the floating add button shows (phones, touch screens), room below the last row so it can scroll clear of it.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 max-md:pb-24 touch:pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        <ShowCompletedToggle on={showCompleted} onChange={setShowCompleted} />
      </div>
      <TaskRowActionsContext value={rowActions}>
        <TaskList tasks={query.data ?? NO_TASKS} status={status} onRetry={onRetry} empty={empty} showCompleted={showCompleted} />
      </TaskRowActionsContext>
      {detail ? (
        <Suspense fallback={null}>
          <LazyTaskDetailSheet
            key={detail.id}
            workspaceId={workspaceId}
            taskId={detail.id}
            list={scope}
            includeCompleted={showCompleted}
            returnFocusTo={detail.returnFocusTo}
            onClose={closeDetail}
          />
        </Suspense>
      ) : null}
      {quickAdd ? (
        <QuickAdd target={target} mode={quickAdd.mode} onCreate={createTask} onClose={close} nameRef={nameRef} />
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
      {/* Phones and touch screens; hidden while quick add is docked where it would sit. */}
      {quickAdd?.mode === 'docked' ? null : <FloatingAddButton ref={fabRef} narrow={narrow} onPress={() => open('docked', () => fabRef.current)} />}
    </div>
  );
}
