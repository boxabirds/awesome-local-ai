import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The active pointer tool (story 9). Select is the default and the only tool
 * until the Text tool adds click-to-create; a board that cannot be edited has
 * no Text tool at all, so the state falls back to Select the moment editing
 * goes away.
 */
export type Tool = 'select' | 'text';

export interface UseToolApi {
  tool: Tool;
  setTool: (tool: Tool) => void;
}

/** True when the key event belongs to a focused editable element. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function useTool(canEdit: boolean): UseToolApi {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);

  // A board that stops being editable (load failure, closing) has no Text tool.
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Typing into an editor is never a shortcut.
      if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key === 'Escape') {
        // Back to Select; other Escape handlers (clear selection, end editing)
        // receive the same event, so this does not stopPropagation.
        setToolState('select');
        return;
      }
      if (event.key === 'v' || event.key === 'V') {
        event.preventDefault();
        setToolState('select');
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        if (!canEditRef.current) {
          return;
        }
        event.preventDefault();
        setToolState('text');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const setTool = useCallback((next: Tool): void => {
    if (next === 'text' && !canEditRef.current) {
      return;
    }
    setToolState(next);
  }, []);

  return { tool, setTool };
}
