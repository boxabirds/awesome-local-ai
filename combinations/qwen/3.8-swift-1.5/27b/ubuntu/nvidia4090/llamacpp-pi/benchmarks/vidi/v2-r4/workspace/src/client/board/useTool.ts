import { useEffect, useState, useCallback } from 'react';

/**
 * Active tool state (story 9, text.tool_ui). Stories 10–12 extend the union.
 */
export type Tool = 'select' | 'text';

export interface UseToolOptions {
  canEdit: boolean;
  /** The id of the object currently in text editing mode (shortcut guard). */
  editingId?: string | null;
  /** N shortcut: create a sticky note at the view centre (story 2 behaviour). */
  onCreateStickyAtCentre?: () => void;
}

/**
 * Tool mode with V/T/N/Escape shortcuts (text.tool_ui).
 *
 * - V → select; T → text (only when canEdit); N → sticky at view centre;
 *   Escape → select.
 * - Shortcuts are ignored while editing text or when focus is in an input
 *   (TC-16: T while editing a note types 't').
 * - canEdit false → T ignored, an active Text tool reverts to Select.
 */
export function useTool(opts: UseToolOptions): { tool: Tool; setTool(t: Tool): void } {
  const { canEdit, editingId, onCreateStickyAtCentre } = opts;
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // canEdit false → an active Text tool reverts to Select (text.tool_ui)
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore while editing text (TC-16)
      if (editingId) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      // Only plain single keys (no modifiers) drive tool switching
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'v') {
        e.preventDefault();
        setToolState('select');
      } else if (key === 't') {
        if (!canEdit) return;
        e.preventDefault();
        setToolState('text');
      } else if (key === 'n') {
        if (!canEdit) return;
        e.preventDefault();
        onCreateStickyAtCentre?.();
      } else if (e.key === 'Escape') {
        setToolState('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, editingId, onCreateStickyAtCentre]);

  return { tool, setTool };
}
