import { SKELETON_ROW_COUNT } from '@todoodle/shared/limits';
import { type ReactNode, useDeferredValue, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { describeShortcut } from '@/lib/shortcuts';
import { SkeletonRow } from './SkeletonRow';
import type { LocalTask } from './taskCache';
import { TaskRow } from './TaskRow';
import { useRovingList } from './useRovingList';

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
  /** Shown when the list is ready and has no rows (the Inbox's EmptyInbox). */
  empty: ReactNode;
};

/**
 * A list's open tasks. Loading: placeholder rows (first load only). Error: the message and Try again.
 * Ready: a listbox of memoised rows, one Tab stop, moved through with ↑/↓, j/k, Home and End. Rendered
 * from a deferred value, so bursts of live or optimistic updates never block typing in quick add.
 */
export function TaskList({ tasks, status, onRetry, empty }: Props) {
  const deferred = useDeferredValue(tasks);
  const listRef = useRef<HTMLUListElement>(null);
  const roving = useRovingList(listRef);

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
  return deferred.length === 0 ? (
    empty
  ) : (
    <ul ref={listRef} role="listbox" aria-label="Tasks" className="flex flex-col" onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
      {deferred.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}
