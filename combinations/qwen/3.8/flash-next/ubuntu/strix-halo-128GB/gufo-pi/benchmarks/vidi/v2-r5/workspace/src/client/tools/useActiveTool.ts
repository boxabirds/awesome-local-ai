import { useCallback, useEffect, useRef, useState } from 'react';
import { type ShapeKind } from '../../shared/config';

/**
 * Active tool hook: manages the current tool selection, shape kind, and return-to-select logic.
 *
 * ToolId covers all tools across stories; stories 9–12 add their own tools.
 * Story 10 uses 'shape' and 'connector'.
 */
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
  /** Select the newly created item and switch back to Select. */
  toolCreated(id: string): void;
}

/** True when the event target is a text field (so shortcuts should not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export interface UseActiveToolOptions {
  canEdit: boolean;
  /** Called by toolCreated to select the new item. Provided by the parent. */
  onSelect?(id: string): void;
}

export function useActiveTool(opts: UseActiveToolOptions): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const onSelectRef = useRef(opts.onSelect);
  onSelectRef.current = opts.onSelect;

  const setTool = useCallback((t: ToolId): void => {
    // Tools other than select require edit permission
    if (t !== 'select' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind): void => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string): void => {
    if (onSelectRef.current) onSelectRef.current(id);
    setToolState('select');
  }, []);

  // Keyboard shortcuts for tool switching
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Don't fire shortcuts while typing
      if (isTypingTarget(event.target)) return;
      // Don't fire for Ctrl/Meta combinations (those are undo, etc.)
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();

      // Escape: return to Select
      if (event.key === 'Escape') {
        if (tool === 'shape' || tool === 'connector') {
          setToolState('select');
        }
        return;
      }

      const mappedTool = TOOL_SHORTCUTS[key];
      if (mappedTool) {
        // 'sticky' and 'text' are handled by useBoardKeys for backward compat
        // shape, connector, and select (V) are handled here
        if (mappedTool === 'select') {
          event.preventDefault();
          setToolState('select');
        } else if (mappedTool === 'shape' || mappedTool === 'connector') {
          if (canEditRef.current) {
            event.preventDefault();
            setToolState(mappedTool);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool]);

  // Revert to select when canEdit becomes false
  useEffect(() => {
    if (!opts.canEdit) {
      setToolState('select');
    }
  }, [opts.canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
