import { SKELETON_ROW_COUNT } from '@todoodle/shared/limits';
import { type ReactNode, type Ref, useDeferredValue, useImperativeHandle, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { LocalTask } from './localTask';
import { SkeletonRow } from './SkeletonRow';
import { TaskRow } from './TaskRow';
import { type RovingList, useRovingList } from './useRovingList';

export type TaskListStatus = 'loading' | 'error' | 'ready';

// Hoisted: the loading state never changes.
const skeletonRows = (
  <section aria-busy="true" aria-label="Loading tasks">
    <ul className="flex flex-col">
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </ul>
  </section>
);

/**
 * The task list. Loading shows skeleton rows (first load only: refetches keep the old rows); an
 * error shows "Couldn't load your tasks." with Try again; an empty list shows `empty`. Rows are a
 * listbox with roving focus (one tab stop; ↑/↓, j/k, Home/End).
 */
export function TaskList({
  tasks,
  status,
  onRetry,
  empty,
  fallbackFocus,
  rovingRef,
}: {
  tasks: readonly LocalTask[];
  status: TaskListStatus;
  onRetry(): void;
  empty: ReactNode;
  /** Focused when the last row is removed (the "+ Add task" button). */
  fallbackFocus?: () => HTMLElement | null;
  rovingRef?: Ref<Pick<RovingList, 'focusAfterRemoval'>>;
}) {
  // Bursts of live or optimistic updates never block typing in quick add.
  const shown = useDeferredValue(tasks);
  const listRef = useRef<HTMLUListElement>(null);
  const roving = useRovingList(listRef, { fallback: fallbackFocus });
  useImperativeHandle(rovingRef, () => ({ focusAfterRemoval: roving.focusAfterRemoval }), [roving]);

  return status === 'loading' ? (
    skeletonRows
  ) : status === 'error' ? (
    <div className="flex flex-col items-start gap-3 py-6">
      <p role="alert">Couldn't load your tasks.</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  ) : shown.length === 0 ? (
    empty
  ) : (
    <ul ref={listRef} role="listbox" aria-label="Tasks" className="flex flex-col" onKeyDown={roving.onKeyDown} onFocus={roving.onFocus}>
      {shown.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}
