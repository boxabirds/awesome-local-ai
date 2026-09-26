import { formatCompletedDate } from '@todoodle/shared/dates';
import { memo, use, useCallback, useId, useRef } from 'react';
import { CheckIcon, EllipsisIcon, FolderInputIcon, PencilIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { preloadMoveToPicker } from './moveToPickerLoader';
import { preloadTaskDetail } from './TaskDetailSheet.lazy';
import { TaskRowActionsContext } from './TaskRowActions';
import type { LocalStatus } from './taskCache';
import { useTaskBusy } from './taskBusy';

/** Test hook: counts TaskRow renders (TC-45, TC-110). Never read by the app. */
export const taskRowRenders = { count: 0 };

type Props = {
  taskId: string;
  name: string;
  description: string;
  completedAt: string | null;
  /** Story 5: a row that is not saved yet. */
  localStatus?: LocalStatus;
  /** Just completed: ticked, still in its open position for COMPLETE_ANIMATION_MS. */
  leaving?: boolean;
};

function preload() {
  void preloadTaskDetail();
}

type MenuAction = 'edit' | 'delete' | 'move';

/**
 * One task: a round checkbox (44px hit area; Complete NAME / Reopen NAME), the name (opens the detail
 * sheet), a muted one-line description preview, and a '…' menu with Edit (E), Move to… (M, story 7) and Delete (Del). Delete acts
 * at once: there is no confirmation, Undo is the safeguard. The menu button shows on hover or focus with a
 * mouse, and always on touch screens. Completed rows are struck through with their completion date.
 * aria-busy while a change is saving. Primitive props only (memo); tabIndex is story 5's roving tabindex.
 * A row that is not saved yet keeps story 5's Retry/Discard and offers no task actions.
 *
 * The row (role=option) is the only focusable part: the checkbox, name and menu trigger are pointer and
 * touch targets that never take focus (a focusable control inside an option is nested-interactive).
 * Keyboard users act on the focused row with Space, E and Delete, which the menu shows next to each item.
 */
export const TaskRow = memo(function TaskRow({ taskId, name, description, completedAt, localStatus, leaving = false }: Props) {
  taskRowRenders.count++;
  const actions = use(TaskRowActionsContext);
  const busy = useTaskBusy(taskId);
  const rowRef = useRef<HTMLLIElement>(null);
  const menuAction = useRef<MenuAction | null>(null);
  const nameId = useId();
  const completed = completedAt !== null;
  const unsaved = localStatus === 'failed' || localStatus === 'rejected';
  const local = localStatus !== undefined;

  const onCheck = useCallback(() => {
    if (local) return;
    if (completed && !leaving) actions.reopen(taskId);
    else if (!completed) actions.complete(taskId);
  }, [actions, completed, leaving, local, taskId]);
  const onEdit = useCallback(() => actions.edit(taskId, rowRef.current), [actions, taskId]);
  // Menu choices run once the menu has closed (its focus handling is done), so focus lands where the action puts it.
  const onMenuCloseAutoFocus = useCallback(
    (event: Event) => {
      const chosen = menuAction.current;
      menuAction.current = null;
      if (!chosen) return;
      event.preventDefault();
      if (chosen === 'edit') actions.edit(taskId, rowRef.current);
      else if (chosen === 'move') actions.move(taskId, rowRef.current);
      else actions.remove(taskId);
    },
    [actions, taskId],
  );

  return (
    <li
      ref={rowRef}
      role="option"
      aria-selected={false}
      tabIndex={-1}
      aria-labelledby={nameId}
      data-task-id={taskId}
      data-local-status={localStatus}
      data-completed={completed || undefined}
      data-leaving={leaving || undefined}
      aria-busy={localStatus === 'pending' || busy ? true : undefined}
      onPointerEnter={preload}
      onFocus={preload}
      className={cn(
        'task-row group flex items-start gap-1 rounded-md pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        leaving && 'task-row-leaving',
      )}
    >
      <span
        role="checkbox"
        aria-checked={completed}
        aria-label={`${completed ? 'Reopen' : 'Complete'} ${name}`}
        aria-disabled={local || undefined}
        onClick={onCheck}
        data-task-checkbox
        className="flex min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] shrink-0 cursor-pointer items-center justify-center rounded-full aria-disabled:cursor-default aria-disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-5 items-center justify-center rounded-full border-2',
            completed ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
          )}
        >
          {completed ? <CheckIcon className="size-3.5" strokeWidth={3} /> : null}
        </span>
      </span>
      <div className="min-w-0 flex-1 py-2.5">
        <p className={cn('break-words', completed && !leaving && 'text-muted-foreground line-through')}>
          <span id={nameId} onClick={local ? undefined : onEdit} className={cn(!local && 'cursor-pointer')}>
            {name}
          </span>
        </p>
        {description ? <p className="truncate text-sm text-muted-foreground">{description}</p> : null}
        {completed && !leaving ? (
          <span className="text-xs text-muted-foreground">
            Completed <time dateTime={completedAt}>{formatCompletedDate(completedAt)}</time>
          </span>
        ) : null}
        {unsaved ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-destructive">
              {localStatus === 'failed' ? "Couldn't save this task." : "This task can't be saved."}
            </p>
            {localStatus === 'failed' ? (
              <Button variant="outline" size="sm" onClick={() => actions.retry(taskId)}>
                Retry
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => actions.discard(taskId)}>
              Discard
            </Button>
          </div>
        ) : null}
      </div>
      {local ? null : (
        <DropdownMenu modal={false} onOpenChange={(open) => open && void preloadMoveToPicker()}>
          <DropdownMenuTrigger asChild>
            <span
              role="button"
              aria-label={`More actions for ${name}`}
              data-task-menu-trigger
              className="flex min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-muted data-[state=open]:opacity-100 touch:opacity-100"
            >
              <EllipsisIcon aria-hidden="true" className="size-4" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={onMenuCloseAutoFocus}>
            <DropdownMenuItem aria-keyshortcuts="E" onSelect={() => (menuAction.current = 'edit')}>
              <PencilIcon aria-hidden="true" />
              Edit
              <kbd aria-hidden="true" className="ml-auto font-sans text-xs text-muted-foreground">
                E
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem aria-keyshortcuts="M" onSelect={() => (menuAction.current = 'move')}>
              <FolderInputIcon aria-hidden="true" />
              Move to…
              <kbd aria-hidden="true" className="ml-auto font-sans text-xs text-muted-foreground">
                M
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem aria-keyshortcuts="Delete" onSelect={() => (menuAction.current = 'delete')}>
              <TrashIcon aria-hidden="true" />
              Delete
              <kbd aria-hidden="true" className="ml-auto font-sans text-xs text-muted-foreground">
                Del
              </kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
});
