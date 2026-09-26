import { useGlobalShortcut } from '@/lib/shortcuts';
import { latestActiveUndo } from './undoStack';

/**
 * Cmd+Z (macOS) / Ctrl+Z: undoes the most recent action whose undo toast is still up. Registered once at
 * shell level through the shared registry, which never fires while the user types in a field (native text
 * undo stays). With no active toast the key is left alone (not prevented).
 */
export function useUndoShortcut(): void {
  useGlobalShortcut(
    'z',
    () => {
      const handle = latestActiveUndo();
      if (!handle) return false;
      void handle.undo();
      return true;
    },
    { description: 'Undo', group: 'Tasks', modifiers: 'mod' },
  );
}
