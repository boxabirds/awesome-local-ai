import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import { isEditableTarget } from '../board/useTool';

/**
 * The active pointer tool, shared by every tool story (9 to 12). The toolbar
 * and the single-letter shortcuts are the two ways in; creating an object hands
 * the pointer back to Select so the new item can be adjusted
 * (`tools.return_to_select`). Nothing here is persisted — the tool is a local
 * view of what the user is holding, never board data.
 */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/**
 * The shortcut each tool is bound to, as lower-case keys. Every tool story adds
 * its entry here; keys whose tool this build does not have yet are ignored, and
 * `n` is answered by `useBoardKeys`, which creates a sticky note rather than
 * holding a tool.
 */
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

/**
 * The tools this build can actually activate. Stories 11 and 12 extend the list
 * when their tools exist; until then their shortcuts do nothing.
 */
export const AVAILABLE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

export interface UseActiveToolOptions {
  /** False while the board cannot be edited: only Select is available. */
  canEdit?: boolean;
  /** Select a freshly created object (`toolCreated`). */
  select?(id: string): void;
}

export interface ActiveToolApi {
  tool: ToolId;
  /** Which kind of shape the Shape tool draws (kept between activations). */
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** A shape or arrow was created: select it and go back to Select. */
  toolCreated(id: string): void;
}

/**
 * The active tool hook: toolbar clicks and shortcuts, Escape back to Select, and
 * `toolCreated` for the return-to-Select-after-creating rule.
 */
export function useActiveTool(options: UseActiveToolOptions = {}): ActiveToolApi {
  const { canEdit = true, select } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });

  // A board that stops being editable (load failure, closing) holds no tool.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Typing into an editor is never a shortcut.
      if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key === 'Escape') {
        // Back to Select without creating anything. Other Escape handlers (clear
        // selection, end editing) see the same event, so no stopPropagation here.
        setToolState('select');
        return;
      }
      const next = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (next === undefined) return;
      if (!AVAILABLE_TOOLS.includes(next)) return;
      if (next !== 'select' && !canEditRef.current) return;
      event.preventDefault();
      setToolState(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const setTool = useCallback((next: ToolId): void => {
    if (!AVAILABLE_TOOLS.includes(next)) return;
    if (next !== 'select' && !canEditRef.current) return;
    setToolState(next);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string): void => {
    selectRef.current?.(id);
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
