import { SKELETON_ROW_COUNT } from '@todoodle/shared/limits';
import { type ReactNode, type RefObject, useDeferredValue, useLayoutEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { describeShortcut } from '@/lib/shortcuts';
import { isOpenRow } from './cacheOps';
import { applyPendingRowFocus } from './focusAfterAction';
import { SkeletonRow } from './SkeletonRow';
import type { LocalTask } from './taskCache';
import { TaskRow } from './TaskRow';
import { type RovingList, useRovingList } from './useRovingList';

export type TaskListStatus = 'loading' | 'error' | 'ready';

// The list's own keys are not global shortcuts; the ? panel lists them as static entries.
describeShortcut({ keys: ['↑', '↓'], description: 'Move between tasks', group: 'Navigation' });
describeShortcut({ keys: ['j', 'k'], description: 'Move between tasks', group: 'Navigation' });
describeShortcut({ keys: ['Home', 'End'], description: 'Jump to the first or last task', group: 'Navigation' });

const SKELETON_KEYS = Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => i);

const skeleton = (
  <section aria-busy="true" aria-label="Loading tasks" className="flex flex-col">
    {SKELETON_KEYS.map((i) => (
      <SkeletonRow key={i} />
    ))}
  </section>
);

type Props = {
  tasks: LocalTask[];
  status: TaskListStatus;
  onRetry: () => void;
  /** Shown when the list is ready and has no open rows (the Inbox's EmptyInbox). */
  empty: ReactNode;
  /** Story 6: `tasks` also holds completed tasks; show them in their own group after the open ones. */
  showCompleted?: boolean;
};

function renderRow(task: LocalTask) {
  return (
    <TaskRow
      key={task.id}
      taskId={task.id}
      name={task.name}
      description={task.description}
      completedAt={task.completedAt}
      localStatus={task.localStatus}
      leaving={task.leaving}
      dueDate={task.dueDate ?? null}
    />
  );
}

function Rows({ tasks, listRef, roving, label }: { tasks: LocalTask[]; listRef: RefObject<HTMLUListElement | null>; roving: RovingList; label: string }) {
  return (
    <ul ref={listRef} role="listbox" aria-label={label} className="flex flex-col" onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
      {tasks.map(renderRow)}
    </ul>
  );
}

/**
 * A list's tasks. Loading: placeholder rows (first load only). Error: the message and Try again.
 * Ready: a listbox of memoised open rows, one Tab stop, moved through with ↑/↓, j/k, Home and End; with
 * 'Show completed' on, a second listbox of completed rows follows ('No completed tasks' when there are
 * none). Rendered from a deferred value, so bursts of live or optimistic updates never block typing.
 */
export function TaskList({ tasks, status, onRetry, empty, showCompleted = false }: Props) {
  const deferred = useDeferredValue(tasks);
  const listRef = useRef<HTMLUListElement>(null);
  const completedRef = useRef<HTMLUListElement>(null);
  const roving = useRovingList(listRef);
  const completedRoving = useRovingList(completedRef);
  // A rolled-back completion or delete brings focus back to its row once the row is on screen again.
  useLayoutEffect(() => {
    applyPendingRowFocus(listRef.current);
    applyPendingRowFocus(completedRef.current);
  });
  const groups = useMemo(() => {
    const open: LocalTask[] = [];
    const completed: LocalTask[] = [];
    for (const task of deferred) (isOpenRow(task) ? open : completed).push(task);
    return { open, completed };
  }, [deferred]);

  if (status === 'loading') return skeleton;
  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 py-6">
        <p>Couldn't load your tasks.</p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <>
      {groups.open.length === 0 ? empty : <Rows tasks={groups.open} listRef={listRef} roving={roving} label="Tasks" />}
      {showCompleted ? (
        <section aria-labelledby="completed-tasks-title" className="mt-4 flex flex-col gap-1">
          <h2 id="completed-tasks-title" className="px-2 text-sm font-medium text-muted-foreground">
            Completed
          </h2>
          {groups.completed.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">No completed tasks</p>
          ) : (
            <Rows tasks={groups.completed} listRef={completedRef} roving={completedRoving} label="Completed tasks" />
          )}
        </section>
      ) : null}
    </>
  );
}
