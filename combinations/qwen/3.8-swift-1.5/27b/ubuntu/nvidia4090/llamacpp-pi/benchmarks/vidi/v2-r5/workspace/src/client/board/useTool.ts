// src/client/board/useTool.ts
// Active tool state: select | text, with V/T/N/Escape shortcuts.

import { useState, useCallback, useEffect } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool: (t: Tool) => void;
}

/**
 * Hook that manages the active tool state.
 * - V key → select
 * - T key → text (only if canEdit)
 * - Escape → select
 * - N key → (handled by useBoardKeys, not here)
 *
 * Shortcuts are ignored while editing text or focus is in inputs.
 * When canEdit becomes false, an active Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  // When canEdit becomes false, revert to select
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEdit) return;
    setToolState(t);
  }, [canEdit]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle keys when focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'v') {
        e.preventDefault();
        setToolState('select');
      } else if (key === 't' && canEdit) {
        e.preventDefault();
        setToolState('text');
      } else if (e.key === 'Escape') {
        // Escape returns to select (but don't prevent default so
        // the editor can also handle it)
        setToolState('select');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]);

  return { tool, setTool };
}
