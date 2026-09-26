import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import { canSubmit, lengthStatus, warningThreshold } from '@/features/tasks/canSubmit';
import { counterText } from '@/features/tasks/LengthCounter';

const NAME_WARN = Math.ceil(TASK_NAME_MAX * LENGTH_WARNING_RATIO);
const DESCRIPTION_WARN = Math.ceil(TASK_DESCRIPTION_MAX * LENGTH_WARNING_RATIO);

describe('TC-115 lengthStatus and canSubmit boundaries', () => {
  it('the thresholds are 90% of each limit (450 and 4,500)', () => {
    expect(warningThreshold(TASK_NAME_MAX)).toBe(NAME_WARN);
    expect(NAME_WARN).toBe(450);
    expect(warningThreshold(TASK_DESCRIPTION_MAX)).toBe(DESCRIPTION_WARN);
    expect(DESCRIPTION_WARN).toBe(4_500);
  });

  it.each([
    [NAME_WARN - 1, 'normal'],
    [NAME_WARN, 'near'],
    [TASK_NAME_MAX, 'near'],
    [TASK_NAME_MAX + 1, 'over'],
  ] as const)('name %i is %s', (length, status) => {
    expect(lengthStatus(length, TASK_NAME_MAX)).toBe(status);
  });

  it.each([
    [DESCRIPTION_WARN - 1, 'normal'],
    [DESCRIPTION_WARN, 'near'],
    [TASK_DESCRIPTION_MAX, 'near'],
    [TASK_DESCRIPTION_MAX + 1, 'over'],
  ] as const)('description %i is %s', (length, status) => {
    expect(lengthStatus(length, TASK_DESCRIPTION_MAX)).toBe(status);
  });

  it('canSubmit is false for a blank name, a 501-char name, or a 5,001-char description', () => {
    expect(canSubmit('', '')).toBe(false);
    expect(canSubmit('   \t ', '')).toBe(false);
    expect(canSubmit('n'.repeat(TASK_NAME_MAX + 1), '')).toBe(false);
    expect(canSubmit('Buy milk', 'd'.repeat(TASK_DESCRIPTION_MAX + 1))).toBe(false);
  });

  it('canSubmit is true at both limits exactly', () => {
    expect(canSubmit('x', '')).toBe(true);
    expect(canSubmit('n'.repeat(TASK_NAME_MAX), 'd'.repeat(TASK_DESCRIPTION_MAX))).toBe(true);
  });

  it('lengths are UTF-16 code units: 250 emoji fill a 500 limit, one more char is over', () => {
    const emoji = '📞'.repeat(TASK_NAME_MAX / 2);
    expect(canSubmit(emoji, '')).toBe(true);
    expect(canSubmit(`${emoji}x`, '')).toBe(false);
  });

  it('counter text: hidden below the threshold, "N characters left" near, "N characters over" past it', () => {
    expect(counterText(NAME_WARN - 1, TASK_NAME_MAX)).toBe('');
    expect(counterText(NAME_WARN, TASK_NAME_MAX)).toBe('50 characters left');
    expect(counterText(TASK_NAME_MAX - 1, TASK_NAME_MAX)).toBe('1 character left');
    expect(counterText(TASK_NAME_MAX + 1, TASK_NAME_MAX)).toBe('1 character over');
    expect(counterText(600, TASK_NAME_MAX)).toBe('100 characters over');
  });
});
