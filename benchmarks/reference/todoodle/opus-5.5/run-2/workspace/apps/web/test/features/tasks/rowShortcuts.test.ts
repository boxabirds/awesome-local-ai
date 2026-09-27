import { describe, expect, it } from 'vitest';
import { MENU_HINTS, ROW_SHORTCUTS, UNDO_SHORTCUT } from '@/features/tasks/rowShortcuts';

describe('TC-U16 row shortcut table', () => {
  it('registers e (edit), Delete and Backspace (delete), Space (complete) and mod+z (undo)', () => {
    const byKey = Object.fromEntries(ROW_SHORTCUTS.map((s) => [s.key, s]));
    expect(byKey.e).toMatchObject({ action: 'edit', description: 'Edit task' });
    expect(byKey.Delete).toMatchObject({ action: 'delete', description: 'Delete task' });
    expect(byKey.Backspace).toMatchObject({ action: 'delete', description: 'Delete task' });
    expect(byKey[' ']).toMatchObject({ action: 'toggle' });
    expect(byKey[' ']!.description).toMatch(/^Complete/);
    expect(UNDO_SHORTCUT).toEqual({ key: 'z', modifiers: 'mod', description: 'Undo' });
  });

  it('every description is non-empty (they are listed in the ? panel)', () => {
    for (const shortcut of [...ROW_SHORTCUTS, UNDO_SHORTCUT]) expect(shortcut.description.trim()).not.toBe('');
  });

  it('the menu hints match the keys', () => {
    expect(MENU_HINTS).toEqual({ edit: 'E', delete: 'Del' });
  });
});
