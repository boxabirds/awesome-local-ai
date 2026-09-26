import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';

/** Realistic task names (the design's fixture list). */
export const TASK_NAMES = {
  milk: 'Buy milk',
  invoice: 'Email Sam re: invoice #4411',
  mum: 'Call Mum 📞',
  dentist: 'Book dentist — ask about Tuesday',
} as const;

export const MULTI_LINE_DESCRIPTION = 'Ask about:\n- the Tuesday slot\n- whether they take the new insurance card\n\nBring the referral 📄';

/** Length-boundary strings, built from the shared constants so fixtures follow them. */
export const nameOf = (length: number) => 'n'.repeat(length);
export const descriptionOf = (length: number) => 'd'.repeat(length);

export const NAME_AT_LIMIT = nameOf(TASK_NAME_MAX);
export const NAME_OVER_LIMIT = nameOf(TASK_NAME_MAX + 1);
export const DESCRIPTION_AT_LIMIT = descriptionOf(TASK_DESCRIPTION_MAX);
export const DESCRIPTION_OVER_LIMIT = descriptionOf(TASK_DESCRIPTION_MAX + 1);
export const NAME_WARNING_AT = Math.ceil(TASK_NAME_MAX * LENGTH_WARNING_RATIO);

/** A fresh client-style task id: 16 random bytes as lowercase hex. */
export function newTaskId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
