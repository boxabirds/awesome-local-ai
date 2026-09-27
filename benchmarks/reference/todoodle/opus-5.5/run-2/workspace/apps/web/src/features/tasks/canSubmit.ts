import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';

export type LengthStatus = 'normal' | 'near' | 'over';

/** Where the counter appears: ceil(limit * LENGTH_WARNING_RATIO) (450 for names, 4,500 for descriptions). */
export function warningThreshold(limit: number): number {
  return Math.ceil(limit * LENGTH_WARNING_RATIO);
}

/** Length is String.length (UTF-16 code units), the same measure as the server's check. */
export function lengthStatus(length: number, limit: number): LengthStatus {
  if (length > limit) return 'over';
  return length >= warningThreshold(limit) ? 'near' : 'normal';
}

/** Adding is allowed only with a non-blank name and neither field over its limit. Nothing is ever truncated. */
export function canSubmit(name: string, description: string): boolean {
  return (
    name.trim().length > 0 &&
    lengthStatus(name.length, TASK_NAME_MAX) !== 'over' &&
    lengthStatus(description.length, TASK_DESCRIPTION_MAX) !== 'over'
  );
}
