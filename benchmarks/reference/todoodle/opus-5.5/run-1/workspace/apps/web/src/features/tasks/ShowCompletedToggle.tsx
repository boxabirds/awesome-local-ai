import { useState } from 'react';
import { cn } from '@/lib/utils';
import { browserStorage, readShowCompleted, writeShowCompleted } from './showCompletedPref';

/**
 * The remembered 'Show completed' state of one list. Read once, lazily, on mount (rerender-lazy-state-init);
 * written in the event handler, not an effect (rerender-move-effect-to-event).
 */
export function useShowCompleted(workspaceId: string, listKey: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readShowCompleted(browserStorage(), workspaceId, listKey));
  const set = (next: boolean) => {
    setOn(next);
    writeShowCompleted(browserStorage(), workspaceId, listKey, next);
  };
  return [on, set];
}

type Props = { on: boolean; onChange: (on: boolean) => void };

/** 'Show completed' switch at the top of a list. */
export function ShowCompletedToggle({ on, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-[var(--min-touch-target)] items-center gap-2 self-end rounded-md px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors', on ? 'bg-primary' : 'bg-border')}
      >
        <span className={cn('size-4 rounded-full bg-background shadow transition-transform', on ? 'translate-x-4' : 'translate-x-0')} />
      </span>
      Show completed
    </button>
  );
}
