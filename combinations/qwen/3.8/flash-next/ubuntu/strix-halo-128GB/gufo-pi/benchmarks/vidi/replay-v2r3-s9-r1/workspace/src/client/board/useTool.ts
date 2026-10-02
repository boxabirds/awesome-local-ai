import { useCallback, useEffect, useRef, useState } from 'react';

/** The tool chosen from the bottom toolbar (story 9). */
export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(tool: Tool): void;
}

/** True when focus is in something that takes text (fields and board editors). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Tool mode state. 'select' pans, selects and transforms; 'text' places a new
 * text object on the next board click and then reverts. V, T and Escape switch
 * the tool, ignored while typing in a field or a board editor, and T is refused
 * when the board cannot be edited. The tool is never persisted, so every client
 * starts in 'select'.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((next: Tool) => {
    setToolState(next === 'text' && !canEditRef.current ? 'select' : next);
  }, []);

  // Losing edit rights (board failed to load) never leaves the text tool active.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntryTarget(e.target)) return;
      if (e.key === 'v' || e.key === 'V') {
        setToolState('select');
      } else if (e.key === 't' || e.key === 'T') {
        if (canEditRef.current) setToolState('text');
      } else if (e.key === 'Escape') {
        setToolState('select');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, setTool };
}
