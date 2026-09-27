import { NAME_HINT_MS, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import type { Task, TaskList } from '@todoodle/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { CloseIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConflictNotice } from '@/features/live/ConflictNotice';
import { useEditGuard } from '@/features/live/useEditGuard';
import { GoneError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { lengthStatus } from './canSubmit';
import { LengthCounter } from './LengthCounter';
import type { LocalTask } from './localTask';
import { tasksQuery } from './queries';
import type { TaskMutations } from './useTaskMutations';

export const NAME_EMPTY_TEXT = "Name can't be empty";

/** Stable per id, so the sheet re-renders only when its own task changes. */
const selectors = new Map<string, (list: LocalTask[]) => LocalTask | undefined>();
export function selectTaskById(id: string): (list: LocalTask[]) => LocalTask | undefined {
  let select = selectors.get(id);
  if (!select) {
    select = (list) => list.find((task) => task.id === id);
    selectors.set(id, select);
  }
  return select;
}

export type TaskDetailSheetProps = {
  workspaceId: string;
  list: TaskList;
  includeCompleted: boolean;
  taskId: string;
  /** The row the sheet was opened from; focus returns to it on close while it is still in the list. */
  returnFocusTo: string;
  /** The sheet closed (Escape, Close, overlay, deleted). */
  onClose(): void;
  /** Called by Radix once the sheet has gone; the owner moves focus (row, next row or add-task). */
  onClosed(): void;
  /** Delete pressed: the owner deletes at once (no dialog), closes the sheet and moves focus on. */
  onDelete(taskId: string): void;
  update: TaskMutations['update'];
};

const fieldClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-destructive';

/**
 * The task detail panel: a right-hand sheet, full screen below MOBILE_BREAKPOINT_PX (CSS classes,
 * no JS width). Name saves on Enter or blur, description on blur. Escape first cancels the edit in
 * progress, then closes. A blank name comes back with "Name can't be empty" for NAME_HINT_MS; an
 * over-limit field keeps its text, shows how far over, and saves nothing. Someone else's change or
 * deletion is handled by story 4's edit guard. Delete deletes at once (Undo in the toast).
 */
export default function TaskDetailSheet(props: TaskDetailSheetProps) {
  const { workspaceId, list, includeCompleted, taskId, onClose, onClosed, onDelete, update } = props;
  const { data } = useQuery({ ...tasksQuery(workspaceId, list, includeCompleted), select: selectTaskById(taskId) });
  // The last known copy: a task completed elsewhere leaves an open-only list but can still be edited.
  const lastTask = useRef<LocalTask | undefined>(data);
  if (data) lastTask.current = data;
  const task = data ?? lastTask.current;

  // null: not editing that field (it shows the saved value, and follows others' changes).
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  const [nameHint, setNameHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const nameCounterId = `${baseId}-name-count`;
  const descriptionCounterId = `${baseId}-description-count`;
  const hintId = `${baseId}-hint`;

  const savedName = task?.name ?? '';
  const savedDescription = task?.description ?? '';
  const name = draftName ?? savedName;
  const description = draftDescription ?? savedDescription;

  const guard = useEditGuard({
    key: `task:${taskId}`,
    fields: { name, description },
    entityLabel: 'task',
    save: async (patch) => {
      await update(taskId, patch);
      setDraftName(null);
      setDraftDescription(null);
    },
    onGone: onClose,
  });
  const { arm, disarm, markSaved } = guard;

  useEffect(() => {
    arm();
    return () => disarm();
  }, [arm, disarm]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const save = useCallback(
    (patch: { name?: string; description?: string }) => {
      update(taskId, patch).then(
        (saved: Task) => {
          // Still open: keep guarding from the saved values.
          markSaved({ name: saved.name, description: saved.description });
          arm();
        },
        (error: unknown) => {
          // Deleted meanwhile: "This task was deleted" is already shown; the sheet closes.
          if (error instanceof GoneError) onClose();
        },
      );
    },
    [update, taskId, markSaved, arm, onClose],
  );

  const showNameHint = () => {
    setNameHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setNameHint(false), NAME_HINT_MS);
  };

  const commitName = () => {
    if (draftName === null) return;
    const trimmed = draftName.trim();
    if (trimmed === '') {
      setDraftName(null);
      showNameHint();
      return;
    }
    if (lengthStatus(draftName.length, TASK_NAME_MAX) === 'over') return;
    setDraftName(null);
    if (trimmed !== savedName) save({ name: trimmed });
  };

  const commitDescription = () => {
    if (draftDescription === null) return;
    if (lengthStatus(draftDescription.length, TASK_DESCRIPTION_MAX) === 'over') return;
    setDraftDescription(null);
    if (draftDescription !== savedDescription) save({ description: draftDescription });
  };

  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    commitName();
  };

  /** First Escape cancels the edit in progress (the field reverts); with nothing to cancel it closes. */
  const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
    const active = document.activeElement;
    if (active === nameRef.current && draftName !== null && draftName !== savedName) {
      event.preventDefault();
      setDraftName(null);
    } else if (active instanceof HTMLTextAreaElement && draftDescription !== null && draftDescription !== savedDescription) {
      event.preventDefault();
      setDraftDescription(null);
    }
  };

  const onOpenChange = (open: boolean) => {
    if (open) return;
    // Closed by a click (Close, overlay): what was typed is saved like a blur would.
    commitName();
    commitDescription();
    onClose();
  };

  const nameOver = lengthStatus(name.length, TASK_NAME_MAX) === 'over';
  const descriptionOver = lengthStatus(description.length, TASK_DESCRIPTION_MAX) === 'over';
  const theirs = guard.conflict ? (guard.conflict.theirs.name ?? guard.conflict.theirs.description ?? '') : '';

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        data-task-detail=""
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
        onEscapeKeyDown={onEscapeKeyDown}
        className="overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="text-lg font-semibold">Task details</SheetTitle>
          <SheetClose
            aria-label="Close"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CloseIcon aria-hidden="true" className="size-5" />
          </SheetClose>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${baseId}-name`} className="text-sm font-medium">
            Name
          </label>
          <input
            id={`${baseId}-name`}
            ref={nameRef}
            value={name}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={onNameKeyDown}
            onBlur={commitName}
            aria-invalid={nameOver || undefined}
            aria-describedby={cn(nameHint && hintId, nameOver && nameCounterId) || undefined}
            className={cn(fieldClass, task?.completedAt && 'line-through')}
            autoComplete="off"
            enterKeyHint="done"
          />
          <p id={hintId} aria-live="polite" className="min-h-0 text-sm text-destructive">
            {nameHint ? NAME_EMPTY_TEXT : ''}
          </p>
          <LengthCounter id={nameCounterId} length={name.length} limit={TASK_NAME_MAX} />
          {guard.conflict ? (
            <ConflictNotice
              theirs={theirs}
              onUseMine={() => void guard.useMine().catch(() => {})}
              onKeepTheirs={() => {
                guard.keepTheirs();
                setDraftName(null);
                setDraftDescription(null);
              }}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${baseId}-description`} className="text-sm font-medium">
            Description
          </label>
          <textarea
            id={`${baseId}-description`}
            value={description}
            onChange={(event) => setDraftDescription(event.target.value)}
            onBlur={commitDescription}
            rows={6}
            placeholder="Add details"
            aria-invalid={descriptionOver || undefined}
            aria-describedby={descriptionOver ? descriptionCounterId : undefined}
            className={cn(fieldClass, 'resize-y')}
          />
          <LengthCounter id={descriptionCounterId} length={description.length} limit={TASK_DESCRIPTION_MAX} />
        </div>

        <div className="mt-auto flex justify-start pt-2">
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(taskId)}>
            <TrashIcon aria-hidden="true" className="size-4" />
            Delete
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
