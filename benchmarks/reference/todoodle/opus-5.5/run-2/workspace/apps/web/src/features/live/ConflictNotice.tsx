import type { MouseEvent, Ref } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CONFLICT_TEXT } from './showConflictToast';

// Buttons don't take focus on mousedown, so the field stays in edit mode (Safari would blur it).
const keepFieldFocus = (e: MouseEvent) => e.preventDefault();

/**
 * Inline notice while the editor is open and someone else's change replaced the user's edit.
 * Stays until the user chooses (or closes the editor, which counts as Keep theirs).
 */
export function ConflictNotice({
  theirs,
  onUseMine,
  onKeepTheirs,
  ref,
  className,
}: {
  theirs: string;
  onUseMine(): void;
  onKeepTheirs(): void;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn('mt-1 flex flex-col gap-2 rounded-md border border-border bg-warning-surface p-3 text-sm text-foreground', className)}
    >
      <p>{CONFLICT_TEXT}</p>
      <p>
        Their version: <strong className="font-semibold">{theirs}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onMouseDown={keepFieldFocus} onClick={onUseMine}>
          Use my version
        </Button>
        <Button type="button" size="sm" variant="secondary" onMouseDown={keepFieldFocus} onClick={onKeepTheirs}>
          Keep theirs
        </Button>
      </div>
    </div>
  );
}
