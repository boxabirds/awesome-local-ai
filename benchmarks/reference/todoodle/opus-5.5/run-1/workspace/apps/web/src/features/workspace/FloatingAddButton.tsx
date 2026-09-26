import type { Ref } from 'react';
import { PlusIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

type Props = {
  onPress: () => void;
  /** Always shown in the phone layout; otherwise only on touch screens (CSS `hover: none`). */
  narrow: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/** The round '+' at the bottom-right on phones and touch screens. Opens quick add docked above the keyboard. */
export function FloatingAddButton({ onPress, narrow, ref }: Props) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Add task"
      data-add-task
      data-fab
      onClick={onPress}
      className={cn(
        'fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        narrow ? 'flex' : 'hidden touch:flex',
      )}
    >
      <PlusIcon aria-hidden="true" className="size-6" />
    </button>
  );
}
