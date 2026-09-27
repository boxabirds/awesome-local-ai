import { formatCompletedDate } from '@todoodle/shared/dates';
import { MIN_TOUCH_TARGET_PX, TASK_ROW_INTRINSIC_HEIGHT_PX } from '@todoodle/shared/limits';
import { type CSSProperties, memo, useCallback, useEffect, useId, useRef } from 'react';
import { CheckIcon, MoreIcon, PencilIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useHoverNone } from '@/lib/useHoverNone';
import { cn } from '@/lib/utils';
import { useTaskBusy } from './busyStore';
import { checkedStore, usePendingCheck } from './checkedStore';
import type { LocalStatus } from './localTask';
import { MENU_HINTS } from './rowShortcuts';
import { useTaskActions } from './TaskActionsContext';
import { preloadTaskDetail } from './TaskDetailSheet.lazy';

// Off-screen rows skip layout and paint (on each row, never on the list).
const ROW_STYLE: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${TASK_ROW_INTRINSIC_HEIGHT_PX}px`,
};

/** The checkbox and the menu button: at least MIN_TOUCH_TARGET_PX square on every device. */
const HIT_AREA: CSSProperties = { minWidth: MIN_TOUCH_TARGET_PX, minHeight: MIN_TOUCH_TARGET_PX };

/** Test-only render counter (memoisation checks); compiled out of production builds. */
export const taskRowRenders = new Map<string, number>();

export type TaskRowProps = {
  taskId: string;
  name: string;
  description: string;
  completedAt: string | null;
  /** Story 5: set only on rows the server hasn't confirmed (saving, failed, rejected). */
  localStatus?: LocalStatus;
};

/**
 * One task: a round checkbox (Complete NAME / Reopen NAME; ticks at once, then the row leaves the
 * open list after a short animation, at once under reduced motion), the name (opens the detail
 * sheet), a one-line description preview, the completion date on completed rows, and a "…" menu
 * (Edit · E, Delete · Del; delete is immediate, with Undo). The menu button is always visible on
 * touch screens and appears on hover or focus with a mouse. aria-busy while a change is saving.
 * Unsaved rows (story 5) show saving, failed (Retry, Discard) or rejected (Discard only).
 *
 * The row's own controls are not tab stops (the list stays one tab stop, story 5): from the
 * keyboard, Space, E and Delete act on the focused row (useTaskShortcuts).
 */
export const TaskRow = memo(function TaskRow({ taskId, name, description, completedAt, localStatus }: TaskRowProps) {
  if (import.meta.env.MODE === 'test') taskRowRenders.set(taskId, (taskRowRenders.get(taskId) ?? 0) + 1);
  const { retry, discard, toggle, remove, openDetail } = useTaskActions();
  const pending = usePendingCheck(taskId);
  const saving = useTaskBusy(taskId);
  const touch = useHoverNone();
  const nameId = useId();
  /** Set when a menu item acted, so the menu doesn't pull focus back to its (leaving) trigger. */
  const menuActed = useRef(false);

  const isCompleted = completedAt !== null;
  const checked = pending?.checked ?? isCompleted;
  const leaving = pending?.leaving === true;
  const saved = localStatus === undefined;
  const busy = localStatus === 'pending' || saving;

  // The pending tick is dropped once this row's data agrees with it (rendering is batched, so the
  // cache change can reach the row after the mutation applied it), or when the row goes.
  useEffect(() => {
    if (pending && pending.checked === isCompleted) checkedStore.clear(taskId);
  }, [pending, isCompleted, taskId]);
  useEffect(() => () => checkedStore.clear(taskId), [taskId]);

  const onToggle = useCallback(() => toggle(taskId), [toggle, taskId]);
  const onOpen = useCallback(() => openDetail(taskId), [openDetail, taskId]);
  const onEditItem = useCallback(() => {
    menuActed.current = true;
    openDetail(taskId);
  }, [openDetail, taskId]);
  const onDeleteItem = useCallback(() => {
    menuActed.current = true;
    remove(taskId, { moveFocus: true });
  }, [remove, taskId]);
  const onMenuCloseAutoFocus = useCallback((event: Event) => {
    if (!menuActed.current) return;
    menuActed.current = false;
    event.preventDefault();
  }, []);

  return (
    <li
      data-task-id={taskId}
      tabIndex={-1}
      aria-labelledby={nameId}
      aria-busy={busy ? true : undefined}
      data-completed={isCompleted ? '' : undefined}
      data-leaving={leaving ? '' : undefined}
      style={ROW_STYLE}
      onPointerEnter={saved ? preloadTaskDetail : undefined}
      onFocus={saved ? preloadTaskDetail : undefined}
      className={cn(
        'group flex min-h-11 items-start gap-1 rounded-md px-1 py-0.5',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        localStatus === 'pending' && 'opacity-70',
        leaving && 'task-leaving motion-safe:opacity-0 motion-safe:transition-opacity motion-safe:duration-250',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${isCompleted ? 'Reopen' : 'Complete'} ${name}`}
        tabIndex={-1}
        disabled={!saved}
        onClick={onToggle}
        style={HIT_AREA}
        className="inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-5 items-center justify-center rounded-full border-2',
            checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
          )}
        >
          {checked ? <CheckIcon className="size-3.5" strokeWidth={3} /> : null}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        {saved ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={onOpen}
            className="cursor-pointer rounded-sm text-left select-text focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span id={nameId} className={cn('break-words select-text', isCompleted && 'text-muted-foreground line-through')}>
              {name}
            </span>
          </button>
        ) : (
          <span id={nameId} className="break-words select-text">
            {name}
          </span>
        )}
        {description ? <span className="truncate text-sm text-muted-foreground">{description}</span> : null}
        {isCompleted ? <span className="text-xs text-muted-foreground">Completed {formatCompletedDate(completedAt)}</span> : null}
        {localStatus === 'failed' || localStatus === 'rejected' ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p role="alert" className="text-sm text-destructive">
              {localStatus === 'failed' ? "Couldn't save this task." : "This task can't be saved."}
            </p>
            {localStatus === 'failed' ? (
              <Button size="sm" variant="secondary" onClick={() => retry(taskId)}>
                Retry
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => discard(taskId)}>
              Discard
            </Button>
          </div>
        ) : null}
      </div>
      {saved ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={`Actions for ${name}`}
            data-row-menu=""
            tabIndex={-1}
            style={HIT_AREA}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:opacity-100',
              // Mouse: shown on row hover or focus. Touch (no hover): always shown.
              !touch && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          >
            <MoreIcon aria-hidden="true" className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={onMenuCloseAutoFocus}>
            <DropdownMenuItem onSelect={onEditItem} aria-keyshortcuts="E">
              <PencilIcon aria-hidden="true" className="size-4" />
              <span className="flex-1">Edit</span>
              <kbd aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                {MENU_HINTS.edit}
              </kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDeleteItem} aria-keyshortcuts="Delete" className="text-destructive">
              <TrashIcon aria-hidden="true" className="size-4" />
              <span className="flex-1">Delete</span>
              <kbd aria-hidden="true" className="font-mono text-xs text-muted-foreground">
                {MENU_HINTS.delete}
              </kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
});
