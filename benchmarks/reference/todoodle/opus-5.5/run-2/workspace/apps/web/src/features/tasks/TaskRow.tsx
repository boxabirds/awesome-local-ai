import { TASK_ROW_INTRINSIC_HEIGHT_PX } from '@todoodle/shared/limits';
import { type CSSProperties, memo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LocalTask } from './localTask';
import { useTaskActions } from './TaskActionsContext';

// Off-screen rows skip layout and paint (on each row, never on the list).
const ROW_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${TASK_ROW_INTRINSIC_HEIGHT_PX}px`,
};

/** Test-only render counter (memoisation checks); compiled out of production builds. */
export const taskRowRenders = new Map<string, number>();

/**
 * One task: a round checkbox (decorative until story 6), the name, and a one-line description
 * preview. Unsaved rows show their state: saving (aria-busy), failed (Retry, Discard) or rejected
 * (Discard only). The text always stays visible and selectable.
 */
export const TaskRow = memo(function TaskRow({ task }: { task: LocalTask }) {
  if (import.meta.env.MODE === 'test') taskRowRenders.set(task.id, (taskRowRenders.get(task.id) ?? 0) + 1);
  const { retry, discard } = useTaskActions();
  const status = task.localStatus;
  return (
    <li
      role="option"
      aria-selected={false}
      data-task-id={task.id}
      tabIndex={-1}
      aria-busy={status === 'pending' ? true : undefined}
      style={ROW_STYLE}
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-md px-2 py-2',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        status === 'pending' && 'opacity-70',
      )}
    >
      <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-border" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words select-text">{task.name}</span>
        {task.description ? <span className="truncate text-sm text-muted-foreground">{task.description}</span> : null}
        {status === 'failed' || status === 'rejected' ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p role="alert" className="text-sm text-destructive">
              {status === 'failed' ? "Couldn't save this task." : "This task can't be saved."}
            </p>
            {status === 'failed' ? (
              <Button size="sm" variant="secondary" onClick={() => retry(task.id)}>
                Retry
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => discard(task.id)}>
              Discard
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
});
