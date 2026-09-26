import { describe, expect, it } from 'vitest';
import { ROW_SHORTCUTS } from '@/features/tasks/rowShortcuts';
import { displayKey } from '@/lib/shortcuts';

// Story 6, TC-U16: the row shortcut table the registry and the ? panel use.

describe('TC-U16 row shortcut table', () => {
  it('registers e Edit, Delete and Backspace Delete task, Space Complete, mod+z Undo', () => {
    expect(ROW_SHORTCUTS.map(({ key, description, modifiers }) => [key, description, modifiers ?? 'none'])).toEqual([
      ['e', 'Edit', 'none'],
      ['Delete', 'Delete task', 'none'],
      ['Backspace', 'Delete task', 'none'],
      [' ', 'Complete', 'none'],
      ['z', 'Undo', 'mod'],
    ]);
  });

  it('every description is non-empty (the ? panel lists them)', () => {
    for (const shortcut of ROW_SHORTCUTS) expect(shortcut.description.trim()).not.toBe('');
  });

  it('keys display readably in the panel', () => {
    expect(ROW_SHORTCUTS.map((shortcut) => displayKey(shortcut.key))).toEqual(['E', 'Del', 'Backspace', 'Space', 'Z']);
  });
});
