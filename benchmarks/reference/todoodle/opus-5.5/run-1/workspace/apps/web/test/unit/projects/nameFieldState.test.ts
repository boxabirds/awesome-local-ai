import { PROJECT_NAME_MAX } from '@todoodle/shared/limits';
import { describe, expect, it } from 'vitest';
import { canSaveName, nameFieldState } from '@/components/nameFieldState';

// Story 7, TC-90: name-field display states at the boundaries (untrimmed length L, max 120, threshold 108).

const of = (length: number) => 'n'.repeat(length);

describe('TC-90 nameFieldState', () => {
  it.each([
    ['L = 0', '', 'empty', 120],
    ['spaces only', '   ', 'empty', 117],
    ['1', of(1), 'ok', 119],
    ['107', of(107), 'ok', 13],
    ['108', of(108), 'near', 12],
    ['120', of(120), 'near', 0],
    ['121', of(121), 'over', -1],
  ])('%s -> %s', (_label, value, status, remaining) => {
    expect(nameFieldState(value, PROJECT_NAME_MAX)).toEqual({ status, remaining });
  });

  it('only ok and near names can be saved; nothing is ever shortened', () => {
    expect(canSaveName(of(1), PROJECT_NAME_MAX)).toBe(true);
    expect(canSaveName(of(120), PROJECT_NAME_MAX)).toBe(true);
    expect(canSaveName('   ', PROJECT_NAME_MAX)).toBe(false);
    expect(canSaveName(of(130), PROJECT_NAME_MAX)).toBe(false);
  });
});
