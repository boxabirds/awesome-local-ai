import { LENGTH_WARNING_RATIO } from '@todoodle/shared/limits';

export type NameFieldStatus = 'empty' | 'ok' | 'near' | 'over';

/**
 * Where a name field stands (projects.ui_accessible_controls). Lengths are the untrimmed String.length (UTF-16
 * code units, the server's measure). empty: nothing but spaces; near: at least LENGTH_WARNING_RATIO of `max`
 * (108 of 120), the counter shows; over: past `max`, nothing is cut and saving is blocked. `remaining` is
 * `max - length` (negative when over). Pure: derived during render.
 */
export function nameFieldState(value: string, max: number): { status: NameFieldStatus; remaining: number } {
  const remaining = max - value.length;
  if (value.trim() === '') return { status: 'empty', remaining };
  if (value.length > max) return { status: 'over', remaining };
  if (value.length >= Math.ceil(LENGTH_WARNING_RATIO * max)) return { status: 'near', remaining };
  return { status: 'ok', remaining };
}

/** Whether a name in this state may be saved (Add / Save enabled). */
export function canSaveName(value: string, max: number): boolean {
  const { status } = nameFieldState(value, max);
  return status === 'ok' || status === 'near';
}
