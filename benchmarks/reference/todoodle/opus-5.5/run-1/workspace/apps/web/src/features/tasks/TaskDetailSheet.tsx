import { useQuery } from '@tanstack/react-query';
import { NAME_HINT_MS, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import type { Task, TaskList } from '@todoodle/shared/schemas';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { TrashIcon, XIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConflictNotice } from '@/features/live/ConflictNotice';
import type { GuardFields } from '@/features/live/editGuard';
import { useEditGuard } from '@/features/live/useEditGuard';
import { cn } from '@/lib/utils';
import { LengthCounter } from './LengthCounter';
import { tasksQuery } from './queries';
import type { LocalTask } from './taskCache';
import { useTaskActions } from './useTaskMutations';

export const NAME_EMPTY_TEXT = "Name can't be empty";

const selectors = new Map<string, (tasks: LocalTask[]) => LocalTask | undefined>();

/** A stable `select` per task id, so the sheet re-renders only when its own task changes (rerender-derived-state). */
export function selectTaskById(id: string): (tasks: LocalTask[]) => LocalTask | undefined {
  let select = selectors.get(id);
  if (!select) {
    select = (tasks) => tasks.find((task) => task.id === id);
    selectors.set(id, select);
  }
  return select;
}

type Props = {
  workspaceId: string;
  taskId: string;
  /** The list the task was opened from (its cached query holds the task). */
  list: TaskList;
  includeCompleted: boolean;
  /** The row the sheet was opened from: focus goes back to it when the sheet closes (if it still exists). */
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
};

type Fields = GuardFields & { name?: string; description?: string };

/**
 * A task's detail (ui.task_detail): a right-side sheet, full screen below MOBILE_BREAKPOINT_PX (CSS only),
 * with the editable name (saved on Enter or blur) and description (saved on blur). Escape first cancels
 * the edit in progress, then closes. A blank name reverts with "Name can't be empty" for NAME_HINT_MS; an
 * over-long name keeps its text, shows the over-limit count and is not saved. Delete acts at once (no
 * confirmation): the sheet closes and focus moves to the next task. Someone else's change or delete is
 * handled by story 4's edit guard. Keyed by task id by the parent, so drafts reset per task.
 */
export function TaskDetailSheet({ workspaceId, taskId, list, includeCompleted, returnFocusTo, onClose }: Props) {
  const { data: task } = useQuery({ ...tasksQuery(workspaceId, list, includeCompleted), select: selectTaskById(taskId) });
  const actions = useTaskActions(workspaceId);
  // An edit in progress; null shows the saved value (and follows others' changes).
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [descriptionEdit, setDescriptionEdit] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const closed = useRef(false);

  // Only fields the user has changed are guarded: others' edits to untouched fields just show up.
  const fields: Fields = {};
  if (nameEdit !== null) fields.name = nameEdit;
  if (descriptionEdit !== null) fields.description = descriptionEdit;

  function close(returnFocus: boolean) {
    if (closed.current) return;
    closed.current = true;
    // Unmount first: the sheet's focus trap would pull focus straight back.
    flushSync(onClose);
    if (returnFocus && returnFocusTo?.isConnected) returnFocusTo.focus();
  }

  const guard = useEditGuard<Fields>({
    key: `task:${taskId}`,
    fields,
    entityLabel: 'task',
    save: async (patch) => {
      await actions.update(taskId, patch);
    },
    onGone: () => close(false),
  });

  useEffect(() => {
    guard.arm();
    return () => {
      guard.disarm();
      clearTimeout(hintTimer.current);
    };
  }, [guard.arm, guard.disarm]);

  // The task left this list (deleted, here or by someone else): nothing left to show.
  useEffect(() => {
    if (!task) close(false);
  });

  if (!task) return null;
  const saved: Task = task;
  const name = nameEdit ?? saved.name;
  const description = descriptionEdit ?? saved.description;

  function showHint() {
    clearTimeout(hintTimer.current);
    setHintVisible(true);
    hintTimer.current = setTimeout(() => setHintVisible(false), NAME_HINT_MS);
  }

  function afterSave(patch: Fields) {
    guard.markSaved({ name: saved.name, description: saved.description, ...patch });
    guard.arm();
  }

  function commitName() {
    if (nameEdit === null || guard.conflict) return;
    const trimmed = nameEdit.trim();
    if (trimmed === '') {
      setNameEdit(null);
      showHint();
      return;
    }
    // Over the limit: the text stays for the user to shorten; nothing is sent.
    if (nameEdit.length > TASK_NAME_MAX) return;
    setNameEdit(null);
    if (trimmed === saved.name) return;
    actions.update(taskId, { name: trimmed }).then(
      () => afterSave({ name: trimmed }),
      () => undefined, // rolled back and explained by the task actions
    );
  }

  function commitDescription() {
    if (descriptionEdit === null || guard.conflict) return;
    if (descriptionEdit.length > TASK_DESCRIPTION_MAX) return;
    setDescriptionEdit(null);
    const next = descriptionEdit.trim();
    if (next === saved.description) return;
    actions.update(taskId, { description: descriptionEdit }).then(
      () => afterSave({ description: next }),
      () => undefined,
    );
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitName();
    }
  }

  /** First Escape: cancel the edit in the focused field (the sheet stays). Otherwise the sheet closes. */
  function onEscapeKeyDown(event: globalThis.KeyboardEvent) {
    const active = document.activeElement;
    if (active === nameRef.current && nameEdit !== null) {
      event.preventDefault();
      setNameEdit(null);
    } else if (active === descriptionRef.current && descriptionEdit !== null) {
      event.preventDefault();
      setDescriptionEdit(null);
    }
  }

  function onDelete() {
    close(false);
    void actions.remove(taskId);
  }

  async function chooseMine() {
    const error = await guard.useMine();
    if (error) setChoiceError("Couldn't save your version — try again");
    else {
      setChoiceError(null);
      setNameEdit(null);
      setDescriptionEdit(null);
    }
  }

  function chooseTheirs() {
    guard.keepTheirs();
    setChoiceError(null);
    setNameEdit(null);
    setDescriptionEdit(null);
  }

  const nameOver = name.length > TASK_NAME_MAX;
  const descriptionOver = description.length > TASK_DESCRIPTION_MAX;
  const theirs = guard.conflict ? [guard.conflict.theirs.name, guard.conflict.theirs.description].filter((v) => v != null).join(' · ') : '';

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : close(true))}>
      <SheetContent
        side="right"
        data-task-detail
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={onEscapeKeyDown}
        className="inset-0 w-full max-w-none gap-3 overflow-y-auto border-l-0 md:inset-y-0 md:right-0 md:left-auto md:w-[28rem] md:max-w-[90vw] md:border-l"
      >
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="text-lg font-semibold">Task details</SheetTitle>
          <Button variant="ghost" aria-label="Close" className="min-h-[var(--min-touch-target)] min-w-[var(--min-touch-target)] px-0" onClick={() => close(true)}>
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        {guard.conflict ? <ConflictNotice theirs={theirs} onUseMine={() => void chooseMine()} onKeepTheirs={chooseTheirs} error={choiceError} /> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="task-detail-name" className="text-sm font-medium">
            Name
          </label>
          <input
            ref={nameRef}
            id="task-detail-name"
            value={name}
            onChange={(event) => setNameEdit(event.target.value)}
            onKeyDown={onNameKeyDown}
            onBlur={commitName}
            onFocus={guard.arm}
            aria-invalid={nameOver || undefined}
            aria-describedby="task-detail-name-count"
            autoComplete="off"
            className={cn(
              'min-h-[var(--min-touch-target)] rounded-md border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring',
              nameOver && 'border-destructive',
            )}
          />
          <LengthCounter id="task-detail-name-count" length={name.length} limit={TASK_NAME_MAX} />
          {hintVisible ? (
            <p role="status" className="text-sm text-muted-foreground">
              {NAME_EMPTY_TEXT}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="task-detail-description" className="text-sm font-medium">
            Description
          </label>
          <textarea
            ref={descriptionRef}
            id="task-detail-description"
            value={description}
            rows={6}
            onChange={(event) => setDescriptionEdit(event.target.value)}
            onBlur={commitDescription}
            onFocus={guard.arm}
            aria-invalid={descriptionOver || undefined}
            aria-describedby="task-detail-description-count"
            className={cn(
              'rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring',
              descriptionOver && 'border-destructive',
            )}
          />
          <LengthCounter id="task-detail-description-count" length={description.length} limit={TASK_DESCRIPTION_MAX} />
        </div>
        <div className="mt-auto flex justify-end pt-2">
          <Button variant="outline" className="min-h-[var(--min-touch-target)] text-destructive" onClick={onDelete}>
            <TrashIcon aria-hidden="true" />
            Delete task
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
