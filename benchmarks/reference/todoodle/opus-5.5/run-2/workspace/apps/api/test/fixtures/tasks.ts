import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';

/** Realistic task names. */
export const TASK_NAMES = {
  milk: 'Buy milk',
  invoice: 'Email Sam re: invoice #4411',
  mum: 'Call Mum 📞',
  dentist: 'Book dentist — ask about Tuesday',
} as const;

export const MULTILINE_DESCRIPTION = 'Semi-skimmed, 2 pints\nAlso: bread?\n\n- check the date';

/** Length-boundary strings, built from the shared limits so fixtures follow the constants. */
export const nameOfLength = (n: number) => 'a'.repeat(n);
export const descriptionOfLength = (n: number) => 'd'.repeat(n);
export const NAME_AT_LIMIT = nameOfLength(TASK_NAME_MAX);
export const NAME_OVER_LIMIT = nameOfLength(TASK_NAME_MAX + 1);
export const DESCRIPTION_AT_LIMIT = descriptionOfLength(TASK_DESCRIPTION_MAX);
export const DESCRIPTION_OVER_LIMIT = descriptionOfLength(TASK_DESCRIPTION_MAX + 1);
export const NAME_WARNING_AT = Math.ceil(TASK_NAME_MAX * LENGTH_WARNING_RATIO);
export const DESCRIPTION_WARNING_AT = Math.ceil(TASK_DESCRIPTION_MAX * LENGTH_WARNING_RATIO);

/** A fresh client-style task id (16 random bytes as lowercase hex). */
export function newTaskId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
