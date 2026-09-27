import { useGlobalShortcut } from '@/lib/shortcuts';
import { preloadDatePicker } from './dueDatePickerLoader';
import { openRowDatePicker } from './rowDatePicker';

/** The key that opens the date picker for the selected task. */
export const DATE_KEY = 'd';

/**
 * D on the selected (focused) task row opens its date picker, anchored to the row's chip slot
 * (prd.date_shortcut_key). Through story 5's registry: never while typing in a field (D is typed), and declined
 * (nothing happens) when no saved task row is selected. Mounted once in the workspace shell.
 */
export function useDateShortcut(): void {
  useGlobalShortcut(
    DATE_KEY,
    () => {
      const active = document.activeElement;
      const row = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-task-id][role="option"]') : null;
      if (!row || row.dataset.localStatus) return false;
      preloadDatePicker();
      openRowDatePicker(row.dataset.taskId!, row);
      return true;
    },
    { description: 'Set due date', group: 'Tasks' },
  );
}
