/**
 * useActiveTool (story 10): active tool state, shortcuts, shape kind, return-to-select.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface UseActiveToolOpts {
  canEdit: boolean;
  /** Called by toolCreated to select the newly created object id. */
  onSelect(id: string): void;
}

export function useActiveTool(opts: UseActiveToolOpts): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setTool = useCallback((t: ToolId) => {
    // Only editing tools require canEdit
    if (t !== 'select' && !optsRef.current.canEdit) return;
    setToolState(t);
  }, []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.onSelect(id);
    setToolState('select');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in text fields
      if (isTextEntry(e.target)) return;

      // Escape: switch to select
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }

      // Single-letter shortcuts (no modifiers)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const mapped = TOOL_SHORTCUTS[key];
      if (!mapped) return;

      // Sticky 'n' is handled by useBoardKeys for backward compat; skip here
      if (key === 'n') return;

      // Only editing tools require canEdit
      if (mapped !== 'select' && !optsRef.current.canEdit) return;

      setToolState(mapped);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
