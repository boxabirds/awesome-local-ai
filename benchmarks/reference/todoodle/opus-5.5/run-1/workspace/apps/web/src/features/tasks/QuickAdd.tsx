import { TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { type KeyboardEvent, type RefObject, useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { newTaskId } from '@/lib/ids';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/utils';
import { canSubmit, lengthStatus } from './canSubmit';
import { DestinationChip, type QuickAddTarget } from './DestinationChip';
import { LengthCounter } from './LengthCounter';

export type NewTaskInput = { id: string; name: string; description: string; target: QuickAddTarget };

type Props = {
  target: QuickAddTarget;
  /** inline: in the list, under the last task. docked: a panel fixed above the on-screen keyboard (phones). */
  mode: 'inline' | 'docked';
  onCreate: (input: NewTaskInput) => void;
  /** Escape or Cancel: the typed text is discarded. The opener restores focus. */
  onClose: () => void;
  /** The name field, so the opener can focus it again (Q while quick add is already open). */
  nameRef: RefObject<HTMLInputElement | null>;
};

/** Enter that is part of an IME composition (e.g. choosing a Japanese candidate) is never a submit. */
function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Quick add: a name field (Enter adds), a description (Enter is a new line; ⌘/Ctrl+Enter adds), the
 * destination chip, and Add/Cancel. Nothing is ever truncated: there is no maxLength; over-long text
 * shows how far over it is and blocks Add. After adding, both fields clear and the name keeps focus.
 */
export function QuickAdd({ target, mode, onCreate, onClose, nameRef }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const ids = useId();
  const nameId = `${ids}-name`;
  const descriptionId = `${ids}-description`;
  const nameCounterId = `${ids}-name-counter`;
  const descriptionCounterId = `${ids}-description-counter`;
  const chipId = `${ids}-chip`;
  // Derived during render, never synced through an effect.
  const allowed = canSubmit(name, description);
  const nameOver = lengthStatus(name.length, TASK_NAME_MAX) === 'over';
  const descriptionOver = lengthStatus(description.length, TASK_DESCRIPTION_MAX) === 'over';

  useEffect(() => {
    nameRef.current?.focus();
  }, [nameRef]);
  // Docked: follow the on-screen keyboard.
  useKeyboardInset(mode === 'docked');

  const submit = () => {
    if (!allowed) return;
    onCreate({ id: newTaskId(), name: name.trim(), description: description.trim(), target });
    setName(() => '');
    setDescription(() => '');
    nameRef.current?.focus();
  };

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Enter' || isComposing(event)) return;
    const field = event.target as HTMLElement;
    const modified = event.metaKey || event.ctrlKey;
    if (field.id === nameId || (field.id === descriptionId && modified)) {
      event.preventDefault();
      submit();
    }
    // Plain Enter in the description is a new line (the default).
  };

  return (
    <form
      aria-label="Add task"
      aria-describedby={chipId}
      data-quick-add={mode}
      onKeyDown={onFormKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        'flex flex-col gap-2 border-border bg-background',
        mode === 'inline' ? 'rounded-md border p-3' : 'quick-add-docked fixed inset-x-0 z-40 border-t p-3 shadow-lg',
      )}
    >
      <label htmlFor={nameId} className="sr-only">
        Task name
      </label>
      <input
        id={nameId}
        ref={nameRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Task name"
        autoComplete="off"
        enterKeyHint="done"
        aria-invalid={nameOver || undefined}
        aria-describedby={nameOver ? nameCounterId : undefined}
        className="w-full bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
      />
      <LengthCounter id={nameCounterId} length={name.length} limit={TASK_NAME_MAX} />
      <label htmlFor={descriptionId} className="sr-only">
        Description
      </label>
      <textarea
        id={descriptionId}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Description"
        rows={1}
        aria-invalid={descriptionOver || undefined}
        aria-describedby={descriptionOver ? descriptionCounterId : undefined}
        className="quick-add-description w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <LengthCounter id={descriptionCounterId} length={description.length} limit={TASK_DESCRIPTION_MAX} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DestinationChip id={chipId} target={target} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!allowed}>
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}
