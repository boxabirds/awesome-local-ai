// useTool (story 9, tool.select / tool.text / tool.shortcuts): the active
// tool of the board. Exactly one tool is active at a time.
//
//   - 'select' (default): click selects, handles resize (story 7).
//   - 'text': a click anywhere on the board (empty space or on top of an
//     object) creates a text object there and returns to 'select'
//     (tool.text).
//
// Shortcuts (tool.shortcuts): V → select, T → text, N → create a sticky note
// at the view centre (story 2's Sticky note button behaviour), Escape →
// select. Ignored while editing text or the keyboard focus is in an input,
// and T is a no-op while the board cannot be edited (story 4 edit lock).
// The Toolbar's Select (V) / Text (T) buttons and the Sticky note (N) button
// are the same actions.

import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolActions {
  /** The N shortcut: create a sticky note at the view centre. */
  onCreateStickyAtCenter?(): void;
}

export interface ToolApi {
  tool: Tool;
  setTool(t: Tool): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useTool(canEdit: boolean, actions?: UseToolActions): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');

  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // The story 4 edit lock: an active Text tool reverts to Select.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback((t: Tool): void => {
    if (t === 'text' && !canEditRef.current) return; // edit lock
    setToolState(t);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // tool.shortcuts: ignored while editing text or focus is in an input.
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case 'v':
        case 'V':
          setToolState('select');
          break;
        case 't':
        case 'T':
          if (canEditRef.current) setToolState('text');
          break;
        case 'n':
        case 'N':
          if (canEditRef.current) actionsRef.current?.onCreateStickyAtCenter?.();
          break;
        case 'Escape':
          setToolState('select');
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, setTool };
}
