import { LENGTH_WARNING_RATIO, TASK_DESCRIPTION_MAX, TASK_NAME_MAX } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import { canSubmit, lengthStatus, warningThreshold } from '@/features/tasks/canSubmit';
import { counterText } from '@/features/tasks/LengthCounter';

const NAME_WARN = Math.ceil(TASK_NAME_MAX * LENGTH_WARNING_RATIO);
const DESC_WARN = Math.ceil(TASK_DESCRIPTION_MAX * LENGTH_WARNING_RATIO);

describe('TC-115 lengthStatus and canSubmit', () => {
  it('the thresholds are 450 and 4,500', () => {
    expect(warningThreshold(TASK_NAME_MAX)).toBe(450);
    expect(warningThreshold(TASK_DESCRIPTION_MAX)).toBe(4_500);
  });

  it('name: 449 normal, 450 near, 500 near, 501 over', () => {
    expect([NAME_WARN - 1, NAME_WARN, TASK_NAME_MAX, TASK_NAME_MAX + 1].map((n) => lengthStatus(n, TASK_NAME_MAX))).toEqual([
      'normal',
      'near',
      'near',
      'over',
    ]);
  });

  it('description: 4,499 normal, 4,500 near, 5,000 near, 5,001 over', () => {
    expect([DESC_WARN - 1, DESC_WARN, TASK_DESCRIPTION_MAX, TASK_DESCRIPTION_MAX + 1].map((n) => lengthStatus(n, TASK_DESCRIPTION_MAX))).toEqual([
      'normal',
      'near',
      'near',
      'over',
    ]);
  });

  it('canSubmit is false for a blank name, a 501-character name or a 5,001-character description', () => {
    expect(canSubmit('', '')).toBe(false);
    expect(canSubmit(' \t\n ', '')).toBe(false);
    expect(canSubmit('a'.repeat(TASK_NAME_MAX + 1), '')).toBe(false);
    expect(canSubmit('Buy milk', 'd'.repeat(TASK_DESCRIPTION_MAX + 1))).toBe(false);
  });

  it('canSubmit is true at the limits', () => {
    expect(canSubmit('x', '')).toBe(true);
    expect(canSubmit('a'.repeat(TASK_NAME_MAX), 'd'.repeat(TASK_DESCRIPTION_MAX))).toBe(true);
  });

  it('counts UTF-16 code units, like the server (an emoji is 2)', () => {
    expect(lengthStatus('📞'.repeat(250).length, TASK_NAME_MAX)).toBe('near');
    expect(canSubmit(`${'📞'.repeat(250)}a`, '')).toBe(false);
  });

  it('counter text: singular and plural, left and over', () => {
    expect(counterText(449, TASK_NAME_MAX)).toBe('');
    expect(counterText(450, TASK_NAME_MAX)).toBe('50 characters left');
    expect(counterText(499, TASK_NAME_MAX)).toBe('1 character left');
    expect(counterText(501, TASK_NAME_MAX)).toBe('1 character over');
    expect(counterText(600, TASK_NAME_MAX)).toBe('100 characters over');
  });
});
