import { useGlobalShortcut } from '@/lib/shortcuts';
import { ROW_SHORTCUTS, type RowAction } from './rowShortcuts';

export type RowShortcutHandlers = Record<Exclude<RowAction, 'undo'>, (taskId: string, row: HTMLElement) => void>;

/**
 * The task row under keyboard focus, resolved inside the event (so focus changes never re-render rows).
 * Space only counts on the row itself: on the row's own checkbox or menu button it keeps its native meaning.
 */
function focusedRow(action: Exclude<RowAction, 'undo'>): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const row = active.closest<HTMLElement>('[data-task-id][role="option"]');
  if (!row || row.dataset.localStatus) return null;
  if (action === 'toggle' && active !== row) return null;
  return row;
}

function entry(key: string) {
  return ROW_SHORTCUTS.find((shortcut) => shortcut.key === key)!;
}

const EDIT = entry('e');
const DELETE = entry('Delete');
const BACKSPACE = entry('Backspace');
const SPACE = entry(' ');

/**
 * Registers E (edit), Delete/Backspace (delete, with Undo) and Space (complete or reopen) once per list,
 * through story 5's shared registry: never while typing in a field, and only when a task row has focus
 * (otherwise the key is left alone).
 */
export function useTaskShortcuts(handlers: RowShortcutHandlers): void {
  const run = (action: Exclude<RowAction, 'undo'>) => () => {
    const row = focusedRow(action);
    if (!row) return false;
    handlers[action](row.dataset.taskId!, row);
    return true;
  };
  useGlobalShortcut(EDIT.key, run('edit'), { description: EDIT.description, group: 'Tasks' });
  useGlobalShortcut(DELETE.key, run('delete'), { description: DELETE.description, group: 'Tasks' });
  useGlobalShortcut(BACKSPACE.key, run('delete'), { description: BACKSPACE.description, group: 'Tasks' });
  useGlobalShortcut(SPACE.key, run('toggle'), { description: SPACE.description, group: 'Tasks' });
}
