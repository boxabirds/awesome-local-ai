import { useState, useEffect, useCallback, useRef } from 'react';
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

function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export interface UseActiveToolResult {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
}

export interface UseActiveToolOptions {
  editable: boolean;
  onSelectId?(id: string): void;
}

export function useActiveTool(opts: UseActiveToolOptions): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const toolRef = useRef(tool);
  toolRef.current = tool;

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setTool = useCallback((t: ToolId) => {
    if ((t === 'shape' || t === 'connector') && !optsRef.current.editable) return;
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.onSelectId?.(id);
    setToolState('select');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditingText()) return;

      // Escape: return to select from shape/connector
      if (e.key === 'Escape') {
        const currentTool = toolRef.current;
        if (currentTool === 'shape' || currentTool === 'connector') {
          setToolState('select');
          return;
        }
        return;
      }

      // Single letter shortcuts (no modifiers)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const targetTool = TOOL_SHORTCUTS[key];
      if (targetTool) {
        if ((targetTool === 'shape' || targetTool === 'connector' || targetTool === 'pen' || targetTool === 'image') && !optsRef.current.editable) return;
        setToolState(targetTool);
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
