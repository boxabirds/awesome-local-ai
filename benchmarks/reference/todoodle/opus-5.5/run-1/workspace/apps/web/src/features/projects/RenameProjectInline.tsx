import { PROJECT_NAME_MAX } from '@todoodle/shared/limits';
import { type KeyboardEvent, useRef, useState } from 'react';
import { NameField } from '@/components/NameField';
import { nameFieldState } from '@/components/nameFieldState';

type Props = {
  name: string;
  /** A valid new name (trimmed). */
  onSave: (name: string) => void;
  /** Escape, or nothing changed. */
  onCancel: () => void;
  /** A blank name was refused: the previous name comes back and the caller shows "Name can't be empty". */
  onBlank: () => void;
};

/**
 * The project name edited in place of its row. Enter or blur saves; Escape cancels. A blank name is never
 * sent (onBlank). An over-long name is never cut: the counter shows how far over it is and saving waits
 * until it fits (the field stays open).
 */
export function RenameProjectInline({ name, onSave, onCancel, onBlank }: Props) {
  const [value, setValue] = useState(name);
  // Enter and the blur that follows the row closing must not both finish the edit.
  const done = useRef(false);

  const finish = (outcome: 'save' | 'cancel') => {
    if (done.current) return;
    if (outcome === 'cancel') {
      done.current = true;
      onCancel();
      return;
    }
    const { status } = nameFieldState(value, PROJECT_NAME_MAX);
    if (status === 'over') return;
    done.current = true;
    if (status === 'empty') onBlank();
    else if (value.trim() === name) onCancel();
    else onSave(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finish('save');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish('cancel');
    }
  };

  return (
    <NameField
      label="Project name"
      value={value}
      max={PROJECT_NAME_MAX}
      autoFocus
      onChange={setValue}
      onKeyDown={onKeyDown}
      onBlur={() => finish('save')}
      className="flex-1 py-1"
      inputClassName="px-2 text-sm"
    />
  );
}
