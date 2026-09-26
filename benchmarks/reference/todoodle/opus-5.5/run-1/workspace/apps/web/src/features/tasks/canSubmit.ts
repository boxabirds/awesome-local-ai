import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';

export type LengthStatus = 'normal' | 'near' | 'over';

/** The length at which a field's counter appears: 90% of its limit, rounded up (450 / 4,500). */
export function warningThreshold(limit: number): number {
  return Math.ceil(limit * LENGTH_WARNING_RATIO);
}

/**
 * Where a field's length stands against its limit. Lengths are String.length (UTF-16 code units), the
 * same measure the server's schema uses, so an emoji counts as 2.
 */
export function lengthStatus(length: number, limit: number): LengthStatus {
  if (length > limit) return 'over';
  if (length >= warningThreshold(limit)) return 'near';
  return 'normal';
}

/** Add is allowed only for a non-blank name with neither field over its limit. Pure: derived during render. */
export function canSubmit(name: string, description: string): boolean {
  return (
    name.trim().length > 0 &&
    lengthStatus(name.length, TASK_NAME_MAX) !== 'over' &&
    lengthStatus(description.length, TASK_DESCRIPTION_MAX) !== 'over'
  );
}
