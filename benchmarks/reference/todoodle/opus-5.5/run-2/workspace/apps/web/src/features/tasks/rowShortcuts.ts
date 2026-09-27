/*
 * The task shortcuts (story 6), one static table: registered through story 5's shared registry
 * (useTaskShortcuts, useUndoShortcut), listed in the `?` panel, and shown as hints in the row's
 * "…" menu. Row shortcuts act on the focused task row only, never while typing in a field.
 */

export type RowShortcutAction = 'edit' | 'delete' | 'toggle';

export type RowShortcut = { key: string; description: string; action: RowShortcutAction };

export const ROW_SHORTCUTS: readonly RowShortcut[] = [
  { key: 'e', description: 'Edit task', action: 'edit' },
  { key: 'Delete', description: 'Delete task', action: 'delete' },
  { key: 'Backspace', description: 'Delete task', action: 'delete' },
  { key: ' ', description: 'Complete or reopen task', action: 'toggle' },
];

/** Cmd+Z on Mac, Ctrl+Z elsewhere: undo the most recent completion or deletion. */
export const UNDO_SHORTCUT = { key: 'z', description: 'Undo', modifiers: 'mod' } as const;

/** The hints shown next to the "…" menu items. */
export const MENU_HINTS = { edit: 'E', delete: 'Del' } as const;
