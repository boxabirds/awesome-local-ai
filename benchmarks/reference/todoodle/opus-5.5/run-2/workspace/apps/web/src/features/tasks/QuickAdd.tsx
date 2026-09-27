import { QUICK_ADD_MAX_DESCRIPTION_ROWS, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { type KeyboardEvent, type Ref, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { newTaskId } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { canSubmit, lengthStatus } from './canSubmit';
import { DestinationChip, type QuickAddTarget } from './DestinationChip';
import { LengthCounter } from './LengthCounter';

export type NewTaskInput = { id: string; name: string; description: string; target: QuickAddTarget };

export type QuickAddHandle = { focusName(): void };

const DESCRIPTION_STYLE = { maxHeight: `calc(${QUICK_ADD_MAX_DESCRIPTION_ROWS}lh + 1rem)` };

/** Visible lines of the description: grows with its text up to QUICK_ADD_MAX_DESCRIPTION_ROWS. */
function descriptionRows(text: string): number {
  return Math.min(QUICK_ADD_MAX_DESCRIPTION_ROWS, text.split('\n').length);
}

function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

const fieldClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-destructive';

/**
 * Quick add: name, optional description, where the task will land, Add and Cancel. Enter in the
 * name adds; Enter in the description is a new line; ⌘/Ctrl+Enter adds from either; Escape
 * closes. After adding, both fields clear and the name keeps focus, ready for the next task.
 * Nothing typed is ever truncated: past a limit the counter says how far over and Add is disabled.
 */
export function QuickAdd({
  target,
  mode,
  onCreate,
  onClose,
  ref,
}: {
  target: QuickAddTarget;
  mode: 'inline' | 'docked';
  onCreate(input: NewTaskInput): void;
  /** Escape or Cancel: closes without creating; the typed text is discarded. */
  onClose(): void;
  ref?: Ref<QuickAddHandle>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const chipId = `${baseId}-chip`;
  const nameCounterId = `${baseId}-name-count`;
  const descriptionCounterId = `${baseId}-description-count`;

  useImperativeHandle(ref, () => ({ focusName: () => nameRef.current?.focus() }), []);
  useLayoutEffect(() => nameRef.current?.focus(), []);

  const nameStatus = lengthStatus(name.length, TASK_NAME_MAX);
  const descriptionStatus = lengthStatus(description.length, TASK_DESCRIPTION_MAX);
  const allowed = canSubmit(name, description);

  function submit() {
    if (!canSubmit(name, description)) return;
    onCreate({ id: newTaskId(), name: name.trim(), description: description.trim(), target });
    setName('');
    setDescription('');
    nameRef.current?.focus();
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, field: 'name' | 'description') {
    if (event.key !== 'Enter' || isComposing(event)) return;
    const modifier = event.metaKey || event.ctrlKey;
    // Plain Enter in the description is a new line.
    if (field === 'description' && !modifier) return;
    event.preventDefault();
    submit();
  }

  return (
    <form
      aria-label="Add task"
      aria-describedby={chipId}
      noValidate
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-background p-3',
        mode === 'docked' && 'fixed inset-x-0 z-30 rounded-b-none border-x-0 border-b-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg',
      )}
      style={mode === 'docked' ? { bottom: 'var(--kb-inset, 0px)' } : undefined}
      data-mode={mode}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isComposing(event)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label htmlFor={`${baseId}-name`} className="sr-only">
        Task name
      </label>
      <input
        id={`${baseId}-name`}
        ref={nameRef}
        type="text"
        autoComplete="off"
        placeholder="Task name"
        className={fieldClass}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => onFieldKeyDown(event, 'name')}
        aria-invalid={nameStatus === 'over' ? true : undefined}
        aria-describedby={nameStatus === 'normal' ? undefined : nameCounterId}
      />
      <LengthCounter id={nameCounterId} length={name.length} limit={TASK_NAME_MAX} />
      <label htmlFor={`${baseId}-description`} className="sr-only">
        Description
      </label>
      <textarea
        id={`${baseId}-description`}
        placeholder="Description"
        rows={descriptionRows(description)}
        style={DESCRIPTION_STYLE}
        className={cn(fieldClass, 'resize-none text-sm [field-sizing:content]')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => onFieldKeyDown(event, 'description')}
        aria-invalid={descriptionStatus === 'over' ? true : undefined}
        aria-describedby={descriptionStatus === 'normal' ? undefined : descriptionCounterId}
      />
      <LengthCounter id={descriptionCounterId} length={description.length} limit={TASK_DESCRIPTION_MAX} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DestinationChip id={chipId} target={target} />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!allowed}>
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}
