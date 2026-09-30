/**
 * Story 10: active tool hook with shortcuts and return-to-Select.
 *
 * - ToolId union covering all tools (stories 7-12).
 * - TOOL_SHORTCUTS maps single letters to tools.
 * - useActiveTool: manages active tool state, shapeKind, keyboard shortcuts,
 *   and the toolCreated callback (select + switch to Select).
 */
import { useState, useCallback, useEffect } from 'react';
import type { ShapeKind } from '@shared/config';

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

export interface ActiveToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool: (t: ToolId) => void;
  setShapeKind: (k: ShapeKind) => void;
  toolCreated: (id: string) => void;
}

interface UseActiveToolOptions {
  onSelect: (id: string) => void;
  canEdit: boolean;
}

export function useActiveTool({ onSelect, canEdit }: UseActiveToolOptions): ActiveToolState {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const setTool = useCallback((t: ToolId) => {
    if (t !== 'select' && !canEdit) return;
    setToolState(t);
  }, [canEdit]);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    onSelect(id);
    setToolState('select');
  }, [onSelect]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an editor or input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;

      // Escape: return to Select
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }

      // Single-letter shortcuts
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const shortcut = TOOL_SHORTCUTS[key];
      if (shortcut) {
        if (shortcut !== 'select' && !canEdit) return;
        setToolState(shortcut);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]);

  // Revert to select when editing becomes disallowed
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
