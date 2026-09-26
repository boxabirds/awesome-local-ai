import type { ShortcutOptions } from '@/lib/shortcuts';

/** What a row shortcut does to the focused task. */
export type RowAction = 'edit' | 'delete' | 'toggle' | 'undo';

export type RowShortcut = {
  /** KeyboardEvent.key as the shortcut registry matches it. */
  key: string;
  action: RowAction;
  description: string;
  modifiers?: ShortcutOptions['modifiers'];
};

/**
 * The task-row keys (ui.task_actions), for the registry and the ? panel. Cmd/Ctrl+Z is registered once at
 * shell level (useUndoShortcut); it is listed here so the table documents every key story 6 adds.
 */
export const ROW_SHORTCUTS: readonly RowShortcut[] = [
  { key: 'e', action: 'edit', description: 'Edit' },
  { key: 'Delete', action: 'delete', description: 'Delete task' },
  { key: 'Backspace', action: 'delete', description: 'Delete task' },
  { key: ' ', action: 'toggle', description: 'Complete' },
  { key: 'z', action: 'undo', description: 'Undo', modifiers: 'mod' },
];
