// src/client/tools/useActiveTool.ts
// Active tool state management with shortcuts and return-to-Select.
// Extends story 9's useTool to add shape and connector tools.

import { useState, useCallback, useEffect } from 'react';
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

export interface UseActiveToolResult {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool: (t: ToolId) => void;
  setShapeKind: (k: ShapeKind) => void;
  toolCreated: (id: string) => void;
}

/**
 * Hook that manages the active tool state.
 * - Single-letter shortcuts map to tools (ignored while typing in editor/input)
 * - Escape returns to Select (from any tool)
 * - toolCreated(id) switches to Select (return-to-select after creating)
 */
export function useActiveTool(opts?: {
  onCreated?: (id: string) => void;
}): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const toolCreated = useCallback((id: string) => {
    setToolState('select');
    opts?.onCreated?.(id);
  }, [opts?.onCreated]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle keys when focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Escape returns to select
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }

      // Single-letter shortcuts (no modifier keys)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const mapped = TOOL_SHORTCUTS[key];
      if (mapped) {
        e.preventDefault();
        setToolState(mapped);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
