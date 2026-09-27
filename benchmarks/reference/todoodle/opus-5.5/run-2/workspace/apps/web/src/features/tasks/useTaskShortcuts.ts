import { useGlobalShortcut } from '@/lib/shortcuts';
import { ROW_SHORTCUTS, type RowShortcutAction } from './rowShortcuts';

/** The task row that has keyboard focus itself (not one of its controls), read at key time. */
export function focusedRowId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return active.matches('[data-task-id]') ? (active.dataset.taskId ?? null) : null;
}

const onRow = () => focusedRowId() !== null;

export type TaskShortcutHandlers = Record<RowShortcutAction, (taskId: string, row: HTMLElement) => void>;

function useRowShortcut(index: number, handlers: TaskShortcutHandlers, enabled: boolean) {
  const shortcut = ROW_SHORTCUTS[index]!;
  useGlobalShortcut(
    shortcut.key,
    () => {
      const row = document.activeElement as HTMLElement;
      const id = focusedRowId();
      if (id) handlers[shortcut.action](id, row);
    },
    { description: shortcut.description, group: 'Tasks', enabled, when: onRow },
  );
}

/**
 * Registers the row shortcuts (E edit, Delete/Backspace delete, Space complete or reopen) once per
 * list through the shared registry. The focused row is resolved inside the key event, so moving
 * focus never re-renders rows. Keys typed in a field are never taken (the registry's
 * isTypingTarget), and with no row focused the key keeps its default.
 */
export function useTaskShortcuts(handlers: TaskShortcutHandlers, enabled = true): void {
  // One hook call per table entry (the table is static, so the call order never changes).
  useRowShortcut(0, handlers, enabled);
  useRowShortcut(1, handlers, enabled);
  useRowShortcut(2, handlers, enabled);
  useRowShortcut(3, handlers, enabled);
}
