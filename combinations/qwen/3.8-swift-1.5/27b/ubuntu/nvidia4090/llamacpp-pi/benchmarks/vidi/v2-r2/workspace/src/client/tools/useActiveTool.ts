/**
 * Active tool hook (story 10, tools.active_tool).
 *
 * Manages the active tool id, shape kind, keyboard shortcuts (S, L, V, Escape)
 * and the return-to-Select behaviour after creation.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Called after a shape/connector is created: selects the id and switches to Select. */
  toolCreated(id: string): void;
}

export function useActiveTool(opts: {
  onToolCreated?: (id: string) => void;
  canEdit?: boolean;
}): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const { onToolCreated, canEdit = true } = opts;

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const toolCreated = useCallback((id: string) => {
    setToolState('select');
    onToolCreated?.(id);
  }, [onToolCreated]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Never hijack keys while editing text
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      // Escape: return to Select
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }

      // Single-letter shortcuts (no modifiers)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const mapped = TOOL_SHORTCUTS[k];
        if (mapped) {
          // Only allow tools that require editing when the board is editable
          if (!canEdit && mapped !== 'select') return;
          setToolState(mapped);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]);

  // Revert to Select when the board becomes non-editable
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
