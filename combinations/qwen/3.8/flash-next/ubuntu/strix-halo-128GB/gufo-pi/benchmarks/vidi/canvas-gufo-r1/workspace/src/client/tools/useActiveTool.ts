import { useCallback, useEffect, useRef, useState } from 'react';
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
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
}

function isEditingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export interface UseActiveToolOptions {
  onSelect?(id: string): void;
  canEdit?: boolean;
}

/**
 * Manages active tool state with keyboard shortcuts.
 * Escape from Shape or Connector returns to Select without creating.
 */
export function useActiveTool(opts: UseActiveToolOptions = {}): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const onSelectRef = useRef(opts.onSelect);
  onSelectRef.current = opts.onSelect;
  const canEditRef = useRef(opts.canEdit ?? true);
  canEditRef.current = opts.canEdit ?? true;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    onSelectRef.current?.(id);
    setToolState('select');
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditingContext(e.target)) return;

      // Escape: return to Select from shape, connector, or pen
      if (e.key === 'Escape') {
        const current = toolRef.current;
        if (current === 'shape' || current === 'connector' || current === 'pen') {
          setToolState('select');
        }
        return;
      }

      // Handle shape, connector, pen and select (v) shortcuts
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'v') {
        setToolState('select');
      } else if (key === 's' || key === 'l' || key === 'p') {
        const targetTool = TOOL_SHORTCUTS[key];
        if (targetTool && canEditRef.current) {
          setToolState(targetTool);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
