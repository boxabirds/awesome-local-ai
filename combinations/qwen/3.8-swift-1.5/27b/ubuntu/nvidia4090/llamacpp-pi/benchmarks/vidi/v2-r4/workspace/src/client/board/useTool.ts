import { useEffect, useState, useCallback } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/**
 * Active tool state (story 9, text.tool_ui; extended in story 10).
 */
export type Tool = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

export const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

export interface UseToolOptions {
  canEdit: boolean;
  /** The id of the object currently in text editing mode (shortcut guard). */
  editingId?: string | null;
  /** N shortcut: create a sticky note at the view centre (story 2 behaviour). */
  onCreateStickyAtCentre?: () => void;
  /** Called when a tool creates an object: selects it and switches to Select. */
  onToolCreated?: (id: string) => void;
}

export interface UseToolResult {
  tool: Tool;
  shapeKind: ShapeKind;
  setTool(t: Tool): void;
  setShapeKind(k: ShapeKind): void;
  /** Selects the new id and switches to Select (tools.return_to_select). */
  toolCreated(id: string): void;
}

/**
 * Tool mode with V/T/N/S/L/Escape shortcuts (story 9 + story 10).
 *
 * - V → select; T → text; N → sticky at view centre;
 *   S → shape; L → connector; Escape → select.
 * - Shortcuts are ignored while editing text or when focus is in an input.
 * - canEdit false → active tools revert to Select.
 */
export function useTool(opts: UseToolOptions): UseToolResult {
  const { canEdit, editingId, onCreateStickyAtCentre, onToolCreated } = opts;
  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    onToolCreated?.(id);
    setToolState('select');
  }, [onToolCreated]);

  // canEdit false → active tools revert to Select
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore while editing text
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

      if (key === 'escape') {
        setToolState('select');
        return;
      }

      const shortcut = TOOL_SHORTCUTS[key];
      if (!shortcut) return;

      // 'sticky' is handled via onCreateStickyAtCentre (creates immediately)
      if (shortcut === 'sticky') {
        if (!canEdit) return;
        e.preventDefault();
        onCreateStickyAtCentre?.();
        return;
      }

      // Other tools require canEdit
      if (!canEdit) return;

      e.preventDefault();
      setToolState(shortcut);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, editingId, onCreateStickyAtCentre]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
