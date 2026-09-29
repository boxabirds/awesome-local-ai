/**
 * Active tool hook (story 10, tools.active_tool).
 *
 * Provides tool state, shape kind, keyboard shortcuts (S, L, V, N, T, P, I, C, Escape),
 * and `toolCreated(id)` which selects the new id and switches back to Select.
 *
 * Replaces the narrower `useTool` from story 9 while maintaining backward compat:
 * the exported type `Tool` is widened to include all tools.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Maps single-letter keyboard shortcuts to tool ids. */
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
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Called after an object is created: selects it and switches to Select. */
  toolCreated(id: string): void;
}

/**
 * Manages the active tool and shape kind state.
 * Accepts `onSelect(id)` callback so it can drive the selection store externally.
 */
export function useActiveTool(opts?: {
  canEdit?: boolean;
  onSelect?(id: string): void;
}): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const canEdit = opts?.canEdit ?? true;
  const onSelectRef = useRef(opts?.onSelect);
  onSelectRef.current = opts?.onSelect;

  // If canEdit becomes false, revert to select
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: ToolId) => {
    if (t !== 'select' && !canEdit) return;
    setToolState(t);
  }, [canEdit]);

  const setShapeKind = useCallback((k: ShapeKind) => {
    if ((SHAPE_KINDS as readonly string[]).includes(k)) {
      setShapeKindState(k);
    }
  }, []);

  const toolCreated = useCallback((id: string) => {
    onSelectRef.current?.(id);
    setToolState('select');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs/textareas/contenteditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const lower = e.key.toLowerCase();
      const mapped = TOOL_SHORTCUTS[lower];
      if (mapped) {
        // Only set tools we support
        if (mapped === 'shape' || mapped === 'connector' || mapped === 'select' || mapped === 'text' || mapped === 'sticky' || mapped === 'pen') {
          setTool(mapped);
        }
        return;
      }

      if (e.key === 'Escape') {
        // Escape from Shape or Connector returns to Select
        setToolState('select');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
