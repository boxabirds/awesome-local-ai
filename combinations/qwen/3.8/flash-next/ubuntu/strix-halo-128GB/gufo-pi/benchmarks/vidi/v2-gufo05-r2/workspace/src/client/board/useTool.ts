/**
 * Story 9: which tool this page is holding.
 *
 * Tool state is per-client and never written to the document: what *you* have
 * picked — the selector or the text tool — says nothing about anybody else's
 * board (story 3's rule for the selection). Stories 10–12 add their tools to this
 * same list; nothing else has to change.
 *
 * The keys live here because they belong to the tool, not to an object: V and T
 * pick a tool, Escape puts it back, N makes a sticky note the way story 2's button
 * does. They are skipped while a person is typing (the target is a field, or the
 * board has an object open for editing), so `T` in a word is a letter and never a
 * tool change (PRD text.tool, text.not_editable).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolShortcuts {
  /** `N`: the same thing the Sticky note button does (story 2's creation). */
  sticky?(): void;
}

export interface ToolState {
  tool: Tool;
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean, shortcuts: ToolShortcuts = {}): ToolState {
  const [tool, setToolState] = useState<Tool>('select');
  const current = useRef({ canEdit, tool, shortcuts });
  current.current = { canEdit, tool, shortcuts };

  const setTool = useCallback((next: Tool) => {
    // The Text tool is the only one that can be refused, so a page that cannot
    // edit the board can never be left holding it.
    if (next !== 'select' && !current.current.canEdit) return;
    setToolState((previous) => (previous === next ? previous : next));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Typing a word is not a shortcut (TC-16).
      if (isEditableTarget(event.target)) return;
      switch (event.key.toLowerCase()) {
        case 'v':
          event.preventDefault();
          setToolState('select');
          return;
        case 't':
          if (!current.current.canEdit) return; // PRD text.not_editable
          event.preventDefault();
          setToolState('text');
          return;
        case 'n':
          if (!current.current.canEdit) return;
          event.preventDefault();
          current.current.shortcuts.sticky?.();
          return;
        case 'escape':
          setToolState('select');
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A board that stops being editable takes the tool away mid-hand (the state
  // diagram's `Text → Select when canEdit becomes false`).
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool, setTool };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
