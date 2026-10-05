/**
 * Active tool hook (story 10). Manages the active tool state with shortcuts
 * and return-to-select behaviour. Extends story 9's tool system.
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

interface UseActiveToolOpts {
  canEdit: boolean;
  /** Select the given id (used by toolCreated). */
  onSelect: (id: string) => void;
}

export interface ActiveToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool: (t: ToolId) => void;
  setShapeKind: (k: ShapeKind) => void;
  /** Called after a tool creates an object: selects it and returns to Select. */
  toolCreated: (id: string) => void;
}

/**
 * Hook that manages the active tool state with keyboard shortcuts.
 * - Single-letter shortcuts switch tools (ignored while typing in an editor).
 * - Escape while Shape or Connector is active switches to Select.
 * - `toolCreated(id)` selects the new id and sets tool to 'select'.
 */
export function useActiveTool(opts: UseActiveToolOpts): ActiveToolState {
  const { canEdit, onSelect } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // When canEdit becomes false, revert to select
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    onSelect(id);
    setToolState('select');
  }, [onSelect]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Escape: return to select from shape/connector tools
      if (e.key === 'Escape') {
        if (tool === 'shape' || tool === 'connector') {
          setToolState('select');
          return;
        }
        return; // let useBoardKeys handle Escape for other tools
      }

      // Single-letter shortcuts
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return; // don't intercept modifier combos
      const targetTool = TOOL_SHORTCUTS[key];
      if (!targetTool) return;

      // Only allow tool shortcuts that are implemented
      if (targetTool === 'select' || targetTool === 'text' || targetTool === 'shape' || targetTool === 'connector') {
        if (targetTool === 'select') {
          setToolState('select');
        } else if (canEdit) {
          setToolState(targetTool);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
