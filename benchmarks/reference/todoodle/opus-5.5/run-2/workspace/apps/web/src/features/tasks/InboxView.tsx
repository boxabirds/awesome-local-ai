import { QUICK_ADD_KEY } from '@todoodle/shared/limits';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FloatingAddButton } from '@/features/workspace/FloatingAddButton';
import { useIsNarrow } from '@/features/workspace/useIsNarrow';
import { useGlobalShortcut } from '@/lib/shortcuts';
import { useHoverNone } from '@/lib/useHoverNone';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import type { QuickAddTarget } from './DestinationChip';
import { EmptyInbox } from './EmptyInbox';
import { ADD_TASK_ATTR, type FocusTarget, focusTarget, focusTargetFor, rowElement } from './focusAfterAction';
import { QuickAdd, type QuickAddHandle } from './QuickAdd';
import { tasksQuery } from './queries';
import { ShowCompletedToggle } from './ShowCompletedToggle';
import { browserStorage, readShowCompleted } from './showCompletedPref';
import { TaskActionsContext } from './TaskActionsContext';
import { LazyTaskDetailSheet } from './TaskDetailSheet.lazy';
import { TaskList, type TaskListStatus } from './TaskList';
import { useCreateTask } from './useCreateTask';
import { useTaskMutations } from './useTaskMutations';
import { useTaskShortcuts } from './useTaskShortcuts';

const INBOX: QuickAddTarget = { kind: 'inbox' };
const LIST = 'inbox';

type QuickAddState = { open: false } | { open: true; mode: 'inline' | 'docked'; returnTo: HTMLElement | null };

/** The open detail sheet: which task, and the row's index when it opened (focus fallback). */
type DetailState = { taskId: string; index: number };

const listElement = () => document.querySelector<HTMLElement>('ul[aria-label="Tasks"]');

/**
 * The Inbox: heading, "Show completed", task list, quick add and the task detail sheet. The
 * quick-add open state and where focus returns on close live here, shared by the Q shortcut, the
 * "+ Add task" button and (on phones and touch screens, instead of that button) the floating add
 * button, which opens it docked. Row actions (complete, delete with Undo, edit) and their keyboard
 * shortcuts are wired here once for the whole list.
 */
export function InboxView({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [showCompleted, setShowCompleted] = useState(() => readShowCompleted(browserStorage(), workspaceId, LIST));
  const query = useQuery(tasksQuery(workspaceId, LIST, showCompleted));
  // Cached rows win over a failed background refetch; the error shows only with nothing to show.
  const status: TaskListStatus = query.data ? 'ready' : query.isError ? 'error' : 'loading';

  const [quickAdd, setQuickAdd] = useState<QuickAddState>({ open: false });
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Phones (narrow) and touch screens (no hover) get the floating button instead of "+ Add task".
  const narrow = useIsNarrow();
  const touch = useHoverNone();
  const showFab = narrow || touch;
  const quickAddRef = useRef<QuickAddHandle>(null);

  const openQuickAdd = useCallback((mode: 'inline' | 'docked', opener: Element | null) => {
    if (quickAddRef.current) {
      quickAddRef.current.focusName();
      return;
    }
    const returnTo = opener instanceof HTMLElement && opener !== document.body ? opener : null;
    setQuickAdd({ open: true, mode, returnTo });
  }, []);

  const closeQuickAdd = useCallback(() => {
    const returnTo = quickAdd.open ? quickAdd.returnTo : null;
    // Commit first so the "+ Add task" button is visible again before it takes focus.
    flushSync(() => setQuickAdd({ open: false }));
    (returnTo?.isConnected ? returnTo : (addButtonRef.current ?? fabRef.current))?.focus();
  }, [quickAdd]);

  const dockedOpen = quickAdd.open && quickAdd.mode === 'docked';
  useKeyboardInset(dockedOpen);

  useGlobalShortcut(QUICK_ADD_KEY, () => openQuickAdd('inline', document.activeElement), {
    description: 'Add task',
    group: 'Tasks',
    enabled: canEdit,
  });

  const { createTask, retry, discard } = useCreateTask(workspaceId);
  const mutations = useTaskMutations(workspaceId);

  // The detail sheet, and where focus goes once it has closed.
  const [detail, setDetail] = useState<DetailState | null>(null);
  const afterClose = useRef<FocusTarget | null>(null);
  const openDetail = useCallback((taskId: string) => {
    const row = rowElement(taskId);
    const index = row?.parentElement ? Array.prototype.indexOf.call(row.parentElement.children, row) : 0;
    afterClose.current = null;
    setDetail({ taskId, index });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const onDetailClosed = useCallback(() => {
    const list = listElement();
    const pending = afterClose.current;
    afterClose.current = null;
    if (pending) {
      focusTarget(pending, list);
      return;
    }
    const opened = detail;
    if (!opened) return;
    if (rowElement(opened.taskId)) {
      focusTarget({ kind: 'row', id: opened.taskId }, list);
      return;
    }
    // The task left the list while open (deleted or completed elsewhere): its old neighbour.
    const rows = list ? Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-task-id]')) : [];
    const row = rows[Math.min(opened.index, rows.length - 1)];
    focusTarget(row ? { kind: 'row', id: row.dataset.taskId! } : { kind: 'addTask' }, list);
  }, [detail]);
  const deleteFromDetail = useCallback(
    (taskId: string) => {
      const list = listElement();
      afterClose.current = list ? focusTargetFor(list, taskId) : { kind: 'addTask' };
      setDetail(null);
      mutations.remove(taskId, { moveFocus: false });
    },
    [mutations],
  );

  useTaskShortcuts(
    {
      edit: (id) => openDetail(id),
      delete: (id) => mutations.remove(id, { moveFocus: true }),
      toggle: (id) => mutations.toggle(id),
    },
    canEdit,
  );

  // Stable: rows get their callbacks from one context value, never from inline lambdas.
  const rowActions = useMemo(
    () => ({ retry, discard, toggle: mutations.toggle, remove: mutations.remove, openDetail }),
    [retry, discard, mutations, openDetail],
  );

  const inlineOpen = quickAdd.open && quickAdd.mode === 'inline';
  return (
    <TaskActionsContext value={rowActions}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="view-title" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          Inbox
        </h1>
        <ShowCompletedToggle workspaceId={workspaceId} listKey={LIST} on={showCompleted} onChange={setShowCompleted} />
      </div>
      <TaskList
        tasks={query.data ?? []}
        status={status}
        onRetry={() => void query.refetch()}
        empty={<EmptyInbox touch={showFab} />}
        fallbackFocus={() => addButtonRef.current ?? fabRef.current}
        showCompleted={showCompleted}
        completedLoading={query.isPlaceholderData}
      />
      {quickAdd.open ? (
        <QuickAdd ref={quickAddRef} target={INBOX} mode={quickAdd.mode} onCreate={createTask} onClose={closeQuickAdd} />
      ) : null}
      {showFab ? (
        <FloatingAddButton ref={fabRef} hidden={dockedOpen} onPress={(button) => openQuickAdd('docked', button)} />
      ) : (
        <Button
          ref={addButtonRef}
          variant="ghost"
          className="self-start text-muted-foreground hover:text-foreground"
          hidden={inlineOpen}
          {...{ [ADD_TASK_ATTR]: '' }}
          onClick={(event) => openQuickAdd('inline', event.currentTarget)}
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          Add task
        </Button>
      )}
      {detail ? (
        <Suspense fallback={null}>
          <LazyTaskDetailSheet
            key={detail.taskId}
            workspaceId={workspaceId}
            list={LIST}
            includeCompleted={showCompleted}
            taskId={detail.taskId}
            returnFocusTo={detail.taskId}
            onClose={closeDetail}
            onClosed={onDetailClosed}
            onDelete={deleteFromDetail}
            update={mutations.update}
          />
        </Suspense>
      ) : null}
    </TaskActionsContext>
  );
}
