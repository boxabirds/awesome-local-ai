import { useGlobalShortcut } from '@/lib/shortcuts';
import { openMovePicker } from './movePicker';
import { preloadMoveToPicker } from './moveToPickerLoader';

/** The key that opens Move to… for the focused task. */
export const MOVE_KEY = 'm';

/**
 * M on a focused task row opens Move to… for it (prd.move_shortcut). Through story 5's registry: never while
 * typing in a field, and declined (the key is left alone) when no saved task row has focus.
 */
export function useMoveShortcut(): void {
  useGlobalShortcut(
    MOVE_KEY,
    () => {
      const active = document.activeElement;
      const row = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-task-id][role="option"]') : null;
      if (!row || row.dataset.localStatus) return false;
      void preloadMoveToPicker();
      openMovePicker(row.dataset.taskId!, row);
      return true;
    },
    { description: 'Move task to…', group: 'Tasks' },
  );
}
