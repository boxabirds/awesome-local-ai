import { describe, expect, it } from 'vitest';
import { formatConnectionStatusLabel } from '../../src/client/board/connectBoard.js';

describe('formatConnectionStatusLabel', () => {
  it('maps each status to its badge label', () => {
    expect(formatConnectionStatusLabel('connecting')).toBe('Connecting…');
    expect(formatConnectionStatusLabel('online')).toBe('Connected');
    expect(formatConnectionStatusLabel('offline')).toBe('Offline');
  });

  it('the connecting label is not a substring-collision for "Connected"', () => {
    expect(formatConnectionStatusLabel('connecting')).not.toContain('Connected');
  });
});
