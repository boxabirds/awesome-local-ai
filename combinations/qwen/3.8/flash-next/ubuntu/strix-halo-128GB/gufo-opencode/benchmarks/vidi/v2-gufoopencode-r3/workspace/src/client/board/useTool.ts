import { useEffect, useState } from 'react';

// Board pointer tools. Stories 10-12 extend this union.
export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(tool: Tool): void;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

// Owns the active tool and its global shortcuts: V select, T text (only when
// the board is editable), Escape back to select. Keys are ignored while the
// user is typing into any text entry (TC-16).
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setTool] = useState<Tool>('select');

  // A board that stops being editable (load failed) cannot keep the Text
  // tool active (TC-15 negative path).
  useEffect(() => {
    if (!canEdit) setTool((prev) => (prev === 'select' ? prev : 'select'));
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        setTool((prev) => (prev === 'select' ? prev : 'select'));
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        setTool((prev) => (prev === 'select' ? prev : 'select'));
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        if (!canEdit) return;
        setTool((prev) => (prev === 'text' ? prev : 'text'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit]);

  return { tool, setTool };
}
