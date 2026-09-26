import { memo, use } from 'react';
import { Button } from '@/components/ui/button';
import type { LocalTask } from './taskCache';
import { TaskRowActionsContext } from './TaskRowActions';

/** Test hook: counts TaskRow renders (TC-45, TC-110). Never read by the app. */
export const taskRowRenders = { count: 0 };

/**
 * One open task: a round checkbox (decorative until story 6 makes it interactive), the name, and a
 * one-line muted preview of the description when there is one. A row that is not saved yet shows its
 * state: busy while saving; on failure the text stays, with Retry/Discard (failed) or Discard only
 * (rejected), announced with role=alert. tabIndex is managed by useRovingList, never by props.
 */
export const TaskRow = memo(function TaskRow({ task }: { task: LocalTask }) {
  taskRowRenders.count++;
  const { retry, discard } = use(TaskRowActionsContext);
  const status = task.localStatus;
  const unsaved = status === 'failed' || status === 'rejected';
  return (
    <li
      role="option"
      aria-selected={false}
      tabIndex={-1}
      data-task-id={task.id}
      data-local-status={status}
      aria-busy={status === 'pending' ? true : undefined}
      className="task-row flex items-start gap-3 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 rounded-full border-2 border-border" />
      <div className="min-w-0 flex-1">
        <p className="select-text break-words">{task.name}</p>
        {task.description ? <p className="truncate text-sm text-muted-foreground">{task.description}</p> : null}
        {unsaved ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              {status === 'failed' ? "Couldn't save this task." : "This task can't be saved."}
            </p>
            {status === 'failed' ? (
              <Button variant="outline" size="sm" onClick={() => retry(task.id)}>
                Retry
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => discard(task.id)}>
              Discard
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
});
