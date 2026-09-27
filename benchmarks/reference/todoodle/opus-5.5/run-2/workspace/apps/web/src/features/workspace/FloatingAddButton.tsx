import type { Ref } from 'react';
import { PlusIcon } from '@/components/icons';

/**
 * The round + button on phones and touch screens, bottom-right above the safe area. It opens
 * quick add docked above the on-screen keyboard, and hides while that is open.
 */
export function FloatingAddButton({ onPress, hidden, ref }: { onPress(button: HTMLButtonElement): void; hidden: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Add task"
      hidden={hidden}
      onClick={(event) => onPress(event.currentTarget)}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <PlusIcon aria-hidden="true" className="size-6" />
    </button>
  );
}
