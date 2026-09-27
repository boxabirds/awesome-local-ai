import { lazyWithRetry } from '@/lib/lazyWithRetry';

/** Shown instead of the picker when its chunk can't load; the next open tries again. */
export const PICKER_LOAD_FAILED_TEXT = "Couldn't open the date picker — try again";

/**
 * The picker panel chunk (react-day-picker and date-fns load only here, on first open or on the trigger's hover and
 * focus). A failed import is forgotten, so the next open retries.
 */
export const pickerPanel = lazyWithRetry(() => import('./picker/DueDatePickerPanel'));

/** Preload on hover/focus: failures stay silent here (opening reports them). */
export function preloadDatePicker(): void {
  pickerPanel.load().catch(() => undefined);
}
