import { useGlobalShortcut } from '@/lib/shortcuts';
import { UNDO_SHORTCUT } from '@/features/tasks/rowShortcuts';
import { latestActiveUndo } from './undoStack';

/**
 * Cmd+Z (Mac) / Ctrl+Z: undoes the most recent visible undo toast. Registered once at shell level
 * through the shared registry. In a text field (native text undo) or with no toast showing it does
 * nothing and does not prevent the default.
 */
export function useUndoShortcut(): void {
  useGlobalShortcut(UNDO_SHORTCUT.key, () => void latestActiveUndo()?.undo(), {
    description: UNDO_SHORTCUT.description,
    group: 'Tasks',
    modifiers: 'mod',
    when: () => latestActiveUndo() !== undefined,
  });
}
