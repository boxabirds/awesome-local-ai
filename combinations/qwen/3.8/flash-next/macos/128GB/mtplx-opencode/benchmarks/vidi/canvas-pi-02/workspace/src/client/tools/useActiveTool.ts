/**
 * Active tool hook (story 10).
 *
 * Manages the active tool state and shape-kind selection. Provides keyboard
 * shortcuts for tool switching and the return-to-Select-after-create convention.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import type { ShapeKind } from '../../shared/config';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter keyboard shortcuts for tools. */
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
  /** Called after a shape or connector is created: selects id, returns to Select. */
  toolCreated(id: string): void;
}

const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INPUT_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable;
}

export function useActiveTool(): UseActiveToolResult {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // We need a ref to the current tool for the keydown handler (mounted once).
  const toolRef = useRef<ToolId>(tool);
  toolRef.current = tool;

  // Callback refs for selection.
  const onSelectIdRef = useRef<((id: string) => void) | null>(null);

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    // Select the newly created object.
    if (onSelectIdRef.current) {
      onSelectIdRef.current(id);
    }
    // Return to Select tool.
    setToolState('select');
  }, []);

  // Keyboard shortcuts: single letters switch tool; Escape returns to Select.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextInput(event.target)) return;
      if (event.ctrlKey || event.metaKey) return;

      const key = event.key.toLowerCase();

      // Escape: return to select if not already there.
      if (event.key === 'Escape') {
        if (toolRef.current !== 'select') {
          setToolState('select');
          event.preventDefault();
        }
        return;
      }

      // Single-letter tool shortcuts.
      const newTool = TOOL_SHORTCUTS[key];
      if (newTool && newTool !== toolRef.current) {
        // Only activate tools that have implementations. The pen is one of them:
        // `p` is the shortcut the toolbar advertises on the button.
        if (
          newTool === 'shape'
          || newTool === 'connector'
          || newTool === 'select'
          || newTool === 'text'
          || newTool === 'sticky'
          || newTool === 'pen'
        ) {
          setToolState(newTool);
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    tool,
    shapeKind,
    setTool,
    setShapeKind,
    toolCreated,
  };
}